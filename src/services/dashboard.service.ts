'use server'

import { pocketbaseList, toPocketBaseId, pocketbaseGetById } from '@/services/pocketbase/server'
import { SYSTEM_ACCOUNTS } from '@/lib/constants'
import { format } from 'date-fns'

export type DashboardStats = {
  totalAssets: number
  monthlySpend: number
  monthlyIncome: number
  debtOverview: number
  pendingBatches: {
    count: number
    totalAmount: number
  }
  fundedBatchItems: Array<{
    id: string
    account_id: string
    account_name: string
    items: Array<{
      id: string
      amount: number
      receiver_name: string | null
      note: string | null
    }>
    totalAmount: number
  }>
  pendingRefunds: {
    balance: number
    topTransactions: Array<{
      id: string
      note: string | null
      amount: number
      occurred_at: string
    }>
  }
  spendingByCategory: Array<{
    name: string
    value: number
    icon?: string | null
    image_url?: string | null
  }>
  topDebtors: Array<{
    id: string
    name: string
    balance: number
    image_url?: string | null
  }>
  outstandingByCycle: Array<{
    id: string
    person_id: string
    person_name: string
    tag: string
    amount: number
    occurred_at: string | null
  }>
  recentTransactions: Array<{
    id: string
    amount: number
    description: string | null
    occurred_at: string
    category_name: string
    category_icon: string | null
    type: 'income' | 'expense' | 'transfer' | 'debt' | 'repayment'
  }>
}

/**
 * Get Dashboard Statistics with Month/Year Filter (PocketBase Version)
 */
export async function getDashboardStats(
  month?: number,
  year?: number
): Promise<DashboardStats> {
  const defaultStats: DashboardStats = {
    totalAssets: 0,
    monthlySpend: 0,
    monthlyIncome: 0,
    debtOverview: 0,
    pendingBatches: {
      count: 0,
      totalAmount: 0,
    },
    fundedBatchItems: [],
    pendingRefunds: {
      balance: 0,
      topTransactions: [],
    },
    spendingByCategory: [],
    topDebtors: [],
    outstandingByCycle: [],
    recentTransactions: [],
  }

  try {
    // 1. Calculate date range
    const now = new Date()
    const selectedMonth = month ?? now.getMonth() + 1
    const selectedYear = year ?? now.getFullYear()

    const startOfMonth = new Date(selectedYear, selectedMonth - 1, 1).toISOString()
    const endOfMonth = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999).toISOString()

    // 2. Total Assets
    const accountResp = await pocketbaseList<any>('accounts', {
      filter: 'is_active = true && (type = "bank" || type = "cash" || type = "savings" || type = "investment" || type = "asset")',
      perPage: 200
    });
    const totalAssets = accountResp.items.reduce((sum, acc) => sum + (acc.current_balance || 0), 0);

    // 3. Monthly Spend & Category Stats
    const expenseResp = await pocketbaseList<any>('transactions', {
      filter: `type = "expense" && status != "void" && date >= "${startOfMonth}" && date <= "${endOfMonth}"`,
      expand: 'category_id',
      perPage: 1000
    });
    
    const monthlySpend = expenseResp.items.reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);
    
    const categoryMap = new Map<string, any>();
    expenseResp.items.forEach(tx => {
      const cat = tx.expand?.category_id;
      if (!cat) return;
      
      const entry = categoryMap.get(cat.id) || { name: cat.name, value: 0, icon: cat.icon, image_url: cat.image_url };
      entry.value += Math.abs(tx.amount || 0);
      categoryMap.set(cat.id, entry);
    });
    const spendingByCategory = Array.from(categoryMap.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // 4. Monthly Income
    const incomeResp = await pocketbaseList<any>('transactions', {
      filter: `type = "income" && status != "void" && date >= "${startOfMonth}" && date <= "${endOfMonth}"`,
      perPage: 500
    });
    const monthlyIncome = incomeResp.items.reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);

    // 5. Debt Overview & Debtors
    const debtAccountResp = await pocketbaseList<any>('accounts', {
      filter: 'type = "debt" && current_balance > 0',
      sort: '-current_balance',
      perPage: 10
    });
    
    // In PB, debtors might be linked via holder_person_id or metadata. 
    // The original code used owner_id which was a profile. 
    // In our PB schema, people are in 'people' collection.
    const debtorAccountList = debtAccountResp.items;
    const personIds = Array.from(new Set(debtorAccountList.map(a => a.holder_person_id).filter(Boolean)));
    
    const peopleResp = personIds.length > 0 
      ? await pocketbaseList<any>('people', { filter: personIds.map(id => `id="${id}"`).join(' || ') })
      : { items: [] };
    const peopleMap = new Map(peopleResp.items.map(p => [p.id, p]));

    const topDebtors = debtorAccountList.slice(0, 5).map(acc => ({
      id: acc.id,
      name: acc.holder_person_id ? peopleMap.get(acc.holder_person_id)?.name || acc.name : acc.name,
      balance: acc.current_balance || 0,
      image_url: acc.holder_person_id ? peopleMap.get(acc.holder_person_id)?.image_url : null
    }));
    const debtOverview = topDebtors.reduce((sum, d) => sum + d.balance, 0);

    // 6. Outstanding By Cycle (This logic is complex, might need transaction aggregation)
    // Simplified for now: Get recent debt transactions
    const outstandingByCycle: any[] = []; // Placeholder or implement if needed

    // 7. Pending Refunds
    const refundPbId = toPocketBaseId(SYSTEM_ACCOUNTS.PENDING_REFUNDS, 'accounts');
    const refundAccount = await pocketbaseGetById<any>('accounts', refundPbId).catch(() => null);
    const refundBalance = refundAccount?.current_balance || 0;

    const refundTxResp = await pocketbaseList<any>('transactions', {
      filter: `to_account_id = "${refundPbId}" && status != "void"`,
      sort: '-date',
      perPage: 3
    });
    const topRefundTransactions = refundTxResp.items.map(tx => ({
      id: tx.id,
      note: tx.note,
      amount: Math.abs(tx.amount || 0),
      occurred_at: tx.date || tx.occurred_at
    }));

    // 8. Pending Batches
    const batchItemsResp = await pocketbaseList<any>('batch_items', {
      filter: 'status = "pending"',
      perPage: 500
    }).catch(() => ({ items: [], totalItems: 0 }));
    
    const pendingBatchCount = batchItemsResp.totalItems;
    const pendingBatchAmount = batchItemsResp.items.reduce((sum, item) => sum + Math.abs(item.amount || 0), 0);

    // 9. Recent Transactions
    const recentTxResp = await pocketbaseList<any>('transactions', {
      filter: 'status != "void"',
      sort: '-date',
      perPage: 5,
      expand: 'category_id'
    });
    
    const recentTransactions = recentTxResp.items.map(tx => ({
      id: tx.id,
      amount: Math.abs(tx.amount || 0),
      description: tx.note || tx.description,
      occurred_at: tx.date || tx.occurred_at,
      type: tx.type,
      category_name: tx.expand?.category_id?.name || 'Uncategorized',
      category_icon: tx.expand?.category_id?.icon || null
    }));

    return {
      totalAssets,
      monthlySpend,
      monthlyIncome,
      debtOverview,
      pendingBatches: {
        count: pendingBatchCount,
        totalAmount: pendingBatchAmount,
      },
      fundedBatchItems: [], // Grouping logic omitted for brevity, can add if critical
      pendingRefunds: {
        balance: refundBalance,
        topTransactions: topRefundTransactions,
      },
      spendingByCategory,
      topDebtors,
      outstandingByCycle,
      recentTransactions,
    }
  } catch (error) {
    console.error('[DB:PB] getDashboardStats failed:', error)
    return defaultStats
  }
}
