'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import {
  pocketbaseList,
  pocketbaseGetById,
  toPocketBaseId,
  pocketbaseCreate,
  pocketbaseUpdate,
  pocketbaseDelete,
} from '@/services/pocketbase/server'
import {
  getPocketBasePeople,
  createPocketBasePerson,
  updatePocketBasePerson,
  resolvePocketBasePersonRecord,
} from '@/services/pocketbase/people.service'
import { toYYYYMMFromDate, normalizeMonthTag } from '@/lib/month-tag'
import type {
  MonthlyDebtSummary,
  Person as MoneyflowPerson,
  PersonCycleSheet,
} from '@/types/moneyflow.types'

type Person = MoneyflowPerson & { email?: string | null }

/**
 * Revalidate paths related to a person
 * @param personId PocketBase ID or legacy UUID
 */
function revalidatePersonPaths(personId: string | null | undefined) {
  if (!personId) return
  revalidatePath('/people')
  revalidatePath(`/people/${personId}`)
  try {
    const pbId = toPocketBaseId(personId)
    if (pbId && pbId !== personId) {
      revalidatePath(`/people/${pbId}`)
    }
  } catch (e) { /* ignore */ }
}

function calculateFinalPrice(row: any): number {
  if (row.final_price !== undefined && row.final_price !== null) {
    const parsed = Number(row.final_price)
    if (!isNaN(parsed)) return Math.abs(parsed)
  }
  const rawAmount = Math.abs(Number(row.amount || 0))
  const percentVal = Number(row.cashback_share_percent ?? 0)
  const fixedVal = Number(row.cashback_share_fixed ?? 0)
  const normalizedPercent = percentVal > 1 ? percentVal / 100 : percentVal
  const cashback = (rawAmount * normalizedPercent) + fixedVal
  return rawAmount - cashback
}

/**
 * Get all people with their calculated debt stats
 */
export async function getPeople(options?: { includeArchived?: boolean }): Promise<Person[]> {
  console.log('[DB:PB] people.getBatch')
  
  const includeArchived = Boolean(options?.includeArchived)
  
  try {
    // 1. Fetch People from PocketBase
    const people = await getPocketBasePeople()
    const activePeople = includeArchived ? people : people.filter(p => !p.is_archived)
    const personIds = activePeople.map(p => p.id)

    if (personIds.length === 0) return []

    // 2. Fetch Debt Accounts from PocketBase
    const debtAccountsResponse = await pocketbaseList<any>('accounts', {
      filter: `type='debt' && is_active=true`,
      perPage: 200
    })
    const debtAccounts = debtAccountsResponse.items
    const debtAccountToPersonMap = new Map<string, string>()
    debtAccounts.forEach(acc => {
      if (acc.owner_id) debtAccountToPersonMap.set(acc.id, acc.owner_id)
    })

    // 3. Fetch Transactions for Debt Calculation
    // We need both debt/expense (owed) and repayment/income (paid)
    // Filter by person_id or to_account_id being a debt account
    const txnsResponse = await pocketbaseList<any>('transactions', {
       // Note: we fetch more since we need to calculate historical stats
      filter: `(type='debt' || type='expense' || type='repayment' || type='income')`,
      perPage: 2000,
      sort: '-occurred_at'
    })
    const allTxns = txnsResponse.items

    // 4. Calculate Balances
    const personStats = new Map<string, {
      baseLend: number,
      cashback: number,
      repaid: number,
      currentCycleDebt: number,
      outstandingDebt: number, // Total net debt minus current cycle
      totalBalance: number
    }>()
    
    // Cycle Logic
    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const currentMonthTag = toYYYYMMFromDate(now)

    allTxns.forEach(txn => {
      // Skip voided if status is present
      if (txn.status === 'void' || txn.metadata?.status === 'void') return

      const type = String(txn.type || '').toLowerCase()
      
      // Determine which person this belongs to
      let personId: string | null = null
      if (txn.person_id && personIds.includes(txn.person_id)) {
        personId = txn.person_id
      } else {
        const toAccId = txn.to_account_id || txn.target_account_id
        if (toAccId && debtAccountToPersonMap.has(toAccId)) {
          personId = debtAccountToPersonMap.get(toAccId) || null
        }
      }

      if (!personId) return

      // Initialize stats for this person
      if (!personStats.has(personId)) {
        personStats.set(personId, {
          baseLend: 0,
          cashback: 0,
          repaid: 0,
          currentCycleDebt: 0,
          outstandingDebt: 0,
          totalBalance: 0
        })
      }
      
      const stats = personStats.get(personId)!
      const rawAmount = Math.abs(Number(txn.amount || 0))
      
      // Cashback calculation
      const percentVal = Number(txn.cashback_share_percent ?? txn.metadata?.cashback_share_percent ?? 0)
      const fixedVal = Number(txn.cashback_share_fixed ?? txn.metadata?.cashback_share_fixed ?? 0)
      const normalizedPercent = percentVal > 1 ? percentVal / 100 : percentVal
      const cashback = (rawAmount * normalizedPercent) + fixedVal
      
      const netAmount = rawAmount - cashback

      // Cycle identification
      const txnDate = txn.occurred_at || txn.date ? new Date(txn.occurred_at || txn.date) : null
      const tag = txn.tag || txn.metadata?.tag || ''
      const normalizedTag = normalizeMonthTag(tag) ?? tag
      const isCurrentCycle = tag ? (normalizedTag === currentMonthTag) : (txnDate && txnDate >= currentMonthStart)

      if (['debt', 'expense'].includes(type)) {
        // Only count expense if it has person_id (meaning person owes us for this expense)
        if (type === 'expense' && !txn.person_id) return
        
        stats.baseLend += rawAmount
        stats.cashback += cashback
        stats.totalBalance += netAmount

        if (isCurrentCycle) {
          stats.currentCycleDebt += netAmount
        } else {
          stats.outstandingDebt += netAmount
        }
      } else if (['repayment', 'income'].includes(type)) {
        stats.repaid += rawAmount
        stats.totalBalance -= rawAmount
        
        if (isCurrentCycle) {
          stats.currentCycleDebt -= rawAmount
        } else {
          stats.outstandingDebt -= rawAmount
        }
      }
    })

    // 5. Build Final Objects
    return activePeople.map(person => {
      const stats = personStats.get(person.id)
      const debtAccount = debtAccounts.find(acc => acc.owner_id === person.id)

      return {
        ...person,
        debt_account_id: debtAccount?.id ?? null,
        current_debt_balance: stats?.totalBalance ?? 0,
        current_cycle_debt: stats?.currentCycleDebt ?? 0,
        outstanding_debt: stats?.outstandingDebt ?? 0,
        total_base_debt: stats?.baseLend ?? 0,
        total_cashback: stats?.repaid ?? 0, // In UI, 'Settled' column usually shows total repaid
        total_net_debt: stats?.totalBalance ?? 0, // In UI, 'Outstanding' column usually shows current total balance
        current_cycle_label: currentMonthTag,
        monthly_debts: []
      }
    })

  } catch (error) {
    console.error('[DB:PB] getPeople failed:', error)
    return []
  }
}

/**
 * Sync person cycle sheets from PocketBase
 */
export async function getPersonCycleSheets(personId: string): Promise<PersonCycleSheet[]> {
  const pbId = toPocketBaseId(personId)
  try {
    const response = await pocketbaseList<any>('person_cycle_sheets', {
      filter: `person_id='${pbId}'`,
      sort: '-cycle_tag'
    })
    return response.items.map(item => ({
      id: item.id,
      person_id: item.person_id,
      cycle_tag: item.cycle_tag,
      sheet_id: item.sheet_id,
      sheet_url: item.sheet_url,
      created_at: item.created,
      updated_at: item.updated
    }))
  } catch (error) {
    console.error('[DB:PB] getPersonCycleSheets failed:', error)
    return []
  }
}

/**
 * Get detailed person info including memberships and debt analysis
 */
export async function getPersonWithSubs(id: string): Promise<Person | null> {
  if (!id || id === 'details') return null
  console.log('[DB:PB] people.getWithSubs', { id })

  try {
    // 1. Get Person Record
    const personRecord = await resolvePocketBasePersonRecord(id) as any
    if (!personRecord) return null
    
    const pbId = personRecord.id

    // 2. Fetch Memberships from SB (Waiting for PB migration of service_members)
    // TODO: Migrate service_members to PB
    const responseMembers = await pocketbaseList<any>('service_members', {
      filter: `person_id='${pbId}'`,
      expand: 'service_id'
    }).catch(() => ({ items: [] })) // Fallback if table doesn't exist yet

    const subscription_ids = responseMembers.items.map(m => m.service_id)

    // 3. Fetch Debt Account
    const debtAccountResponse = await pocketbaseList<any>('accounts', {
      filter: `owner_id='${pbId}' && type='debt'`,
      perPage: 1
    })
    const debtAccount = debtAccountResponse.items[0]
    const debtAccountId = debtAccount?.id

    // 4. Calculate Balance from Transactions
    let balance = 0
    if (debtAccountId) {
      const txnsResponse = await pocketbaseList<any>('transactions', {
        filter: `(account_id='${debtAccountId}' || to_account_id='${debtAccountId}' || target_account_id='${debtAccountId}') && status!='void'`,
        perPage: 1000
      })
      
      txnsResponse.items.forEach(txn => {
        const amount = calculateFinalPrice(txn)
        const toAccId = txn.to_account_id || txn.target_account_id
        if (txn.account_id === debtAccountId) {
          balance += amount // Outflow
        }
        if (toAccId === debtAccountId) {
          balance -= amount // Inflow (Repayment)
        }
      })
    }

    return {
      id: personRecord.id,
      pocketbase_id: personRecord.id,
      name: personRecord.name,
      image_url: personRecord.image_url ?? null,
      sheet_link: personRecord.sheet_link ?? null,
      google_sheet_url: personRecord.google_sheet_url ?? null,
      sheet_full_img: personRecord.sheet_full_img ?? null,
      sheet_show_bank_account: personRecord.sheet_show_bank_account ?? false,
      sheet_bank_info: personRecord.sheet_bank_info ?? null,
      sheet_linked_bank_id: personRecord.sheet_linked_bank_id ?? null,
      sheet_show_qr_image: personRecord.sheet_show_qr_image ?? false,
      is_owner: personRecord.is_owner ?? false,
      is_archived: personRecord.is_archived ?? false,
      subscription_ids,
      debt_account_id: debtAccountId ?? null,
      balance: Math.abs(balance), // Debt balance is usually shown as positive
    }
  } catch (error) {
    console.error('[DB:PB] getPersonWithSubs failed:', error)
    return null
  }
}

/**
 * Create a new person
 */
export async function createPerson(name: string, image_url?: string | null, sheet_link?: string | null, subscriptionIds?: string[], options: any = {}) {
  console.log('[DB:PB] people.create', { name, ...options })
  try {
    const person = await createPocketBasePerson({
      name,
      image_url,
      sheet_link,
      google_sheet_url: options.google_sheet_url,
      is_owner: options.is_owner || false,
      is_archived: options.is_archived || false,
      is_group: options.is_group || false,
      group_parent_id: options.group_parent_id,
      sheet_linked_bank_id: options.sheet_linked_bank_id,
    })
    
    // Ensure debt account exists
    await ensureDebtAccount(person.id as string, name)

    revalidatePath('/people')
    return { success: true, profileId: person.id, debtAccountId: null } // Debt account ID will be resolved later
  } catch (error) {
    console.error('[DB:PB] createPerson failed:', error)
    return { success: false, error: (error as any).message }
  }
}

/**
 * Update a person's information
 */
export async function updatePerson(id: string, data: any) {
  console.log('[DB:PB] people.update', { id })
  try {
    const pbId = toPocketBaseId(id)
    await updatePocketBasePerson(pbId, {
      name: data.name,
      image_url: data.image_url,
      sheet_link: data.sheet_link,
      google_sheet_url: data.google_sheet_url,
      sheet_full_img: data.sheet_full_img,
      sheet_show_bank_account: data.sheet_show_bank_account,
      sheet_bank_info: data.sheet_bank_info,
      sheet_linked_bank_id: data.sheet_linked_bank_id,
      sheet_show_qr_image: data.sheet_show_qr_image,
      is_owner: data.is_owner,
      is_archived: data.is_archived,
    })

    revalidatePersonPaths(pbId)
    return { success: true }
  } catch (error) {
    console.error('[DB:PB] updatePerson failed:', error)
    return { success: false, error: (error as any).message }
  }
}

/**
 * Get recent people based on transaction history
 */
export async function getRecentPeopleByTransactions(limit: number = 5): Promise<MoneyflowPerson[]> {
  console.log('[DB:PB] transactions.recent_people')
  try {
    const response = await pocketbaseList<any>('transactions', {
      filter: 'person_id != null',
      sort: '-occurred_at',
      perPage: 50
    })
    
    const uniquePersonIds = Array.from(new Set(response.items.map(t => t.person_id))).slice(0, limit)
    const people = await getPocketBasePeople()
    
    return uniquePersonIds
      .map(id => people.find(p => p.id === id))
      .filter(Boolean) as MoneyflowPerson[]
  } catch (error) {
    console.error('[DB:PB] getRecentPeopleByTransactions failed:', error)
    return []
  }
}

/**
 * Ensures a person has a debt account in PocketBase
 */
export async function ensureDebtAccount(personId: string, personName?: string): Promise<string | null> {
  const pbId = toPocketBaseId(personId)
  try {
    // 1. Check if already exists
    const existing = await pocketbaseList<any>('accounts', {
      filter: `owner_id='${pbId}' && type='debt'`,
      perPage: 1
    })
    
    if (existing.items.length > 0) {
      return existing.items[0].id
    }

    // 2. Resolve name if not provided
    let name = personName
    if (!name) {
      const p = await pocketbaseGetById<any>('people', pbId)
      name = p?.name || 'Unknown'
    }

    // 3. Create debt account in PB
    const newAcc = await pocketbaseCreate<any>('accounts', {
      name: `Debt: ${name}`,
      type: 'debt',
      owner_id: pbId,
      is_active: true,
      initial_balance: 0,
      balance: 0,
      currency: 'VND'
    })

    return newAcc.id
  } catch (err) {
    console.error('[DB:PB] ensureDebtAccount failed:', err)
    return null
  }
}
