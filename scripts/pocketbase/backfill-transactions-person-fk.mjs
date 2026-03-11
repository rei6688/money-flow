import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true })

const PB_URL = (process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn').trim()
const PB_EMAIL = (process.env.POCKETBASE_DB_EMAIL || '').trim()
const PB_PASSWORD = (process.env.POCKETBASE_DB_PASSWORD || '').trim()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!PB_EMAIL || !PB_PASSWORD || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[backfill-person-fk] Missing env vars: POCKETBASE_DB_EMAIL, POCKETBASE_DB_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const argSet = new Set(process.argv.slice(2))
const isApply = argSet.has('--apply')
const onlyMissing = !argSet.has('--all')
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : null

function toPocketBaseId(sourceId, fallbackPrefix = 'mf3') {
  if (!sourceId) {
    const seed = `${fallbackPrefix}-${Date.now()}-${Math.random()}`
    const digest = createHash('sha256').update(seed).digest()
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let randomId = ''
    for (let index = 0; index < 15; index++) randomId += chars[digest[index] % chars.length]
    return randomId
  }

  if (/^[a-z0-9]{15}$/.test(String(sourceId))) return String(sourceId)

  const digest = createHash('sha256').update(String(sourceId)).digest()
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let index = 0; index < 15; index++) result += chars[digest[index] % chars.length]
  return result
}

function normalizeRelValue(value) {
  if (Array.isArray(value)) return value[0] || null
  if (typeof value === 'string') return value
  return null
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readSourceTxnId(txn) {
  const metadata = txn?.metadata && typeof txn.metadata === 'object' ? txn.metadata : null
  const sourceFromMetadata = normalizeString(metadata?.source_id)
  if (sourceFromMetadata) return sourceFromMetadata

  const slug = normalizeString(txn?.slug)
  if (slug && /^[0-9a-f-]{36}$/i.test(slug)) return slug

  return null
}

async function authToken() {
  const response = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })

  if (!response.ok) {
    throw new Error(`[backfill-person-fk] PB auth failed: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json()
  return payload.token
}

async function listAll(token, collection, fields = '*') {
  const headers = {
    Authorization: token,
    'Content-Type': 'application/json',
  }

  let page = 1
  const perPage = 200
  const all = []

  while (true) {
    const query = new URLSearchParams({ page: String(page), perPage: String(perPage), fields })
    const response = await fetch(`${PB_URL}/api/collections/${collection}/records?${query.toString()}`, {
      headers,
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`[backfill-person-fk] List ${collection} failed [${response.status}]: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.items || []
    all.push(...items)

    if (page >= (data.totalPages || 1)) break
    page += 1
  }

  return all
}

async function patchTransaction(token, id, body) {
  const headers = {
    Authorization: token,
    'Content-Type': 'application/json',
  }

  const response = await fetch(`${PB_URL}/api/collections/transactions/records/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`[backfill-person-fk] Patch txn ${id} failed [${response.status}]: ${await response.text()}`)
  }
}

async function fetchSbTxnPersonMap(sourceTxnIds) {
  const result = new Map()
  const chunkSize = 500

  for (let index = 0; index < sourceTxnIds.length; index += chunkSize) {
    const chunk = sourceTxnIds.slice(index, index + chunkSize)
    const { data, error } = await supabase
      .from('transactions')
      .select('id,person_id')
      .in('id', chunk)

    if (error) throw error

    for (const row of data || []) {
      result.set(row.id, normalizeString(row.person_id))
    }
  }

  return result
}

function createPeopleResolver(pbPeople) {
  const byId = new Set(pbPeople.map((item) => item.id))
  const bySlug = new Map(
    pbPeople
      .filter((item) => typeof item.slug === 'string' && item.slug.length > 0)
      .map((item) => [String(item.slug), item.id])
  )

  return (rawValue) => {
    const value = normalizeString(rawValue)
    if (!value) return null

    if (byId.has(value)) return value

    const slugHit = bySlug.get(value)
    if (slugHit) return slugHit

    const hashed = toPocketBaseId(value, 'people')
    if (byId.has(hashed)) return hashed

    return null
  }
}

async function main() {
  console.log(`\n[backfill-person-fk] mode=${isApply ? 'APPLY' : 'DRY-RUN'} onlyMissing=${onlyMissing ? 'yes' : 'no'} limit=${Number.isFinite(limit) ? limit : 'none'}\n`)

  const token = await authToken()

  const [pbPeople, pbTransactions] = await Promise.all([
    listAll(token, 'people', 'id,slug,name'),
    listAll(token, 'transactions', 'id,slug,person_id,metadata,type,amount,final_price'),
  ])

  const resolvePbPersonId = createPeopleResolver(pbPeople)

  const candidateTransactions = pbTransactions.filter((txn) => {
    const currentPerson = normalizeRelValue(txn.person_id)
    if (!onlyMissing) return true
    return !normalizeString(currentPerson)
  })

  const slicedCandidates = Number.isFinite(limit) && limit > 0
    ? candidateTransactions.slice(0, limit)
    : candidateTransactions

  const sourceTxnIds = Array.from(
    new Set(
      slicedCandidates
        .map((txn) => readSourceTxnId(txn))
        .filter((value) => Boolean(value))
    )
  )

  const sbTxnPersonMap = await fetchSbTxnPersonMap(sourceTxnIds)

  let scanned = 0
  let needsChange = 0
  let patched = 0
  let missingSourceTxnId = 0
  let unresolvedPerson = 0

  const samplesMissingSource = []
  const samplesUnresolvedPerson = []
  const samplesPatched = []

  for (const txn of slicedCandidates) {
    scanned += 1

    const currentPerson = normalizeString(normalizeRelValue(txn.person_id))
    if (onlyMissing && currentPerson) continue

    const sourceTxnId = readSourceTxnId(txn)
    if (!sourceTxnId) {
      missingSourceTxnId += 1
      if (samplesMissingSource.length < 20) {
        samplesMissingSource.push({ txnId: txn.id, type: txn.type, amount: txn.amount, final_price: txn.final_price })
      }
      continue
    }

    const sourcePersonId = sbTxnPersonMap.get(sourceTxnId)
    const resolvedPbPersonId = resolvePbPersonId(sourcePersonId)

    if (!resolvedPbPersonId) {
      unresolvedPerson += 1
      if (samplesUnresolvedPerson.length < 20) {
        samplesUnresolvedPerson.push({ txnId: txn.id, sourceTxnId, sourcePersonId: sourcePersonId || null })
      }
      continue
    }

    if (resolvedPbPersonId === currentPerson) continue

    needsChange += 1

    if (samplesPatched.length < 20) {
      samplesPatched.push({ txnId: txn.id, sourceTxnId, sourcePersonId, toPersonId: resolvedPbPersonId })
    }

    if (isApply) {
      await patchTransaction(token, txn.id, { person_id: resolvedPbPersonId })
      patched += 1
    }
  }

  console.log('[backfill-person-fk] summary')
  console.log(`- people: ${pbPeople.length}`)
  console.log(`- transactions_total: ${pbTransactions.length}`)
  console.log(`- transactions_scanned: ${scanned}`)
  console.log(`- source_txn_ids_looked_up: ${sourceTxnIds.length}`)
  console.log(`- needs_change: ${needsChange}`)
  console.log(`- patched: ${patched}`)
  console.log(`- missing_source_txn_id: ${missingSourceTxnId}`)
  console.log(`- unresolved_person: ${unresolvedPerson}`)

  if (samplesPatched.length > 0) {
    console.log('\n[backfill-person-fk] patch samples (max 20):')
    for (const row of samplesPatched) {
      console.log(`- txn=${row.txnId} source_txn=${row.sourceTxnId} source_person=${row.sourcePersonId} -> pb_person=${row.toPersonId}`)
    }
  }

  if (samplesMissingSource.length > 0) {
    console.log('\n[backfill-person-fk] missing source_txn_id samples (max 20):')
    for (const row of samplesMissingSource) {
      console.log(`- txn=${row.txnId} type=${row.type} amount=${row.amount} final_price=${row.final_price}`)
    }
  }

  if (samplesUnresolvedPerson.length > 0) {
    console.log('\n[backfill-person-fk] unresolved person samples (max 20):')
    for (const row of samplesUnresolvedPerson) {
      console.log(`- txn=${row.txnId} source_txn=${row.sourceTxnId} source_person=${row.sourcePersonId}`)
    }
  }

  if (!isApply) {
    console.log('\n[backfill-person-fk] DRY-RUN complete. Re-run with --apply to persist updates.')
  }
}

main().catch((error) => {
  console.error('[backfill-person-fk] fatal:', error)
  process.exit(1)
})
