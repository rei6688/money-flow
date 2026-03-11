import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true })

const PB_URL = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn'
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD

if (!PB_EMAIL || !PB_PASSWORD) {
  throw new Error('Missing POCKETBASE_DB_EMAIL or POCKETBASE_DB_PASSWORD')
}

const isApply = process.argv.includes('--apply')

function toPocketBaseId(sourceId, fallbackPrefix = 'mf3') {
  if (!sourceId) {
    const randomSeed = `${fallbackPrefix}-${Date.now()}-${Math.random()}`
    const seed = createHash('sha256').update(randomSeed).digest()
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let randomId = ''
    for (let index = 0; index < 15; index++) {
      randomId += chars[seed[index] % chars.length]
    }
    return randomId
  }

  if (/^[a-z0-9]{15}$/.test(sourceId)) {
    return sourceId
  }

  const digest = createHash('sha256').update(String(sourceId)).digest()
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let index = 0; index < 15; index++) {
    result += chars[digest[index] % chars.length]
  }
  return result
}

function normalizeRelValue(value) {
  if (Array.isArray(value)) return value[0] || null
  if (typeof value === 'string') return value
  return null
}

async function authToken() {
  const response = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })

  if (!response.ok) {
    throw new Error(`Auth failed: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json()
  return payload.token
}

async function listAll(token, collection) {
  const headers = {
    Authorization: token,
    'Content-Type': 'application/json',
  }

  let page = 1
  const perPage = 200
  const all = []

  while (true) {
    const response = await fetch(`${PB_URL}/api/collections/${collection}/records?page=${page}&perPage=${perPage}`, {
      headers,
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`List ${collection} failed [${response.status}]: ${await response.text()}`)
    }

    const data = await response.json()
    const items = data.items || []
    all.push(...items)

    if (page >= (data.totalPages || 1)) break
    page += 1
  }

  return all
}

function resolveAccountId(value, accountIds, accountBySlug) {
  if (!value) return null
  if (accountIds.has(value)) return value

  const bySlug = accountBySlug.get(value)
  if (bySlug) return bySlug

  const hashed = toPocketBaseId(value, 'accounts')
  if (accountIds.has(hashed)) return hashed

  return null
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
    throw new Error(`Patch txn ${id} failed [${response.status}]: ${await response.text()}`)
  }
}

async function main() {
  console.log(`\n[relink] mode=${isApply ? 'APPLY' : 'DRY-RUN'}\n`)

  const token = await authToken()
  const accounts = await listAll(token, 'accounts')
  const transactions = await listAll(token, 'transactions')

  const accountIds = new Set(accounts.map((item) => item.id))
  const accountBySlug = new Map(
    accounts
      .filter((item) => typeof item.slug === 'string' && item.slug.length > 0)
      .map((item) => [item.slug, item.id])
  )

  const relFields = ['account_id', 'to_account_id', 'target_account_id']
  let inspected = 0
  let changed = 0
  let patched = 0
  let unresolved = 0
  const unresolvedSamples = []

  for (const txn of transactions) {
    inspected += 1
    const patch = {}
    let hasChange = false

    for (const field of relFields) {
      if (!(field in txn)) continue

      const current = normalizeRelValue(txn[field])
      if (!current) continue

      const resolved = resolveAccountId(current, accountIds, accountBySlug)

      if (!resolved) {
        unresolved += 1
        if (unresolvedSamples.length < 30) {
          unresolvedSamples.push({
            txnId: txn.id,
            field,
            value: current,
          })
        }
        continue
      }

      if (resolved !== current) {
        patch[field] = resolved
        hasChange = true
      }
    }

    if (hasChange) {
      changed += 1
      if (isApply) {
        await patchTransaction(token, txn.id, patch)
        patched += 1
      }
    }
  }

  console.log('[relink] summary')
  console.log(`- accounts: ${accounts.length}`)
  console.log(`- transactions: ${transactions.length}`)
  console.log(`- inspected: ${inspected}`)
  console.log(`- needs_change: ${changed}`)
  console.log(`- patched: ${patched}`)
  console.log(`- unresolved_refs: ${unresolved}`)

  if (unresolvedSamples.length > 0) {
    console.log('\n[relink] unresolved samples (max 30):')
    unresolvedSamples.forEach((item) => {
      console.log(`- txn=${item.txnId} field=${item.field} value=${item.value}`)
    })
  }

  if (!isApply) {
    console.log('\n[relink] DRY-RUN complete. Re-run with --apply to persist updates.')
  }
}

main().catch((error) => {
  console.error('[relink] fatal:', error)
  process.exit(1)
})
