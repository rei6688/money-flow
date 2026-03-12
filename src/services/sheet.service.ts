'use server'

import { toPocketBaseId, pocketbaseGetById, pocketbaseList, pocketbaseCreate, pocketbaseUpdate } from './pocketbase/server'
import { yyyyMMToLegacyMMMYY } from '@/lib/month-tag'
import { Account, Person } from '@/types/moneyflow.types'

type SheetSyncTransaction = {
  id: string
  occurred_at?: string
  date?: string
  note?: string | null
  tag?: string | null
  shop_name?: string | null
  amount?: number | null
  original_amount?: number | null
  cashback_share_percent?: number | null
  cashback_share_percent_input?: number | null
  cashback_share_fixed?: number | null
  cashback_share_amount?: number | null
  type?: string | null
  img_url?: string | null
}

function getCycleTag(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function isValidWebhook(url: string | null | undefined): url is string {
  if (!url) return false
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed)
}

function normalizePercent(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0

  // If value > 1, assume it's a percentage number (5 = 5%).
  // If value <= 1, assume it's a decimal (0.05 = 5%).
  // This is a heuristic, but covers 99% of cases (nobody has >100% cashback, and nobody has <1% cashback typically indistinguishable from decimal).
  // Actually, we should standardize. 
  // The service now sends raw number (5, 8). 
  // So if we get 5, we return 0.05.
  // If we get 0.05, we return 0.05.

  return numeric > 1 ? numeric / 100 : numeric
}

function calculateTotals(txn: SheetSyncTransaction) {
  const originalAmount = Math.abs(Number(txn.original_amount ?? txn.amount ?? 0)) || 0
  const percentRate = normalizePercent(
    txn.cashback_share_percent_input ?? txn.cashback_share_percent ?? undefined
  )
  const fixedBack = Math.max(0, Number(txn.cashback_share_fixed ?? 0) || 0)
  const percentBack = originalAmount * percentRate
  const totalBackCandidate =
    txn.cashback_share_amount !== null && txn.cashback_share_amount !== undefined
      ? Number(txn.cashback_share_amount)
      : percentBack + fixedBack

  const totalBack = Math.min(originalAmount, Math.max(0, totalBackCandidate))

  return {
    originalAmount,
    percentRate,
    percentBack,
    fixedBack,
    totalBack,
  }
}

function shouldExcludeFromSheet(note: string | null | undefined): boolean {
  const normalized = String(note ?? '').toLowerCase()
  return normalized.includes('#nosync') || normalized.includes('#deprecated')
}

function extractSheetId(sheetUrl: string | null | undefined): string | null {
  if (!sheetUrl) return null
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match?.[1] ?? null
}

async function getProfileSheetLink(personId: string): Promise<string | null> {
  const pbId = toPocketBaseId(personId, 'people')
  const profile = await pocketbaseGetById<Person>('people', pbId)

  if (profile) {
    const sheetLink = profile.sheet_link?.trim() ?? null
    console.log('[Sheet] Profile lookup result', {
      lookupId: personId,
      pbId,
      sheet_link: sheetLink,
    })
    if (isValidWebhook(sheetLink)) {
      return sheetLink
    }
  }

  // Fallback: Check if it's a debt account (which also has owner_id)
  // Actually, people should be enough.
  const account = await pocketbaseGetById<Account>('accounts', pbId)
  if (account && account.owner_id) {
    const owner = await pocketbaseGetById<Person>('people', account.owner_id as string)
    if (owner?.sheet_link) {
      const sheetLink = owner.sheet_link?.trim()
      if (isValidWebhook(sheetLink)) return sheetLink
    }
  }

  console.warn('[Sheet] No valid sheet link configured for', personId)
  return null
}

async function getProfileSheetInfo(personId: string): Promise<{ sheetUrl: string | null; sheetId: string | null }> {
  const pbId = toPocketBaseId(personId, 'people')
  const profile = await pocketbaseGetById<Person>('people', pbId)

  if (profile?.google_sheet_url) {
    const sheetUrl = profile.google_sheet_url.trim()
    return { sheetUrl, sheetId: extractSheetId(sheetUrl) }
  }

  // Fallback to account owner
  const account = await pocketbaseGetById<Account>('accounts', pbId)
  if (account?.owner_id) {
    const owner = await pocketbaseGetById<Person>('people', account.owner_id as string)
    if (owner?.google_sheet_url) {
      const sheetUrl = owner.google_sheet_url.trim()
      return { sheetUrl, sheetId: extractSheetId(sheetUrl) }
    }
  }

  return { sheetUrl: null, sheetId: null }
}

type SheetPostResult = {
  success: boolean
  json?: Record<string, any> | null
  message?: string
}

async function postToSheet(sheetLink: string, payload: Record<string, unknown>): Promise<SheetPostResult> {
  const response = await fetch(sheetLink, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  let json: Record<string, any> | null = null
  try {
    json = (await response.json()) as Record<string, any>
  } catch (error) {
    json = null
  }

  if (!response.ok) {
    return {
      success: false,
      json,
      message: json?.error ?? `Sheet response ${response.status}`,
    }
  }

  if (json && json.ok === false) {
    return {
      success: false,
      json,
      message: json.error ?? 'Sheet returned error',
    }
  }

  return { success: true, json }
}

function buildPayload(txn: SheetSyncTransaction, action: 'create' | 'delete' | 'update') {
  const { originalAmount, percentRate, fixedBack, totalBack } = calculateTotals(txn)

  // If amount is negative, it's a credit to the debt account (Repayment) -> Type "In"
  // If amount is positive, it's a debit to the debt account (Lending) -> Type "Debt"
  // Allow override via txn.type
  const type = txn.type ?? ((txn.amount ?? 0) < 0 ? 'In' : 'Debt');

  return {
    action: action === 'update' ? 'edit' : action, // Map 'update' to 'edit' for backend if needed, or keep 'update'
    id: txn.id,
    type: type,
    date: txn.occurred_at ?? txn.date ?? null,
    occurred_at: txn.occurred_at ?? txn.date ?? null, // Legacy compatibility
    shop: txn.shop_name ?? '',
    notes: txn.note ?? '',
    note: txn.note ?? '', // Legacy compatibility
    amount: originalAmount,
    // We want to send the raw number (0-100).
    // If input was 5, normalizePercent made it 0.05.
    // So we assume 'percentRate' is ALWAYS decimal [0..1].
    // We multiply by 100 to send to sheet.
    percent_back: Math.round(percentRate * 100 * 100) / 100, // Round to 2 decimals for safety
    fixed_back: fixedBack,
    total_back: totalBack,
    tag: txn.tag ?? undefined,
    img: txn.img_url ?? undefined
  }
}

export async function syncTransactionToSheet(
  personId: string,
  txn: SheetSyncTransaction,
  action: 'create' | 'delete' | 'update' = 'create'
) {
  try {
    // Check for #nosync or #deprecated tags
    if (shouldExcludeFromSheet(txn.note)) {
      // If tagged as nosync, we treat it as a deletion from the sheet
      action = 'delete'
    }

    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) return

    const pbPersonId = toPocketBaseId(personId, 'people')
    const personData = await pocketbaseGetById<Person>('people', pbPersonId)
    if (!personData) return

    const showBankAccount = personData.sheet_show_bank_account ?? false
    const manualBankInfo = personData.sheet_bank_info ?? ''
    const linkedBankId = personData.sheet_linked_bank_id
    const showQrImage = personData.sheet_show_qr_image ?? false
    const qrImageUrl = personData.sheet_full_img ?? null

    let resolvedBankInfo = manualBankInfo
    if (showBankAccount && linkedBankId) {
      const acc = await pocketbaseGetById<Account>('accounts', linkedBankId)
      if (acc) {
        const parts = [
          acc.name,
          acc.account_number,
          acc.receiver_name
        ].filter(Boolean)
        resolvedBankInfo = parts.join(' ') || manualBankInfo
      }
    }

    console.log('[syncTransactionToSheet] Person sheet preferences:', {
      personId,
      showBankAccount,
      resolvedBankInfo,
      showQrImage,
      qrImageUrl: qrImageUrl ? '(URL set)' : '(not set)'
    })

    const payload = {
      ...buildPayload(txn, action),
      person_id: personId,
      cycle_tag: txn.tag ?? undefined,
      bank_account: showBankAccount ? resolvedBankInfo : '', // Send empty to clear if disabled
      img: showQrImage && qrImageUrl ? qrImageUrl : '' // Send empty to clear if disabled
    }

    console.log(`[Sheet Sync] Sending payload to ${personId}:`, {
      action: payload.action,
      id: payload.id,
      shop: payload.shop,
      amount: payload.amount,
      note: payload.note,
      notes: payload.notes,
      type: payload.type
    })

    const result = await postToSheet(sheetLink, payload)
    if (!result.success) {
      console.error('Sheet sync failed:', result.message ?? 'Sheet sync failed')
    }
  } catch (err) {
    console.error('Sheet sync failed:', err)
  }
}

export async function testConnection(personId: string) {
  try {
    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) {
      return { success: false, message: 'No valid sheet link configured' }
    }

    const today = new Date().toISOString().slice(0, 10)
    const payload = {
      action: 'create',
      type: 'TEST-CONNECTION',
      amount: 0,
      shop: 'MoneyFlow Bot',
      notes: 'Connection successful!',
      date: today,
    }

    const result = await postToSheet(sheetLink, payload)
    if (!result.success) {
      return { success: false, message: result.message ?? 'Sheet create failed' }
    }
    return { success: true }
  } catch (err) {
    console.error('Test connection failed:', err)
    return { success: false, message: 'Failed to send test signal' }
  }
}

export async function syncAllTransactions(personId: string) {
  try {
    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) {
      return { success: false, message: 'No valid sheet link configured' }
    }

    const pbPersonId = toPocketBaseId(personId, 'people')
    const data = await pocketbaseList('transactions', {
      filter: `person_id = "${pbPersonId}" && status != "void"`,
      expand: 'shop_id,account_id,category_id',
      sort: 'occurred_at'
    })

    // Fetch person's sheet preferences for bank info & QR
    const personData = await pocketbaseGetById<Person>('people', pbPersonId)

    const showBankAccount = personData?.sheet_show_bank_account ?? false
    const manualBankInfo = personData?.sheet_bank_info ?? ''
    const linkedBankId = personData?.sheet_linked_bank_id
    const showQrImage = personData?.sheet_show_qr_image ?? false
    const qrImageUrl = personData?.sheet_full_img ?? null

    let resolvedBankInfo = manualBankInfo
    if (showBankAccount && linkedBankId) {
      const acc = await pocketbaseGetById<Account>('accounts', linkedBankId)
      if (acc) {
        const parts = [
          acc.name,
          acc.account_number,
          acc.receiver_name
        ].filter(Boolean)
        resolvedBankInfo = parts.join(' ') || manualBankInfo
      }
    }

    const rows = (data.items || []).map(txn => {
      const expanded = (txn as any).expand || {}
      return {
        id: (txn as any).id,
        occurred_at: (txn as any).occurred_at || (txn as any).date,
        note: (txn as any).note || (txn as any).description,
        status: (txn as any).status,
        tag: (txn as any).tag || (txn as any).debt_cycle_tag,
        type: (txn as any).type,
        amount: (txn as any).amount,
        cashback_share_percent: (txn as any).cashback_share_percent,
        cashback_share_fixed: (txn as any).cashback_share_fixed,
        shop_id: (txn as any).shop_id,
        shops: expanded.shop_id ? { name: expanded.shop_id.name } : null,
        account_id: (txn as any).account_id,
        accounts: expanded.account_id ? { name: expanded.account_id.name } : null,
        categories: expanded.category_id ? { name: expanded.category_id.name } : null,
      }
    })

    const eligibleRows = rows.filter(txn => !shouldExcludeFromSheet(txn.note))

    console.log(`[SheetSync] syncAllTransactions for personId: ${personId}. Found ${rows.length} transactions, eligible ${eligibleRows.length} after #nosync/#deprecated filtering.`)

    // Group transactions by cycle tag
    const cycleMap = new Map<string, typeof rows>()

    for (const txn of eligibleRows) {
      const cycleTag = txn.tag || getCycleTag(new Date(txn.occurred_at))
      if (!cycleMap.has(cycleTag)) {
        cycleMap.set(cycleTag, [])
      }
      cycleMap.get(cycleTag)!.push(txn)
    }

    let totalSynced = 0

    // Sync each cycle as a batch
    for (const [cycleTag, cycleTxns] of cycleMap.entries()) {
      const rowsPayload = cycleTxns.map(txn => {
        const shopData = txn.shops as any
        let shopName = Array.isArray(shopData) ? shopData[0]?.name : shopData?.name

        // Fallback for Repayment/Transfer if shop is empty -> Use Account Name
        if (!shopName) {
          const categoryName = (txn.categories as any)?.name
          if (txn.note?.toLowerCase().startsWith('rollover') || categoryName === 'Rollover') {
            shopName = 'Rollover'
          } else {
            const accData = txn.accounts as any
            shopName = (Array.isArray(accData) ? accData[0]?.name : accData?.name) ?? ''
          }
        }

        // Pass the raw transaction fields that buildPayload needs
        return buildPayload({
          ...txn,
          shop_name: shopName
        }, 'create')
      })

      const payload = {
        action: 'syncTransactions',
        personId: personId,
        cycleTag: cycleTag,
        rows: rowsPayload,
        bank_account: showBankAccount ? resolvedBankInfo : '',
        img: showQrImage && qrImageUrl ? qrImageUrl : ''
      }

      const result = await postToSheet(sheetLink, payload)
      if (!result.success) {
        return { success: false, message: result.message ?? `Sheet sync failed for cycle ${cycleTag}` }
      }

      totalSynced += rowsPayload.length
    }

    return { success: true, count: totalSynced }
  } catch (err) {
    console.error('Sync all transactions failed:', err)
    return { success: false, message: 'Sync failed' }
  }
}

type CycleSheetResult = {
  success: boolean
  sheetUrl?: string | null
  sheetId?: string | null
  message?: string
}


export async function createTestSheet(personId: string): Promise<CycleSheetResult> {
  try {
    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) {
      return { success: false, message: 'No valid sheet link configured' }
    }
    const sheetInfo = await getProfileSheetInfo(personId)

    const response = await postToSheet(sheetLink, {
      action: 'create_test_sheet',
      person_id: personId,
      sheet_id: sheetInfo.sheetId ?? undefined,
      sheet_url: sheetInfo.sheetUrl ?? undefined,
    })

    if (!response.success) {
      return { success: false, message: response.message ?? 'Test create failed' }
    }

    return {
      success: true,
      sheetUrl: (response.json?.sheetUrl as string) ?? null,
      sheetId: (response.json?.sheetId as string) ?? null
    }
  } catch (err) {
    return { success: false, message: 'Unexpected error testing sheet' }
  }
}

export async function createCycleSheet(personId: string, cycleTag: string): Promise<CycleSheetResult> {
  try {
    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) {
      return { success: false, message: 'No valid sheet link configured' }
    }
    const sheetInfo = await getProfileSheetInfo(personId)

    const response = await postToSheet(sheetLink, {
      action: 'create_cycle_sheet',
      person_id: personId,
      cycle_tag: cycleTag,
      sheet_id: sheetInfo.sheetId ?? undefined,
      sheet_url: sheetInfo.sheetUrl ?? undefined,
    })

    if (!response.success) {
      return { success: false, message: response.message ?? 'Failed to create cycle sheet' }
    }

    const json = response.json ?? null
    const sheetUrl = (json?.sheetUrl ?? json?.sheet_url ?? null) as string | null
    const sheetId = (json?.sheetId ?? json?.sheet_id ?? null) as string | null

    return { success: true, sheetUrl, sheetId }
  } catch (error) {
    console.error('Create cycle sheet failed:', error)
    return { success: false, message: 'Failed to create cycle sheet' }
  }
}


export async function syncCycleTransactions(
  personId: string,
  cycleTag: string,
  sheetId?: string | null
) {
  try {
    const pbId = toPocketBaseId(personId, 'people')
    const legacyTag = yyyyMMToLegacyMMMYY(cycleTag)
    const tags = legacyTag ? [cycleTag, legacyTag] : [cycleTag]

    // Construct filter for tags
    const tagFilter = tags.map(t => `tag = "${t}"`).join(' || ')
    const data = await pocketbaseList('transactions', {
      filter: `person_id = "${pbId}" && status != "void" && (${tagFilter})`,
      expand: 'shop_id,account_id,category_id',
      sort: 'occurred_at'
    })

    if (!data) {
      console.error('Failed to load cycle transactions from PB')
      return { success: false, message: 'Failed to load transactions' }
    }

    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) return { success: false, message: 'No valid sheet link' }

    const rows = (data.items as any[])
      .filter(txn => !shouldExcludeFromSheet(txn.note || txn.description))
      .map(txn => {
        const expanded = txn.expand || {}
        let shopName = expanded.shop_id?.name

        if (!shopName) {
          const categoryName = (txn.categories as any)?.name
          if (txn.note?.toLowerCase().startsWith('rollover') || categoryName === 'Rollover') {
            shopName = 'Rollover'
          } else {
            const accData = txn.accounts as any
            shopName = (Array.isArray(accData) ? accData[0]?.name : accData?.name) ?? ''
          }
        }

        // Pass the raw transaction fields that buildPayload needs
        return buildPayload({
          ...txn,
          shop_name: shopName
        }, 'create')
      })

    console.log(`[Sheet Sync] Sending ${rows.length} mapped transactions to ${personId} for cycle ${cycleTag}`)

    // Fetch person's sheet preferences
    const personData: any = await pocketbaseGetById('people', pbId)

    const showBankAccount = personData?.sheet_show_bank_account ?? false
    const manualBankInfo = personData?.sheet_bank_info ?? ''
    const linkedBankId = personData?.sheet_linked_bank_id
    const showQrImage = personData?.sheet_show_qr_image ?? false
    const qrImageUrl = personData?.sheet_full_img ?? null

    let resolvedBankInfo = manualBankInfo
    if (showBankAccount && linkedBankId) {
      const acc = await pocketbaseGetById<Account>('accounts', linkedBankId)
      if (acc) {
        const parts = [
          acc.name,
          acc.account_number,
          acc.receiver_name
        ].filter(Boolean)
        resolvedBankInfo = parts.join(' ') || manualBankInfo
      }
    }

    console.log('[syncCycleTransactions] Person sheet preferences:', {
      personId,
      showBankAccount,
      resolvedBankInfo,
      showQrImage,
      qrImageUrl: qrImageUrl ? '(URL set)' : '(not set)'
    })

    const payload = {
      action: 'syncTransactions',
      person_id: personId,
      cycle_tag: cycleTag,
      sheet_id: sheetId ?? undefined,
      rows: rows,
      bank_account: showBankAccount ? resolvedBankInfo : '',
      img: showQrImage && qrImageUrl ? qrImageUrl : ''
    }

    console.log('[syncCycleTransactions] Final payload:', { ...payload, rows: `[${payload.rows.length} rows]` })

    const result = await postToSheet(sheetLink, payload)

    if (!result.success) {
      return { success: false, message: result.message ?? 'Sheet sync failed' }
    }

    return {
      success: true,
      count: rows.length,
      syncedCount: result.json?.syncedCount,
      manualPreserved: result.json?.manualPreserved,
      totalRows: result.json?.totalRows
    }
  } catch (error) {
    console.error('Sync cycle transactions failed:', error)
    return { success: false, message: 'Sync failed' }
  }
}

/**
 * Auto-sync cycle sheet after service distribution
 * Only triggers if:
 * 1. Person has sheet_link configured
 * 2. Cycle sheet doesn't exist yet
 */
export async function autoSyncCycleSheetIfNeeded(personId: string, cycleTag: string): Promise<void> {
  try {
    console.log(`[AutoSync] Checking if auto-sync needed for ${personId} / ${cycleTag}`)

    // 1. Check if person has sheet_link configured
    const sheetLink = await getProfileSheetLink(personId)
    if (!sheetLink) {
      console.log(`[AutoSync] Skipping ${personId}: No sheet link configured`)
      return
    }

    // 2. Check if cycle sheet already exists in PB
    const pbId = toPocketBaseId(personId, 'people')
    const existingList = await pocketbaseList('person_cycle_sheets', {
      filter: `person_id = "${pbId}" && cycle_tag = "${cycleTag}"`
    })
    const existing = existingList.items[0] as any

    if (existing?.sheet_id || existing?.sheet_url) {
      console.log(`[AutoSync] Skipping ${personId}: Cycle sheet already exists`)
      return
    }

    console.log(`[AutoSync] Triggering auto-sync for ${personId} / ${cycleTag}`)

    // 3. Create cycle sheet
    const createResult = await createCycleSheet(personId, cycleTag)
    if (!createResult.success) {
      console.error(`[AutoSync] Failed to create cycle sheet: ${createResult.message}`)
      return
    }

    // 4. Sync transactions
    const syncResult = await syncCycleTransactions(personId, cycleTag, createResult.sheetId)
    if (!syncResult.success) {
      console.error(`[AutoSync] Failed to sync transactions: ${syncResult.message}`)
      return
    }

    // 5. Update PB
    const payload = {
      person_id: pbId,
      cycle_tag: cycleTag,
      sheet_id: createResult.sheetId,
      sheet_url: createResult.sheetUrl,
    }

    if (existing?.id) {
        await pocketbaseUpdate('person_cycle_sheets', existing.id, payload)
    } else {
        await pocketbaseCreate('person_cycle_sheets', payload)
    }

    console.log(`[AutoSync] Successfully auto-synced ${personId} / ${cycleTag}`)
  } catch (error) {
    console.error(`[AutoSync] Error for ${personId} / ${cycleTag}:`, error)
    // Silent fail - don't throw, just log
  }
}
