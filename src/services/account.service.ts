'use server'

import { revalidatePath } from 'next/cache'
import { Account, AccountRelationships, AccountStats, TransactionWithDetails, AccountRow } from '@/types/moneyflow.types'
import { executeWithFallback } from '@/lib/pocketbase/fallback-helpers'
import {
  updatePocketBaseAccountConfig,
  updatePocketBaseAccountInfo,
  loadPocketBaseTransactionsForAccount
} from '@/services/pocketbase/account-details.service'
import {
  pocketbaseGetById,
  pocketbaseList,
  toPocketBaseId,
  pocketbaseCreate,
  pocketbaseUpdate,
  pocketbaseDelete
} from "./pocketbase/server";
import {
  parseCashbackConfig,
  normalizeCashbackConfig,
  getCashbackCycleRange,
  calculateBankCashback,
  formatIsoCycleTag,
  formatLegacyCycleTag
} from '@/lib/cashback'
import { computeAccountTotals, getCreditCardAvailableBalance, getCreditCardUsage } from '@/lib/account-balance'
import {
  mapUnifiedTransaction
} from '@/lib/transaction-mapper'
import { Database, Json } from '@/types/database.types'
import { mapPocketBaseAccountRow } from './pocketbase/mappers'



function parseJsonSafe(value: Json | null): Json | null {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (parseError) {
      console.error('Failed to parse JSON string:', parseError)
      return null
    }
  }

  return value
}



const fmtDate = (d: Date) => {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(d)
}

// getSupabaseAccountRows removed


async function getPocketBaseAccountRows(): Promise<AccountRow[]> {
  try {
    const response = await pocketbaseList<any>('accounts', {
      perPage: 200,
      sort: 'name'
    });
    return response.items.map(mapPocketBaseAccountRow);
  } catch (error) {
    console.error('[DB:PB] accounts.list failed:', error);
    return [];
  }
}

async function getStatsForAccount(account: AccountRow): Promise<AccountStats | null> {
  const creditLimit = account.credit_limit ?? 0
  const currentBalance = account.current_balance ?? 0

  const usage_percent = account.type === 'credit_card'
    ? getCreditCardUsage({
      type: account.type,
      credit_limit: creditLimit,
      current_balance: currentBalance,
    }).percent
    : 0

  const remaining_limit = account.type === 'credit_card'
    ? getCreditCardAvailableBalance({
      type: account.type,
      credit_limit: creditLimit,
      current_balance: currentBalance,
    })
    : currentBalance

  const baseStats: AccountStats = {
    usage_percent,
    remaining_limit,
    spent_this_cycle: 0,
    min_spend: null,
    missing_for_min: null,
    is_qualified: false,
    cycle_range: "",
    due_date_display: null,
    due_date: null,
    remains_cap: null,
    shared_cashback: null
  }

  const hasConfig = account.cashback_config || (account as any).cb_type !== 'none';
  if (!hasConfig) return baseStats

  const config = normalizeCashbackConfig(account.cashback_config, account)
  if (!config) return baseStats

  const now = new Date()
  const explicitCycleType = (account as any).cb_cycle_type || config.cycleType;
  const cycleRange = getCashbackCycleRange({ ...config, cycleType: explicitCycleType }, now)
  if (!cycleRange) return baseStats
  const { start, end } = cycleRange

  const tagDate = cycleRange.end
  const cycleTag = formatIsoCycleTag(tagDate)

  // Fetch Cycle from PB
  const cycleResp = await pocketbaseList<any>('cashback_cycles', {
      filter: `account_id = "${account.id}" && cycle_tag = "${cycleTag}"`,
      perPage: 1
  });
  const cycle = cycleResp.items[0] || null;

  let spent_this_cycle = cycle?.spent_amount ?? 0
  let real_awarded = cycle?.real_awarded ?? 0
  const virtual_profit = cycle?.virtual_profit ?? 0

  // Fallback for real_awarded (Income)
  if (real_awarded === 0) {
      const incomeResp = await pocketbaseList<any>('transactions', {
          filter: `account_id = "${account.id}" && type = "income" && status = "posted" && persisted_cycle_tag = "${cycleTag}"`,
          perPage: 50
      });
      real_awarded = incomeResp.items.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
  }

  let remains_cap: number | null = null
  if (cycle) {
    const maxBudget = cycle.max_budget ?? null
    if (maxBudget !== null) {
      const consumed = real_awarded + virtual_profit
      remains_cap = Math.max(0, maxBudget - consumed)
    }
  }

  const min_spend = cycle ? (cycle.min_spend_target ?? null) : config.minSpendTarget
  const missing_for_min = (min_spend !== null) ? Math.max(0, min_spend - spent_this_cycle) : null
  const is_qualified = cycle?.met_min_spend ?? (min_spend !== null && spent_this_cycle >= min_spend)

  return {
    ...baseStats,
    spent_this_cycle,
    min_spend,
    missing_for_min,
    is_qualified,
    cycle_range: (start && end) ? `${fmtDate(start)} - ${fmtDate(end)}` : "",
    remains_cap,
    shared_cashback: real_awarded,
    real_awarded,
    virtual_profit,
    annual_fee_waiver_target: account.annual_fee_waiver_target ?? config.minSpendTarget ?? null,
    annual_fee_waiver_progress: 0,
    annual_fee_waiver_met: false,
    max_budget: cycle?.max_budget ?? config.maxBudget ?? null
  }
}



export async function getAccounts(): Promise<Account[]> {
  console.log('[DB:PB] accounts.getAll')
  const rows = await getPocketBaseAccountRows();

  const childrenMap = new Map<string, AccountRow[]>()
  const accountMap = new Map<string, AccountRow>()

  rows.forEach(row => accountMap.set(row.id, row))
  rows.forEach(row => {
    if (row.parent_account_id) {
      if (!childrenMap.has(row.parent_account_id)) childrenMap.set(row.parent_account_id, [])
      if (accountMap.has(row.parent_account_id)) childrenMap.get(row.parent_account_id)!.push(row)
    }
  })

  const accounts: Account[] = []
  for (const item of rows) {
    const stats = await getStatsForAccount(item)

    const childRows = childrenMap.get(item.id) || []
    const parentRow = item.parent_account_id ? accountMap.get(item.parent_account_id) : null

    const relationships: AccountRelationships = {
      is_parent: childRows.length > 0,
      child_count: childRows.length,
      child_accounts: childRows.map(c => ({ id: c.id, name: c.name, image_url: c.image_url })),
      parent_info: parentRow ? { id: parentRow.id, name: parentRow.name, type: parentRow.type, image_url: parentRow.image_url } : null
    }

    accounts.push({
      id: item.id,
      name: item.name,
      type: item.type,
      currency: item.currency ?? 'VND',
      current_balance: item.current_balance ?? 0,
      credit_limit: item.credit_limit ?? 0,
      owner_id: item.owner_id ?? '',
      account_number: item.account_number ?? null,
      receiver_name: item.receiver_name ?? null,
      parent_account_id: item.parent_account_id ?? null,
      secured_by_account_id: item.secured_by_account_id ?? null,
      cb_type: (item as any).cb_type ?? 'none',
      cb_base_rate: (item as any).cb_base_rate ?? 0,
      cb_max_budget: (item as any).cb_max_budget ?? null,
      cb_is_unlimited: (item as any).cb_is_unlimited ?? false,
      cb_rules_json: parseJsonSafe((item as any).cb_rules_json),
      cb_min_spend: (item as any).cb_min_spend ?? null,
      cb_cycle_type: (item as any).cb_cycle_type ?? 'calendar_month',
      statement_day: (item as any).statement_day ?? null,
      due_date: (item as any).due_date ?? null,
      holder_type: (item as any).holder_type ?? 'me',
      holder_person_id: (item as any).holder_person_id ?? null,
      cashback_config: normalizeCashbackConfig(item.cashback_config),
      is_active: typeof item.is_active === 'boolean' ? item.is_active : null,
      image_url: typeof item.image_url === 'string' ? item.image_url : null,
      total_in: item.total_in ?? 0,
      total_out: item.total_out ?? 0,
      stats,
      relationships, // Added field
      credit_card_info: (() => {
        const config = normalizeCashbackConfig(item.cashback_config) as any
        if (!config) return undefined
        return {
          statement_day: (item as any).statement_day ?? config.statementDay ?? config.statement_day,
          payment_due_day: (item as any).due_date ?? config.paymentDueDay ?? config.payment_due_day ?? config.dueDate
        }
      })(),
    })
  }

  // 3. Sorting Logic
  // Priority: 
  // 1. Due Date (ASC) - Nearest first
  // 2. Cashback Need (DESC) - Highest missing_for_min first
  // 3. Name (ASC)

  return accounts.sort((a, b) => {
    // Helper to get sortable date timestamp
    const getDueDateTs = (acc: Account) => {
      if (!acc.stats?.due_date_display) return 9999999999999 // Far future

      const [day, month] = acc.stats.due_date_display.split('/').map(Number)
      const now = new Date()
      const currentYear = now.getFullYear()
      const date = new Date(currentYear, month - 1, day)

      // If date is in the past (e.g. today is Dec 15, due date Dec 10), assume next year?
      // Actually due date usually means upcoming due date. 
      // If getStats calculated it, it's relative to current cycle end.
      // Let's assume the year is current year, or next year if month < current month?
      // Simple heuristic: if month < now.month - 1, it's next year.
      if (date.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
        date.setFullYear(currentYear + 1)
      }
      return date.getTime()
    }

    const dueA = getDueDateTs(a)
    const dueB = getDueDateTs(b)
    if (dueA !== dueB) return dueA - dueB

    // Cashback Need (DESC)
    const missA = a.stats?.missing_for_min ?? 0
    const missB = b.stats?.missing_for_min ?? 0
    if (missA !== missB) return missB - missA // Highest missing first

    // Name (ASC)
    return a.name.localeCompare(b.name)
  })
}

export async function getAccountDetails(id: string): Promise<Account | null> {
  if (!id || id === 'add' || id === 'new' || id === 'undefined') return null;
  console.log('[DB:PB] accounts.getDetails', { id });

  const mapAccountRowToDetails = (row: AccountRow): Account => ({
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency ?? 'VND',
    current_balance: row.current_balance ?? 0,
    credit_limit: row.credit_limit ?? 0,
    owner_id: row.owner_id ?? '',
    account_number: row.account_number ?? null,
    receiver_name: row.receiver_name ?? null,
    secured_by_account_id: row.secured_by_account_id ?? null,
    parent_account_id: row.parent_account_id ?? null,
    cashback_config: normalizeCashbackConfig(row.cashback_config),
    cashback_config_version: row.cashback_config_version ?? 1,
    is_active: typeof row.is_active === 'boolean' ? row.is_active : null,
    image_url: typeof row.image_url === 'string' ? row.image_url : null,
    total_in: row.total_in ?? 0,
    total_out: row.total_out ?? 0,
    annual_fee: row.annual_fee ?? null,
    annual_fee_waiver_target: row.annual_fee_waiver_target ?? null,
    cb_type: row.cb_type ?? 'none',
    cb_base_rate: row.cb_base_rate ?? 0,
    cb_max_budget: row.cb_max_budget ?? null,
    cb_is_unlimited: row.cb_is_unlimited ?? false,
    cb_rules_json: parseJsonSafe(row.cb_rules_json),
    cb_min_spend: row.cb_min_spend ?? null,
    cb_cycle_type: row.cb_cycle_type ?? 'calendar_month',
    statement_day: row.statement_day ?? null,
    due_date: row.due_date ?? null,
    holder_type: (row as any).holder_type ?? 'me',
    holder_person_id: (row as any).holder_person_id ?? null
  });

  try {
    const record = await pocketbaseGetById<any>('accounts', id);
    if (!record) return null;
    return mapAccountRowToDetails(mapPocketBaseAccountRow(record));
  } catch (err) {
    console.error('[DB:PB] getAccountDetails failed:', err);
    return null;
  }
}




// GroupedTransactionLines removed as lines are deprecated







async function fetchTransactions(
  accountId: string,
  limit: number,
): Promise<TransactionWithDetails[]> {
  try {
    const pbAccountId = toPocketBaseId(accountId, 'accounts');
    const response = await pocketbaseList<any>('transactions', {
      filter: `account_id = "${pbAccountId}" || target_account_id = "${pbAccountId}"`,
      sort: '-occurred_at',
      perPage: limit,
      expand: 'account_id,target_account_id,category_id,shop_id,person_id'
    });

    // Reuse mapPocketBaseTransaction from account-details.service if available, 
    // but here we might need a general mapper. 
    // Since loadPocketBaseTransactionsForAccount is already exported from account-details.service, 
    // we can use it.
    return loadPocketBaseTransactionsForAccount(accountId, limit);
  } catch (err) {
    console.error('[DB:PB] fetchTransactions failed:', err);
    return [];
  }
}

export async function getAccountTransactions(
  accountId: string,
  limit = 20
): Promise<TransactionWithDetails[]> {
  console.log('[DB:PB] accounts.getTransactions', { accountId, limit })
  return fetchTransactions(accountId, limit)
}

export async function updateAccountConfig(
  accountId: string,
  data: {
    name?: string
    credit_limit?: number | null
    cashback_config?: Json | null
    type?: Account['type']
    secured_by_account_id?: string | null
    is_active?: boolean | null
    image_url?: string | null
    annual_fee?: number | null
    annual_fee_waiver_target?: number | null
    parent_account_id?: string | null
    account_number?: string | null
    receiver_name?: string | null
    cb_type?: 'none' | 'simple' | 'tiered'
    cb_base_rate?: number
    cb_max_budget?: number | null
    cb_is_unlimited?: boolean
    cb_rules_json?: Json | null
    cb_min_spend?: number | null
    cb_cycle_type?: 'calendar_month' | 'statement_cycle'
    statement_day?: number | null
    due_date?: number | null
    holder_type?: 'me' | 'relative' | 'other'
    holder_person_id?: string | null
  }
): Promise<boolean> {
  if (accountId === 'new') return false
  const pbId = toPocketBaseId(accountId, 'accounts')
  console.log('[DB:PB] accounts.updateConfig', { id: pbId })

  try {
    const payload: any = { ...data }
    
    // MF5.3 Compatibility Mapping
    if (data.secured_by_account_id) payload.secured_by_account_id = toPocketBaseId(data.secured_by_account_id, 'accounts')
    if (data.parent_account_id) payload.parent_account_id = toPocketBaseId(data.parent_account_id, 'accounts')
    if (data.holder_person_id) payload.holder_person_id = toPocketBaseId(data.holder_person_id, 'people')

    await pocketbaseUpdate('accounts', pbId, payload)
    
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${accountId}`)
    return true
  } catch (error) {
    console.error('[DB:PB] updateAccountConfig failed:', error)
    return false
  }
}

export async function getAccountStats(accountId: string) {
  const { getAccountSpendingStatsSnapshot } = await import('@/services/cashback.service')
  const stats = await getAccountSpendingStatsSnapshot(accountId, new Date())

  if (!stats) {
    return null
  }

  const rawPotential = stats.currentSpend * stats.rate
  const cappedPotential =
    typeof stats.maxCashback === 'number'
      ? Math.min(rawPotential, stats.maxCashback)
      : rawPotential

  const potentialProfit =
    typeof stats.potentialProfit === 'number' && Number.isFinite(stats.potentialProfit)
      ? stats.potentialProfit
      : cappedPotential - stats.sharedAmount

  return {
    ...stats,
    potentialProfit,
  }
}

// getAccountTransactionDetails removed

// New implementation of recalculateBalance using PocketBase
export async function recalculateBalance(accountId: string): Promise<boolean> {
  const pbAccountId = toPocketBaseId(accountId, 'accounts')
  console.log('[DB:PB] accounts.recalcBalance', { accountId: pbAccountId })

  // 1. Get account type
  const account = await pocketbaseGetById<any>('accounts', pbAccountId)

  if (!account) {
    console.warn('[PB:Recalc] Account not found:', pbAccountId)
    return false
  }

  // 2. Fetch all transactions for this account (posted, no parent)
  // PerPage=5000 as safety for now. 
  // We use filter for account_id and target_account_id (mapped by migrate to both names)
  const txns = await pocketbaseList('transactions', {
    filter: `status = "posted" && parent_transaction_id = "" && (account_id = "${pbAccountId}" || to_account_id = "${pbAccountId}")`,
    perPage: 5000
  })

  const { totalIn, totalOut, currentBalance } = computeAccountTotals({
      accountId: pbAccountId,
      accountType: (account as any).type as any,
      transactions: (txns.items || []) as any[],
  })

  // 3. Update PB
  try {
    await pocketbaseUpdate('accounts', pbAccountId, {
        current_balance: currentBalance,
        total_in: totalIn,
        total_out: totalOut
    })
  } catch (err) {
    console.error('[DB:PB] accounts.recalcBalance failed:', err)
    return false
  }

  return true
}

// recalculateBalanceWithClient removed

export async function deleteAccount(id: string): Promise<boolean> {
  const pbId = toPocketBaseId(id, 'accounts')
  console.log('[DB:PB] accounts.delete', { id: pbId })
  
  try {
    await pocketbaseDelete('accounts', pbId)
    revalidatePath('/accounts')
    return true
  } catch (err) {
    console.error('[DB:PB] accounts.delete failed:', err)
    return false
  }
}

export async function updateAccountStatus(id: string, isActive: boolean): Promise<boolean> {
  const pbId = toPocketBaseId(id, 'accounts')
  console.log('[DB:PB] accounts.updateStatus', { id: pbId, isActive })

  try {
    await pocketbaseUpdate('accounts', pbId, { is_active: isActive })
    revalidatePath('/accounts')
    return true
  } catch (error) {
    console.error('[DB:PB] updateAccountStatus failed:', error)
    return false
  }
}

export async function getRecentAccountsByTransactions(limit: number = 5): Promise<Account[]> {
  console.log('[DB:PB] accounts.getRecentByTxns', { limit })
  try {
    const txns = await pocketbaseList<any>('transactions', {
      sort: '-occurred_at',
      perPage: 50,
      fields: 'account_id'
    })

    const accountIds = Array.from(new Set(txns.items.map(t => t.account_id).filter(Boolean))).slice(0, limit)
    if (accountIds.length === 0) return []

    const accounts = await Promise.all(accountIds.map(id => getAccountDetails(id as string)))
    return accounts.filter(Boolean) as Account[]
  } catch (err) {
    console.error('[DB:PB] getRecentAccountsByTransactions failed:', err)
    return []
  }
}
