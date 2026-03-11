import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PB_URL = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn'
const PB_EMAIL = (process.env.POCKETBASE_DB_EMAIL || '').trim()
const PB_PASSWORD = (process.env.POCKETBASE_DB_PASSWORD || '').trim()

if (!SUPABASE_URL || !SUPABASE_KEY || !PB_EMAIL || !PB_PASSWORD) {
  throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / POCKETBASE_DB_EMAIL / POCKETBASE_DB_PASSWORD')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const isApply = process.argv.includes('--apply')
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : null

const LEGACY_CATEGORY_RULES = [
  { sourceId: 'e0000000-0000-0000-0000-000000000080', name: 'Money Transfer', type: 'transfer' },
  { sourceId: 'e0000000-0000-0000-0000-000000000088', name: 'Online Services', type: 'expense' },
  { sourceId: 'e0000000-0000-0000-0000-000000000089', name: 'Lending', type: 'expense' },
  { sourceId: 'e0000000-0000-0000-0000-000000000091', name: 'Credit Payment', type: 'transfer' },
  { sourceId: 'e0000000-0000-0000-0000-000000000092', name: 'Cashback', type: 'income' },
  { sourceId: 'e0000000-0000-0000-0000-000000000095', name: 'Refund', type: 'income' },
  { sourceId: 'e0000000-0000-0000-0000-000000000096', name: 'Debt Repayment', type: 'income' },
  { sourceId: 'e0000000-0000-0000-0000-000000000097', name: 'Repayment', type: 'income' },
  { sourceId: 'e0000000-0000-0000-0000-000000000098', name: 'Adjustment', type: 'expense' },
  { sourceId: 'e0000000-0000-0000-0000-000000000099', name: 'Other Expense', type: 'expense' },
  { sourceId: 'e0000000-0000-0000-0000-000000000001', name: 'Food & Drink', type: 'expense' },
  { sourceId: 'e0000000-0000-0000-0000-000000000002', name: 'Utilities', type: 'expense' },
]

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function containsName(value, keyword) {
  return normalizeName(value).includes(normalizeName(keyword))
}

async function pbAuthHeaders() {
  const authRes = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })

  if (!authRes.ok) {
    throw new Error(`PB auth failed: ${authRes.status} ${await authRes.text()}`)
  }

  const payload = await authRes.json()
  return {
    'Content-Type': 'application/json',
    Authorization: payload.token,
  }
}

async function pbListAll(collection, headers, fields = 'id') {
  const all = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const res = await fetch(
      `${PB_URL}/api/collections/${collection}/records?page=${page}&perPage=200&fields=${encodeURIComponent(fields)}`,
      { headers }
    )

    if (!res.ok) {
      throw new Error(`List ${collection} page ${page} failed: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    all.push(...(data.items || []))
    totalPages = data.totalPages || 1
    page += 1
  }

  return all
}

async function pbPatchRecord(collection, id, body, headers) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Patch ${collection}/${id} failed: ${res.status} ${await res.text()}`)
  }
}

function pickCategory(rule, categories) {
  const sourceBySlug = categories.find((item) => item.slug === rule.sourceId)
  if (sourceBySlug) return sourceBySlug

  const strictByNameType = categories.find(
    (item) => normalizeName(item.name) === normalizeName(rule.name) && normalizeName(item.type) === normalizeName(rule.type)
  )
  if (strictByNameType) return strictByNameType

  if (rule.name === 'Cashback') {
    const cashbackLike = categories.find((item) => containsName(item.name, 'cashback') || containsName(item.name, 'hoàn tiền'))
    if (cashbackLike) return cashbackLike
  }

  if (rule.name === 'Refund') {
    const refundLike = categories.find((item) => containsName(item.name, 'refund'))
    if (refundLike) return refundLike
  }

  const looseByName = categories.find((item) => normalizeName(item.name) === normalizeName(rule.name))
  if (looseByName) return looseByName

  return null
}

async function main() {
  console.log(`\n[remap-categories] mode=${isApply ? 'APPLY' : 'DRY-RUN'}`)
  if (limit) console.log(`[remap-categories] limit=${limit}`)

  const headers = await pbAuthHeaders()
  const categories = await pbListAll('categories', headers, 'id,slug,name,type')

  const sourceToPbCategoryId = new Map()
  const categorySlugBackfills = []
  const unresolvedRules = []

  for (const rule of LEGACY_CATEGORY_RULES) {
    const chosen = pickCategory(rule, categories)
    if (!chosen) {
      unresolvedRules.push(rule)
      continue
    }

    sourceToPbCategoryId.set(rule.sourceId, chosen.id)

    if (!chosen.slug || chosen.slug !== rule.sourceId) {
      categorySlugBackfills.push({ categoryId: chosen.id, slug: rule.sourceId, name: chosen.name })
    }
  }

  const legacyIds = Array.from(sourceToPbCategoryId.keys())

  let txnQuery = supabase
    .from('transactions')
    .select('id,category_id')
    .in('category_id', legacyIds)

  if (limit && Number.isFinite(limit) && limit > 0) {
    txnQuery = txnQuery.limit(limit)
  }

  const { data: sourceTxns, error: sourceError } = await txnQuery
  if (sourceError) throw sourceError

  const transactions = sourceTxns || []

  const txBySourceId = new Map(transactions.map((tx) => [tx.id, tx]))
  const updates = []

  const pbTransactions = await pbListAll('transactions', headers, 'id,category_id,metadata')
  for (const pbTx of pbTransactions) {
    const sourceId = pbTx?.metadata && typeof pbTx.metadata === 'object' ? pbTx.metadata.source_id : null
    if (!sourceId || !txBySourceId.has(sourceId)) continue

    const sourceTx = txBySourceId.get(sourceId)
    const nextCategory = sourceToPbCategoryId.get(sourceTx.category_id)
    if (!nextCategory) continue

    if (pbTx.category_id === nextCategory) continue

    updates.push({ pbId: pbTx.id, sourceId, from: pbTx.category_id || null, to: nextCategory, sourceCategory: sourceTx.category_id })
  }

  console.log('[remap-categories] mapping summary')
  console.log(`- rules total: ${LEGACY_CATEGORY_RULES.length}`)
  console.log(`- rules resolved: ${sourceToPbCategoryId.size}`)
  console.log(`- rules unresolved: ${unresolvedRules.length}`)
  console.log(`- source transactions with legacy categories: ${transactions.length}`)
  console.log(`- PB transactions to update: ${updates.length}`)
  console.log(`- category slug backfills: ${categorySlugBackfills.length}`)

  if (unresolvedRules.length > 0) {
    console.log('[remap-categories] unresolved rules')
    for (const rule of unresolvedRules) {
      console.log(`  • ${rule.sourceId} -> ${rule.name} (${rule.type})`)
    }
  }

  if (!isApply) {
    console.log('[remap-categories] DRY-RUN done. Re-run with --apply to write changes.')
    return
  }

  for (const item of categorySlugBackfills) {
    await pbPatchRecord('categories', item.categoryId, { slug: item.slug }, headers)
  }

  for (const item of updates) {
    await pbPatchRecord('transactions', item.pbId, { category_id: item.to }, headers)
  }

  console.log('[remap-categories] APPLY done')
  console.log(`- category slug backfills applied: ${categorySlugBackfills.length}`)
  console.log(`- transactions category_id remapped: ${updates.length}`)
}

main().catch((error) => {
  console.error('[remap-categories] fatal:', error)
  process.exit(1)
})
