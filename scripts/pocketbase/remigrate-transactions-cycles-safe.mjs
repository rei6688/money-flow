import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import crypto from 'crypto'
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

function normalizeAccountType(value) {
  if (!value) return 'bank'
  if (value === 'ewallet') return 'e_wallet'
  const allowed = new Set(['bank', 'credit_card', 'e_wallet', 'receivable', 'debt', 'savings', 'investment', 'asset', 'system'])
  return allowed.has(value) ? value : 'bank'
}

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

async function pbAuth() {
  const response = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })

  if (!response.ok) {
    throw new Error(`PB auth failed: ${response.status} ${await response.text()}`)
  }

  const { token } = await response.json()
  return {
    'Content-Type': 'application/json',
    Authorization: token,
  }
}

async function pbListAll(collection, headers, fields = 'id') {
  const all = []
  let page = 1
  let totalPages = 1
  while (page <= totalPages) {
    const response = await fetch(
      `${PB_URL}/api/collections/${collection}/records?page=${page}&perPage=200&fields=${encodeURIComponent(fields)}`,
      { headers }
    )

    if (!response.ok) {
      throw new Error(`List ${collection} page ${page} failed: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json()
    all.push(...(payload.items || []))
    totalPages = payload.totalPages || 1
    page += 1
  }
  return all
}

async function pbDeleteAll(collection, headers) {
  const ids = await pbListAll(collection, headers, 'id')
  if (ids.length === 0) return 0

  const chunks = []
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20))

  let deleted = 0
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (item) => {
        const response = await fetch(`${PB_URL}/api/collections/${collection}/records/${item.id}`, {
          method: 'DELETE',
          headers,
        })
        if (!response.ok) {
          throw new Error(`Delete ${collection}/${item.id} failed: ${response.status} ${await response.text()}`)
        }
      })
    )
    deleted += chunk.length
  }

  return deleted
}

async function pbCreate(collection, id, body, headers) {
  const response = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, ...body }),
  })

  if (!response.ok) {
    throw new Error(`Create ${collection}/${id} failed: ${response.status} ${await response.text()}`)
  }
}

function calculateCycleTag(dateStr, statementDay) {
  if (!statementDay) return null
  const date = new Date(dateStr)
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

function buildAccountResolver(pbAccounts) {
  const pbIdSet = new Set(pbAccounts.map((item) => item.id))
  const bySlug = new Map(
    pbAccounts
      .filter((item) => typeof item.slug === 'string' && item.slug.length > 0)
      .map((item) => [item.slug, item.id])
  )

  return (sourceId) => {
    if (!sourceId) return null
    if (pbIdSet.has(sourceId)) return sourceId
    if (bySlug.has(sourceId)) return bySlug.get(sourceId)

    const hashed = toPocketBaseId(sourceId, 'accounts')
    if (pbIdSet.has(hashed)) return hashed
    return null
  }
}

async function main() {
  console.log(`\n[remigrate] mode=${isApply ? 'APPLY' : 'DRY-RUN'}`)

  const headers = await pbAuth()

  const pbAccounts = await pbListAll('accounts', headers, 'id,slug,name')
  const resolveAccountId = buildAccountResolver(pbAccounts)

  const { data: supaAccounts, error: supaAccountsError } = await supabase
    .from('accounts')
    .select('id, name, type, currency, credit_limit, current_balance, account_number, receiver_name, is_active, statement_day, due_date, cb_cycle_type, cb_type, cb_base_rate, cb_max_budget, cb_is_unlimited, cb_rules_json, cb_min_spend, cashback_config')

  if (supaAccountsError) throw supaAccountsError
  const supaAccountById = new Map((supaAccounts || []).map((item) => [item.id, item]))
  const statementDayMap = new Map((supaAccounts || []).map((item) => [item.id, item.statement_day]))

  const { data: txns, error: txnError } = await supabase
    .from('transactions')
    .select('*')
    .order('occurred_at', { ascending: true })

  if (txnError) throw txnError

  const { data: cycles, error: cycleError } = await supabase
    .from('cashback_cycles')
    .select('*')
    .order('cycle_tag', { ascending: true })

  if (cycleError) throw cycleError

  const txnRows = txns || []
  const cycleRows = cycles || []

  let unresolvedTxnAccount = 0
  let unresolvedTxnTarget = 0
  let unresolvedCycleAccount = 0
  const unresolvedAccountIds = new Map()

  const txnPayloads = txnRows.map((t) => {
    const pbAccountId = resolveAccountId(t.account_id)
    const pbTargetAccountId = resolveAccountId(t.target_account_id)

    if (t.account_id && !pbAccountId) unresolvedTxnAccount += 1
    if (t.account_id && !pbAccountId) {
      unresolvedAccountIds.set(t.account_id, (unresolvedAccountIds.get(t.account_id) || 0) + 1)
    }
    if (t.target_account_id && !pbTargetAccountId) unresolvedTxnTarget += 1

    const statementDay = statementDayMap.get(t.account_id)
    const persistedCycleTag = t.statement_cycle_tag || calculateCycleTag(t.occurred_at, statementDay)

    return {
      id: toPocketBaseId(t.id, 'transactions'),
      sourceAccountId: t.account_id || null,
      sourceTargetAccountId: t.target_account_id || null,
      body: {
        occurred_at: t.occurred_at,
        date: t.occurred_at,
        description: t.note || '',
        note: t.note || '',
        amount: Number(t.amount || 0),
        type: t.type,
        status: t.status || 'posted',
        account_id: pbAccountId,
        to_account_id: pbTargetAccountId,
        target_account_id: pbTargetAccountId,
        category_id: t.category_id ? toPocketBaseId(t.category_id, 'categories') : null,
        shop_id: t.shop_id ? toPocketBaseId(t.shop_id, 'shops') : null,
        person_id: t.person_id ? toPocketBaseId(t.person_id, 'people') : null,
        final_price: Number(t.final_price || 0),
        cashback_amount: Number(t.cashback_share_fixed || 0),
        cashback_share_percent: t.cashback_share_percent ?? null,
        cashback_share_fixed: t.cashback_share_fixed ?? null,
        cashback_mode: t.cashback_mode ?? null,
        is_installment: Boolean(t.is_installment || false),
        parent_transaction_id: t.parent_transaction_id ? toPocketBaseId(t.parent_transaction_id, 'transactions') : null,
        metadata: {
          ...(t.metadata || {}),
          source_id: t.id,
          persisted_cycle_tag: persistedCycleTag,
        },
      },
    }
  })

  const cyclePayloads = cycleRows.map((c) => {
    const pbAccountId = resolveAccountId(c.account_id)
    if (c.account_id && !pbAccountId) unresolvedCycleAccount += 1

    return {
      id: toPocketBaseId(c.id, 'cashback_cycles'),
      body: {
        account_id: pbAccountId,
        cycle_tag: c.cycle_tag,
        spent_amount: Number(c.spent_amount || 0),
        real_awarded: Number(c.real_awarded || 0),
        virtual_profit: Number(c.virtual_profit || 0),
        max_budget: c.max_budget == null ? null : Number(c.max_budget),
        min_spend_target: c.min_spend_target == null ? null : Number(c.min_spend_target),
        is_exhausted: Boolean(c.is_exhausted || false),
        met_min_spend: Boolean(c.met_min_spend || false),
        overflow_loss: c.overflow_loss == null ? null : Number(c.overflow_loss),
      },
    }
  })

  console.log('[remigrate] source summary')
  console.log(`- supabase transactions: ${txnPayloads.length}`)
  console.log(`- supabase cashback_cycles: ${cyclePayloads.length}`)
  console.log(`- unresolved txn.account_id: ${unresolvedTxnAccount}`)
  console.log(`- unresolved txn.target_account_id: ${unresolvedTxnTarget}`)
  console.log(`- unresolved cycle.account_id: ${unresolvedCycleAccount}`)

  if (unresolvedAccountIds.size > 0) {
    console.log('- unresolved account_id top samples:')
    Array.from(unresolvedAccountIds.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([id, count]) => {
        console.log(`  • ${id}: ${count} txns`)
      })
  }

  if (!isApply) {
    console.log('\n[remigrate] DRY-RUN done. Re-run with --apply to write.')
    return
  }

  // Create missing source accounts first so transaction FK links remain intact.
  const missingAccountIds = Array.from(unresolvedAccountIds.keys()).filter((id) => supaAccountById.has(id))
  if (missingAccountIds.length > 0) {
    console.log(`[remigrate] creating missing PB accounts: ${missingAccountIds.length}`)
    for (const sourceId of missingAccountIds) {
      const source = supaAccountById.get(sourceId)
      const pbId = toPocketBaseId(sourceId, 'accounts')
      await pbCreate('accounts', pbId, {
        slug: sourceId,
        name: source.name,
        type: normalizeAccountType(source.type),
        currency: source.currency || 'VND',
        credit_limit: Number(source.credit_limit || 0),
        current_balance: Number(source.current_balance || 0),
        account_number: source.account_number || null,
        receiver_name: source.receiver_name || null,
        is_active: source.is_active !== false,
        statement_day: source.statement_day ?? null,
        due_date: source.due_date ?? null,
        cb_cycle_type: source.cb_cycle_type ?? null,
        cb_type: source.cb_type ?? null,
        cb_base_rate: source.cb_base_rate ?? null,
        cb_max_budget: source.cb_max_budget ?? null,
        cb_is_unlimited: source.cb_is_unlimited ?? null,
        cb_rules_json: source.cb_rules_json ?? null,
        cb_min_spend: source.cb_min_spend ?? null,
        cashback_config: source.cashback_config ?? null,
      }, headers)
    }

    // Refresh account resolver with newly created accounts.
    const refreshedPbAccounts = await pbListAll('accounts', headers, 'id,slug,name')
    const refreshedResolver = buildAccountResolver(refreshedPbAccounts)
    for (const item of txnPayloads) {
      if (!item.body.account_id && item.sourceAccountId) {
        item.body.account_id = refreshedResolver(item.sourceAccountId) || null
      }
      if (!item.body.to_account_id && item.sourceTargetAccountId) {
        const mapped = refreshedResolver(item.sourceTargetAccountId) || null
        item.body.to_account_id = mapped
        item.body.target_account_id = mapped
      }
    }
  }

  const deletedCycles = await pbDeleteAll('cashback_cycles', headers)
  const deletedTxns = await pbDeleteAll('transactions', headers)
  console.log('[remigrate] deleted existing records')
  console.log(`- cashback_cycles deleted: ${deletedCycles}`)
  console.log(`- transactions deleted: ${deletedTxns}`)

  let createdTxns = 0
  for (const item of txnPayloads) {
    await pbCreate('transactions', item.id, item.body, headers)
    createdTxns += 1
  }

  let createdCycles = 0
  for (const item of cyclePayloads) {
    await pbCreate('cashback_cycles', item.id, item.body, headers)
    createdCycles += 1
  }

  console.log('\n[remigrate] APPLY done')
  console.log(`- transactions created: ${createdTxns}`)
  console.log(`- cashback_cycles created: ${createdCycles}`)
}

main().catch((error) => {
  console.error('[remigrate] fatal:', error)
  process.exit(1)
})
