import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
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

const argSet = new Set(process.argv.slice(2))
const isApply = argSet.has('--apply')
const shouldReset = argSet.has('--reset')
const includeCycles = !argSet.has('--skip-cycles')
const strictRelations = !argSet.has('--no-strict-relations')
const autoSyncTxnSchema = !argSet.has('--no-auto-sync-schema')
const recreateCollection = argSet.has('--recreate-collection')
const hardResetDomain = argSet.has('--hard-reset-domain')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const onlyIdArg = process.argv.find((a) => a.startsWith('--only-id='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : null
const onlyId = onlyIdArg ? String(onlyIdArg.split('=')[1] || '').trim() : null

function toPocketBaseId(sourceId, fallbackPrefix = 'mf3') {
  if (!sourceId) {
    const randomSeed = `${fallbackPrefix}-${Date.now()}-${Math.random()}`
    const hash = crypto.createHash('sha256').update(randomSeed).digest()
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let randomId = ''
    for (let i = 0; i < 15; i++) randomId += chars[hash[i] % chars.length]
    return randomId
  }

  if (/^[a-z0-9]{15}$/.test(sourceId)) return sourceId

  const hash = crypto.createHash('sha256').update(String(sourceId)).digest()
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 15; i++) result += chars[hash[i] % chars.length]
  return result
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function calculateCycleTag(dateStr, statementDay) {
  if (!statementDay || !dateStr) return null
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null

  let month = date.getMonth() + 1
  let year = date.getFullYear()

  if (date.getDate() > statementDay) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return `${year}-${String(month).padStart(2, '0')}`
}

function normalizeStatus(status) {
  const raw = String(status || '').trim().toLowerCase()
  if (raw === 'pending') return 'pending'
  if (raw === 'void') return 'void'
  return 'posted'
}

function normalizeDate(dateValue) {
  if (!dateValue) return null
  const value = new Date(dateValue)
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function computeExpectedFinalPrice(amount, sharePercent, shareFixed) {
  const base = Number(amount || 0)
  const percent = Number(sharePercent || 0)
  const fixed = Number(shareFixed || 0)
  const discount = (base * percent) / 100 + fixed
  return Math.round((base - discount) * 100) / 100
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

  const authData = await authRes.json()
  return {
    'Content-Type': 'application/json',
    Authorization: authData.token,
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

async function pbDeleteAll(collection, headers) {
  const records = await pbListAll(collection, headers, 'id')
  if (records.length === 0) return 0

  let deleted = 0
  for (const record of records) {
    const delRes = await fetch(`${PB_URL}/api/collections/${collection}/records/${record.id}`, {
      method: 'DELETE',
      headers,
    })

    if (!delRes.ok) {
      throw new Error(`Delete ${collection}/${record.id} failed: ${delRes.status} ${await delRes.text()}`)
    }

    deleted += 1
  }

  return deleted
}

async function pbCreate(collection, id, body, headers) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, ...body }),
  })

  if (!res.ok) {
    throw new Error(`Create ${collection}/${id} failed: ${res.status} ${await res.text()}`)
  }
}

async function pbPatch(collection, id, body, headers) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Patch ${collection}/${id} failed: ${res.status} ${await res.text()}`)
  }
}

async function pbGetCollectionFields(collection, headers) {
  const res = await fetch(`${PB_URL}/api/collections/${collection}`, { headers })
  if (!res.ok) {
    throw new Error(`Get collection ${collection} failed: ${res.status} ${await res.text()}`)
  }
  const payload = await res.json()
  const fields = Array.isArray(payload.fields) ? payload.fields.map((f) => f.name) : []
  return new Set(fields)
}

async function syncTransactionsSchemaFromLocal(headers) {
  const txnCollection = readTransactionsSchemaFromLocal()

  const liveRes = await fetch(`${PB_URL}/api/collections/transactions`, { headers })
  if (!liveRes.ok) {
    throw new Error(`Failed to read current transactions collection: ${liveRes.status} ${await liveRes.text()}`)
  }

  const liveCollection = await liveRes.json()
  const liveFields = Array.isArray(liveCollection.fields) ? liveCollection.fields : []
  const localFields = Array.isArray(txnCollection.fields) ? txnCollection.fields : []
  const liveNames = new Set(liveFields.map((field) => field.name))

  const missingLocalFields = localFields.filter((field) => !liveNames.has(field.name))
  if (missingLocalFields.length === 0) {
    return
  }

  const patchBody = {
    ...liveCollection,
    fields: [...liveFields, ...missingLocalFields],
  }

  const patchRes = await fetch(`${PB_URL}/api/collections/transactions`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patchBody),
  })

  if (!patchRes.ok) {
    throw new Error(`Failed to sync transactions schema: ${patchRes.status} ${await patchRes.text()}`)
  }
}

function readTransactionsSchemaFromLocal() {
  const schemaPath = path.resolve(__dirname, 'schema.json')
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema.json not found at ${schemaPath}`)
  }

  const raw = fs.readFileSync(schemaPath, 'utf8')
  const collections = JSON.parse(raw)
  const txnCollection = collections.find((item) => item && item.name === 'transactions')

  if (!txnCollection) {
    throw new Error('transactions schema block not found in scripts/pocketbase/schema.json')
  }

  return txnCollection
}

async function recreateTransactionsCollection(headers) {
  const txnCollection = readTransactionsSchemaFromLocal()

  const existingRes = await fetch(`${PB_URL}/api/collections/transactions`, { headers })
  if (existingRes.ok) {
    const existing = await existingRes.json()
    const existingId = existing.id || 'transactions'

    const deleteRes = await fetch(`${PB_URL}/api/collections/${existingId}`, {
      method: 'DELETE',
      headers,
    })

    if (!deleteRes.ok) {
      throw new Error(`Failed deleting transactions collection: ${deleteRes.status} ${await deleteRes.text()}`)
    }
  } else if (existingRes.status !== 404) {
    throw new Error(`Unable to check transactions collection: ${existingRes.status} ${await existingRes.text()}`)
  }

  const createRes = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers,
    body: JSON.stringify(txnCollection),
  })

  if (!createRes.ok) {
    throw new Error(`Failed creating transactions collection: ${createRes.status} ${await createRes.text()}`)
  }
}

function collectionCreatePayload(collection) {
  return {
    id: collection.id,
    name: collection.name,
    type: collection.type,
    system: Boolean(collection.system),
    listRule: collection.listRule ?? null,
    viewRule: collection.viewRule ?? null,
    createRule: collection.createRule ?? null,
    updateRule: collection.updateRule ?? null,
    deleteRule: collection.deleteRule ?? null,
    fields: Array.isArray(collection.fields) ? collection.fields : [],
    indexes: Array.isArray(collection.indexes) ? collection.indexes : [],
    options: collection.options ?? {},
  }
}

async function pbGetCollection(name, headers) {
  const res = await fetch(`${PB_URL}/api/collections/${name}`, { headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Get collection ${name} failed: ${res.status} ${await res.text()}`)
  return await res.json()
}

async function pbDeleteCollection(name, headers) {
  const coll = await pbGetCollection(name, headers)
  if (!coll) return false
  const collId = coll.id || name
  const res = await fetch(`${PB_URL}/api/collections/${collId}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) throw new Error(`Delete collection ${name} failed: ${res.status} ${await res.text()}`)
  return true
}

async function pbCreateCollection(payload, headers) {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Create collection ${payload.name} failed: ${res.status} ${await res.text()}`)
}

async function pbGetCollectionsMap(headers) {
  const res = await fetch(`${PB_URL}/api/collections?perPage=500&fields=id,name`, { headers })
  if (!res.ok) throw new Error(`List collections failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const idByName = new Map()
  const nameById = new Map()
  for (const item of data.items || []) {
    idByName.set(item.name, item.id)
    nameById.set(item.id, item.name)
  }
  return { idByName, nameById }
}

function inferRelationTargetName(fieldName) {
  if (fieldName === 'account_id' || fieldName === 'to_account_id') return 'accounts'
  if (fieldName === 'category_id') return 'categories'
  if (fieldName === 'shop_id') return 'shops'
  if (fieldName === 'person_id') return 'people'
  if (fieldName === 'parent_transaction_id') return 'transactions'
  if (fieldName === 'installment_plan_id') return 'installments'
  return null
}

function normalizeSchemaFieldForCreate(field, maps) {
  const normalized = {
    id: field.id,
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    presentable: field.presentable,
    hidden: field.hidden,
    system: field.system,
  }

  if (field.type === 'select') {
    normalized.maxSelect = field.maxSelect ?? field.options?.maxSelect ?? 1
    normalized.values = field.values ?? field.options?.values ?? []
  } else if (field.type === 'relation') {
    if (field.name === 'parent_transaction_id') {
      return null
    }
    normalized.maxSelect = field.maxSelect ?? field.options?.maxSelect ?? 1
    normalized.cascadeDelete = field.cascadeDelete ?? field.options?.cascadeDelete ?? false

    const rawTargetId = field.collectionId ?? field.options?.collectionId ?? null
    let targetName = rawTargetId ? maps.nameById.get(rawTargetId) || null : null
    if (!targetName) targetName = inferRelationTargetName(field.name)
    const resolvedTargetId = targetName ? maps.idByName.get(targetName) || null : null
    if (!resolvedTargetId) {
      return null
    }
    normalized.collectionId = resolvedTargetId
  }

  if (field.min != null) normalized.min = field.min
  if (field.max != null) normalized.max = field.max
  if (field.pattern != null) normalized.pattern = field.pattern
  if (field.values != null && field.type !== 'select') normalized.values = field.values

  return normalized
}

async function ensureParentTransactionRelationField(headers) {
  const res = await fetch(`${PB_URL}/api/collections/transactions`, { headers })
  if (!res.ok) throw new Error(`Read transactions collection failed: ${res.status} ${await res.text()}`)

  const collection = await res.json()
  const fields = Array.isArray(collection.fields) ? collection.fields : []
  const hasField = fields.some((f) => f.name === 'parent_transaction_id')
  if (hasField) return

  const parentField = {
    id: 'f_partxn_01',
    name: 'parent_transaction_id',
    type: 'relation',
    required: false,
    maxSelect: 1,
    cascadeDelete: false,
    collectionId: collection.id,
  }

  const patchRes = await fetch(`${PB_URL}/api/collections/${collection.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: [...fields, parentField] }),
  })
  if (!patchRes.ok) {
    throw new Error(`Add parent_transaction_id relation failed: ${patchRes.status} ${await patchRes.text()}`)
  }
}

async function buildTransactionsCreatePayload(headers) {
  const schema = readTransactionsSchemaFromLocal()
  const maps = await pbGetCollectionsMap(headers)
  const fields = (schema.fields || [])
    .map((field) => normalizeSchemaFieldForCreate(field, maps))
    .filter(Boolean)

  return {
    id: schema.id,
    name: schema.name,
    type: schema.type,
    system: Boolean(schema.system),
    listRule: schema.listRule ?? null,
    viewRule: schema.viewRule ?? null,
    createRule: schema.createRule ?? null,
    updateRule: schema.updateRule ?? null,
    deleteRule: schema.deleteRule ?? null,
    fields,
    indexes: Array.isArray(schema.indexes) ? schema.indexes : [],
    options: schema.options ?? {},
  }
}

async function hardResetTransactionsDomain(headers) {
  const dependentNames = ['batch_items', 'cashback_entries', 'installments']
  const backups = []

  for (const name of dependentNames) {
    const collection = await pbGetCollection(name, headers)
    if (collection) backups.push(collectionCreatePayload(collection))
  }

  for (const name of dependentNames) {
    await pbDeleteCollection(name, headers)
  }

  await pbDeleteCollection('transactions', headers)
  const transactionsPayload = await buildTransactionsCreatePayload(headers)
  await pbCreateCollection(transactionsPayload, headers)
  await ensureParentTransactionRelationField(headers)

  for (const payload of backups) {
    await pbCreateCollection(payload, headers)
  }
}

async function buildResolver(collection, headers) {
  const rows = await pbListAll(collection, headers, 'id,slug')
  const idSet = new Set(rows.map((r) => r.id))
  const bySlug = new Map(
    rows
      .filter((r) => typeof r.slug === 'string' && r.slug.length > 0)
      .map((r) => [String(r.slug), r.id])
  )

  function resolve(sourceId) {
    if (!sourceId) return null
    const raw = String(sourceId)
    if (idSet.has(raw)) return raw
    if (bySlug.has(raw)) return bySlug.get(raw)

    if (isUuid(raw)) {
      const hashed = toPocketBaseId(raw, collection)
      if (idSet.has(hashed)) return hashed
    }

    return null
  }

  return { resolve, total: rows.length }
}

async function fetchSupabaseData() {
  let query = supabase
    .from('transactions')
    .select('id,occurred_at,note,amount,type,status,account_id,target_account_id,category_id,shop_id,person_id,parent_transaction_id,is_installment,metadata,final_price,cashback_share_percent,cashback_share_fixed,cashback_mode,persisted_cycle_tag,debt_cycle_tag,statement_cycle_tag,tag')
    .order('occurred_at', { ascending: true })

  if (onlyId) {
    query = query.eq('id', onlyId)
  }

  if (limit && Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit)
  }

  const [{ data: txns, error: txError }, { data: accounts, error: accountErr }, cyclesResult] = await Promise.all([
    query,
    supabase.from('accounts').select('id,statement_day'),
    includeCycles
      ? supabase
          .from('cashback_cycles')
          .select('id,account_id,cycle_tag,spent_amount,real_awarded,virtual_profit,max_budget,min_spend_target,is_exhausted,met_min_spend,overflow_loss')
          .order('cycle_tag', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])

  if (txError) throw txError
  if (accountErr) throw accountErr
  if (cyclesResult.error) throw cyclesResult.error

  return {
    transactions: txns || [],
    accountStatementMap: new Map((accounts || []).map((a) => [a.id, a.statement_day])),
    cycles: cyclesResult.data || [],
  }
}

function buildTransactionPayloads({ transactions, accountStatementMap, resolvers, existingTxnBySourceId, existingTxnIdSet, transactionFieldSet }) {
  const unresolved = {
    account: new Map(),
    toAccount: new Map(),
    category: new Map(),
    shop: new Map(),
    person: new Map(),
    parent: new Map(),
  }

  const skipped = []
  const formulaMismatches = []
  const payloads = []

  const sourceToPbId = new Map()

  for (const txn of transactions) {
    const sourceId = String(txn.id)

    const accountId = resolvers.accounts.resolve(txn.account_id)
    if (!accountId) {
      unresolved.account.set(txn.account_id, (unresolved.account.get(txn.account_id) || 0) + 1)
      if (strictRelations) {
        skipped.push({ sourceId, reason: `Unresolved account_id: ${txn.account_id}` })
        continue
      }
    }

    const toAccountId = txn.target_account_id ? resolvers.accounts.resolve(txn.target_account_id) : null
    if (txn.target_account_id && !toAccountId) {
      unresolved.toAccount.set(txn.target_account_id, (unresolved.toAccount.get(txn.target_account_id) || 0) + 1)
    }

    const categoryId = txn.category_id ? resolvers.categories.resolve(txn.category_id) : null
    if (txn.category_id && !categoryId) {
      unresolved.category.set(txn.category_id, (unresolved.category.get(txn.category_id) || 0) + 1)
    }

    const shopId = txn.shop_id ? resolvers.shops.resolve(txn.shop_id) : null
    if (txn.shop_id && !shopId) {
      unresolved.shop.set(txn.shop_id, (unresolved.shop.get(txn.shop_id) || 0) + 1)
    }

    const personId = txn.person_id ? resolvers.people.resolve(txn.person_id) : null
    if (txn.person_id && !personId) {
      unresolved.person.set(txn.person_id, (unresolved.person.get(txn.person_id) || 0) + 1)
    }

    const statementDay = accountStatementMap.get(txn.account_id)
    const persistedCycleTag = txn.persisted_cycle_tag || txn.statement_cycle_tag || calculateCycleTag(txn.occurred_at, statementDay)
    const debtCycleTag = txn.debt_cycle_tag || (txn.tag ? String(txn.tag) : null)

    const amount = parseMoney(txn.amount) ?? 0
    const sharePercent = parseMoney(txn.cashback_share_percent)
    const shareFixed = parseMoney(txn.cashback_share_fixed)
    const finalPrice = parseMoney(txn.final_price)
    const expectedFinal = computeExpectedFinalPrice(amount, sharePercent, shareFixed)

    if (finalPrice !== null && Math.abs(finalPrice - expectedFinal) > 0.01) {
      formulaMismatches.push({ sourceId, finalPrice, expectedFinal })
    }

    const existingId = existingTxnBySourceId.get(sourceId)
    const generatedId = toPocketBaseId(sourceId, 'transactions')
    const pbId = existingId || (existingTxnIdSet.has(generatedId) ? generatedId : generatedId)

    sourceToPbId.set(sourceId, pbId)

    const metadata = {
      ...(txn.metadata && typeof txn.metadata === 'object' ? txn.metadata : {}),
      source_id: sourceId,
      persisted_cycle_tag: persistedCycleTag,
      occurred_at: normalizeDate(txn.occurred_at),
      status: normalizeStatus(txn.status),
      cashback_share_percent: sharePercent,
      cashback_share_fixed: shareFixed,
      cashback_mode: txn.cashback_mode ?? null,
      debt_cycle_tag: debtCycleTag,
    }

    const body = {
      date: normalizeDate(txn.occurred_at),
      description: txn.note || '',
      amount,
      type: txn.type,
      account_id: accountId,
      to_account_id: toAccountId,
      category_id: categoryId,
      shop_id: shopId,
      person_id: personId,
      final_price: finalPrice,
      cashback_amount: parseMoney(txn.cashback_amount) ?? parseMoney(txn.cashback_share_fixed),
      is_installment: Boolean(txn.is_installment),
      parent_transaction_id: null,
      metadata,
    }

    if (transactionFieldSet.has('occurred_at')) body.occurred_at = normalizeDate(txn.occurred_at)
    if (transactionFieldSet.has('note')) body.note = txn.note || null
    if (transactionFieldSet.has('status')) body.status = normalizeStatus(txn.status)
    if (transactionFieldSet.has('cashback_share_percent')) body.cashback_share_percent = sharePercent
    if (transactionFieldSet.has('cashback_share_fixed')) body.cashback_share_fixed = shareFixed
    if (transactionFieldSet.has('cashback_mode')) body.cashback_mode = txn.cashback_mode ?? null
    if (transactionFieldSet.has('debt_cycle_tag')) body.debt_cycle_tag = debtCycleTag
    if (transactionFieldSet.has('persisted_cycle_tag')) body.persisted_cycle_tag = persistedCycleTag

    payloads.push({
      sourceId,
      pbId,
      parentSourceId: txn.parent_transaction_id || null,
      body,
    })
  }

  for (const item of payloads) {
    const parentSourceId = item.parentSourceId
    if (!parentSourceId) continue
    const parentPbId = sourceToPbId.get(parentSourceId) || existingTxnBySourceId.get(parentSourceId) || null

    if (!parentPbId) {
      unresolved.parent.set(parentSourceId, (unresolved.parent.get(parentSourceId) || 0) + 1)
      continue
    }

    item.body.parent_transaction_id = parentPbId
  }

  return { payloads, unresolved, skipped, formulaMismatches }
}

function summarizeMap(map, label, max = 10) {
  const entries = Array.from(map.entries())
  if (entries.length === 0) return

  console.log(`- ${label}: ${entries.length} distinct ids`)
  entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .forEach(([id, count]) => {
      console.log(`  • ${id}: ${count}`)
    })
}

function printSummary(stats) {
  console.log('\n[remigrate-source-id] === SUMMARY ===')
  console.log(`Mode: ${isApply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`Reset before migrate: ${shouldReset ? 'yes' : 'no'}`)
  console.log(`Transactions source rows: ${stats.totalSourceTransactions}`)
  console.log(`Transactions skipped: ${stats.skipped}`)
  console.log(`Transactions created: ${stats.created}`)
  console.log(`Transactions updated: ${stats.updated}`)
  console.log(`Cycles created: ${stats.cyclesCreated}`)
  console.log(`Cycles reset count: ${stats.cyclesDeleted}`)
  console.log(`Txn reset count: ${stats.transactionsDeleted}`)
  console.log(`Formula mismatches: ${stats.formulaMismatches}`)
  console.log(`Unresolved-relations: ${stats.unresolvedRelations}`)
}

async function validateAfterApply(headers, sourceTransactions) {
  const pbTransactions = await pbListAll('transactions', headers, 'id,account_id,person_id,metadata,amount,final_price')

  const sourceIds = new Set(sourceTransactions.map((t) => String(t.id)))
  const pbSourceIds = new Set(
    pbTransactions
      .map((t) => (t.metadata && typeof t.metadata === 'object' ? t.metadata.source_id : null))
      .filter(Boolean)
      .map(String)
  )

  let missingInPb = 0
  for (const id of sourceIds) {
    if (!pbSourceIds.has(id)) missingInPb += 1
  }

  let accountNullCount = 0
  let formulaMismatchCount = 0
  for (const txn of pbTransactions) {
    if (!txn.account_id) accountNullCount += 1

    const amount = Number(txn.amount || 0)
    const metadata = txn.metadata && typeof txn.metadata === 'object' ? txn.metadata : {}
    const expected = computeExpectedFinalPrice(
      amount,
      txn.cashback_share_percent ?? metadata.cashback_share_percent ?? null,
      txn.cashback_share_fixed ?? metadata.cashback_share_fixed ?? null
    )
    const finalPrice = txn.final_price == null ? null : Number(txn.final_price)
    if (finalPrice !== null && Math.abs(finalPrice - expected) > 0.01) formulaMismatchCount += 1
  }

  console.log('\n[remigrate-source-id] === VALIDATION ===')
  console.log(`PB transactions count: ${pbTransactions.length}`)
  console.log(`PB rows missing metadata.source_id (vs source): ${missingInPb}`)
  console.log(`PB rows missing account_id: ${accountNullCount}`)
  console.log(`PB formula mismatch rows: ${formulaMismatchCount}`)
}

async function main() {
  console.log(`\n[remigrate-source-id] mode=${isApply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`[remigrate-source-id] options: reset=${shouldReset} includeCycles=${includeCycles} strictRelations=${strictRelations} recreateCollection=${recreateCollection} hardResetDomain=${hardResetDomain}`)
  if (onlyId) console.log(`[remigrate-source-id] only-id=${onlyId}`)
  if (limit) console.log(`[remigrate-source-id] limit=${limit}`)

  if (recreateCollection && !isApply) {
    throw new Error('--recreate-collection is destructive and requires --apply')
  }
  if (hardResetDomain && !isApply) {
    throw new Error('--hard-reset-domain is destructive and requires --apply')
  }

  const headers = await pbAuthHeaders()

  if (hardResetDomain) {
    console.log('[remigrate-source-id] hard reset transactions domain enabled (delete/recreate dependent collections + transactions)...')
    await hardResetTransactionsDomain(headers)
  }

  const requiredFields = [
    'date',
    'amount',
    'type',
    'account_id',
    'to_account_id',
    'category_id',
    'shop_id',
    'person_id',
    'parent_transaction_id',
    'final_price',
    'metadata',
  ]

  let recreateSucceeded = false
  if (recreateCollection) {
    console.log('[remigrate-source-id] recreating transactions collection from local schema...')
    try {
      await recreateTransactionsCollection(headers)
      recreateSucceeded = true
    } catch (error) {
      console.warn('[remigrate-source-id] recreate-collection failed, fallback to additive schema sync:', String(error))
    }
  }

  let fieldSet = await pbGetCollectionFields('transactions', headers)
  let missingFields = requiredFields.filter((field) => !fieldSet.has(field))

  if (missingFields.length > 0 && autoSyncTxnSchema && !hardResetDomain) {
    console.log('[remigrate-source-id] missing transaction fields detected, auto-syncing transactions schema...')
    await syncTransactionsSchemaFromLocal(headers)
    fieldSet = await pbGetCollectionFields('transactions', headers)
    missingFields = requiredFields.filter((field) => !fieldSet.has(field))
  }

  if (missingFields.length > 0) {
    throw new Error(
      `transactions collection missing fields: ${missingFields.join(', ')}. ` +
      'Run: node scripts/pocketbase/remigrate-transactions-sourceid-safe.mjs (default auto-sync) or check schema permissions.'
    )
  }

  const resolvers = {
    accounts: await buildResolver('accounts', headers),
    categories: await buildResolver('categories', headers),
    shops: await buildResolver('shops', headers),
    people: await buildResolver('people', headers),
  }

  console.log('[remigrate-source-id] resolver inventory')
  console.log(`- accounts: ${resolvers.accounts.total}`)
  console.log(`- categories: ${resolvers.categories.total}`)
  console.log(`- shops: ${resolvers.shops.total}`)
  console.log(`- people: ${resolvers.people.total}`)

  const source = await fetchSupabaseData()

  const existingTransactions = await pbListAll('transactions', headers, 'id,metadata')
  const existingTxnBySourceId = new Map()
  const existingTxnIdSet = new Set(existingTransactions.map((item) => item.id))

  for (const item of existingTransactions) {
    const sourceId = item?.metadata && typeof item.metadata === 'object' ? item.metadata.source_id : null
    if (sourceId) existingTxnBySourceId.set(String(sourceId), item.id)
  }

  const { payloads, unresolved, skipped, formulaMismatches } = buildTransactionPayloads({
    transactions: source.transactions,
    accountStatementMap: source.accountStatementMap,
    resolvers,
    existingTxnBySourceId,
    existingTxnIdSet,
    transactionFieldSet: fieldSet,
  })

  console.log('[remigrate-source-id] transaction planning')
  console.log(`- source rows: ${source.transactions.length}`)
  console.log(`- to process: ${payloads.length}`)
  console.log(`- skipped: ${skipped.length}`)
  summarizeMap(unresolved.account, 'unresolved account_id')
  summarizeMap(unresolved.toAccount, 'unresolved target_account_id')
  summarizeMap(unresolved.category, 'unresolved category_id')
  summarizeMap(unresolved.shop, 'unresolved shop_id')
  summarizeMap(unresolved.person, 'unresolved person_id')
  summarizeMap(unresolved.parent, 'unresolved parent_transaction_id')

  if (formulaMismatches.length > 0) {
    console.log(`[remigrate-source-id] formula mismatch warnings: ${formulaMismatches.length}`)
    for (const item of formulaMismatches.slice(0, 20)) {
      console.log(`  • ${item.sourceId} final=${item.finalPrice} expected=${item.expectedFinal}`)
    }
  }

  let transactionsDeleted = 0
  let cyclesDeleted = 0
  let created = 0
  let updated = 0
  let cyclesCreated = 0

  if (!isApply) {
    printSummary({
      totalSourceTransactions: source.transactions.length,
      skipped: skipped.length,
      created,
      updated,
      cyclesCreated,
      cyclesDeleted,
      transactionsDeleted,
      formulaMismatches: formulaMismatches.length,
      unresolvedRelations:
        unresolved.account.size +
        unresolved.toAccount.size +
        unresolved.category.size +
        unresolved.shop.size +
        unresolved.person.size +
        unresolved.parent.size,
    })
    console.log('\n[remigrate-source-id] DRY-RUN done. Re-run with --apply to write changes.')
    return
  }

  if (shouldReset) {
    if (includeCycles) {
      cyclesDeleted = await pbDeleteAll('cashback_cycles', headers)
    }
    transactionsDeleted = await pbDeleteAll('transactions', headers)
  }

  const seenIds = new Set()
  for (const item of payloads) {
    if (seenIds.has(item.pbId)) {
      throw new Error(`Duplicate PB id generated: ${item.pbId} for source ${item.sourceId}`)
    }
    seenIds.add(item.pbId)

    const existedBefore = existingTxnBySourceId.has(item.sourceId)

    if (shouldReset || !existedBefore) {
      await pbCreate('transactions', item.pbId, item.body, headers)
      created += 1
    } else {
      await pbPatch('transactions', item.pbId, item.body, headers)
      updated += 1
    }
  }

  if (includeCycles) {
    for (const cycle of source.cycles) {
      const accountId = resolvers.accounts.resolve(cycle.account_id)
      if (!accountId && strictRelations) continue

      const cycleId = toPocketBaseId(cycle.id, 'cashback_cycles')
      const body = {
        account_id: accountId,
        cycle_tag: cycle.cycle_tag,
        spent_amount: Number(cycle.spent_amount || 0),
        real_awarded: Number(cycle.real_awarded || 0),
        virtual_profit: Number(cycle.virtual_profit || 0),
        max_budget: cycle.max_budget == null ? null : Number(cycle.max_budget),
        min_spend_target: cycle.min_spend_target == null ? null : Number(cycle.min_spend_target),
        is_exhausted: Boolean(cycle.is_exhausted || false),
        met_min_spend: Boolean(cycle.met_min_spend || false),
        overflow_loss: cycle.overflow_loss == null ? null : Number(cycle.overflow_loss),
      }

      await pbCreate('cashback_cycles', cycleId, body, headers)
      cyclesCreated += 1
    }
  }

  const unresolvedRelations =
    unresolved.account.size +
    unresolved.toAccount.size +
    unresolved.category.size +
    unresolved.shop.size +
    unresolved.person.size +
    unresolved.parent.size

  printSummary({
    totalSourceTransactions: source.transactions.length,
    skipped: skipped.length,
    created,
    updated,
    cyclesCreated,
    cyclesDeleted,
    transactionsDeleted,
    formulaMismatches: formulaMismatches.length,
    unresolvedRelations,
  })

  await validateAfterApply(headers, source.transactions)

  if (recreateCollection && !recreateSucceeded) {
    console.log('[remigrate-source-id] note: collection recreate was skipped due cross-collection references; remigration completed in fallback mode.')
  }
}

main().catch((error) => {
  console.error('[remigrate-source-id] fatal:', error)
  process.exit(1)
})
