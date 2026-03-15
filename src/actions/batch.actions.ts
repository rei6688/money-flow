'use server'

import {
    getBatches,
    createBatch,
    updateBatch,
    deleteBatch,
    getBatchById,
    addBatchItem,
    updateBatchItem,
    deleteBatchItem,
    confirmBatchItem,
    revertBatchItem,
    importBatchItemsFromExcel,
    fundBatch,
    confirmBatchSource,
    sendBatchToSheet,
    cloneBatch,
    cloneBatchItem,
    deleteBatchItemsBulk,
    Batch,
    BatchItem
} from '@/services/batch.service'
import { revalidatePath } from 'next/cache'
import { SYSTEM_ACCOUNTS, SYSTEM_CATEGORIES } from '@/lib/constants'
import { pocketbaseGetById, pocketbaseList, pocketbaseUpdate, toPocketBaseId } from '@/services/pocketbase/server'
import { createTransaction, updateTransaction } from '@/services/transaction.service'

const PB_ID_REGEX = /^[a-z0-9]{15}$/

function isPocketBaseId(id: string | null | undefined): boolean {
    return Boolean(id && PB_ID_REGEX.test(id))
}

async function fundBatchPocketbase(batchId: string, sourceAccountId?: string) {
    console.log('[BatchDebug][Action] fundBatchPocketbase:start', { batchId, sourceAccountId })
    const batch = await pocketbaseGetById<any>('batches', batchId)
    if (!batch) throw new Error('Batch not found')

    const batchItemsResp = await pocketbaseList<any>('batch_items', {
        filter: `batch_id = "${batchId}"`,
        perPage: 5000,
    })
    const batchItems = batchItemsResp.items || []
    console.log('[BatchDebug][Action] fundBatchPocketbase:items', {
        batchId,
        itemCount: batchItems.length,
        amountsPreview: batchItems.slice(0, 8).map((item: any) => ({ id: item.id, amount: item.amount, master_item_id: item.master_item_id })),
    })
    if (!batchItems.length) throw new Error('Batch has no items to fund')

    const totalAmount = batchItems.reduce((sum: number, item: any) => sum + Math.abs(Number(item?.amount || 0)), 0)
    console.log('[BatchDebug][Action] fundBatchPocketbase:total', { batchId, totalAmount, funding_transaction_id: batch.funding_transaction_id || null })
    if (totalAmount <= 0) throw new Error('Batch has no amount to fund')

    let resolvedSource = sourceAccountId || batch.source_account_id || null
    if (!resolvedSource) {
        const bankAccountsResp = await pocketbaseList<any>('accounts', {
            filter: 'type = "bank"',
            perPage: 1000,
        })
        const bankTypeText = String(batch.bank_type || '').toLowerCase()
        const matched = (bankAccountsResp.items || []).find((acc: any) =>
            String(acc?.name || '').toLowerCase().includes(bankTypeText),
        ) || (bankAccountsResp.items || [])[0]

        if (!matched?.id) {
            throw new Error(`Please select a source account first for ${batch.bank_type || 'bank'}`)
        }
        resolvedSource = matched.id
    }

    const normalizedSource = toPocketBaseId(resolvedSource, 'accounts')
    const clearingAccountId = toPocketBaseId(SYSTEM_ACCOUNTS.BATCH_CLEARING, 'accounts')
    const transferCategoryId = toPocketBaseId(SYSTEM_CATEGORIES.MONEY_TRANSFER, 'categories')

    let currentFundedAmount = 0
    let currentFundingTxn: any = null
    if (batch.funding_transaction_id) {
        try {
            const fundingTxn = await pocketbaseGetById<any>('transactions', batch.funding_transaction_id)
            if (fundingTxn && fundingTxn.status !== 'void') {
                currentFundedAmount = Math.abs(Number(fundingTxn.amount || 0))
                currentFundingTxn = fundingTxn
            }
        } catch {
            currentFundedAmount = 0
        }
    }

    // Fallback for migrated/legacy batches: funding_transaction_id can be empty,
    // but step1 transaction still exists in metadata.
    if (!currentFundingTxn?.id) {
        try {
            const escapedBatchId = String(batchId || '').replace(/"/g, '\\"')
            const fallbackFilter = `metadata ~ "\\\"batch_id\\\":\\\"${escapedBatchId}\\\"" && (metadata ~ "\\\"batch_step\\\":\\\"step1\\\"" || metadata ~ "\\\"type\\\":\\\"batch_funding\\\"") && status != "void"`
            const fallbackTxns = await pocketbaseList<any>('transactions', {
                filter: fallbackFilter,
                perPage: 1,
                sort: '-created',
            })
            const fallbackTxn = fallbackTxns.items?.[0] || null
            if (fallbackTxn?.id) {
                currentFundingTxn = fallbackTxn
                currentFundedAmount = Math.abs(Number(fallbackTxn.amount || 0))
                await pocketbaseUpdate<any>('batches', batchId, {
                    funding_transaction_id: fallbackTxn.id,
                    source_account_id: normalizedSource,
                    status: 'funded',
                    updated_at: new Date().toISOString(),
                })
            }
        } catch {
            // ignore fallback lookup errors and proceed with create path if needed
        }
    }

    const noteLabel = String(batch.name || batch.month_year || 'Batch')

    // If funding txn already exists and is valid, always update TXN1 instead of creating a new one.
    if (currentFundingTxn?.id) {
        const shouldUpdateAmount = Math.abs(Number(currentFundingTxn.amount || 0)) !== Math.abs(totalAmount)
        const shouldUpdateSource = String(currentFundingTxn.account_id || '') !== String(normalizedSource)
        const shouldUpdateTarget = String(currentFundingTxn.target_account_id || '') !== String(clearingAccountId)

        if (shouldUpdateAmount || shouldUpdateSource || shouldUpdateTarget) {
            const updateOk = await updateTransaction(currentFundingTxn.id, {
                occurred_at: String(currentFundingTxn.occurred_at || new Date().toISOString()),
                note: `Transfer to Batch Clearing - ${noteLabel}`,
                type: 'transfer',
                source_account_id: normalizedSource,
                target_account_id: clearingAccountId,
                category_id: transferCategoryId,
                amount: Math.abs(totalAmount),
                tag: String(batch.month_year || '').trim() || null,
                metadata: {
                    ...(typeof currentFundingTxn.metadata === 'object' && currentFundingTxn.metadata !== null ? currentFundingTxn.metadata : {}),
                    type: 'batch_funding',
                    batch_step: 'step1',
                    batch_id: batchId,
                    batch_name: noteLabel,
                } as any,
            })

            if (!updateOk) {
                throw new Error('Failed to update existing funding transaction (TXN1)')
            }

            await pocketbaseUpdate<any>('batches', batchId, {
                source_account_id: normalizedSource,
                funding_transaction_id: currentFundingTxn.id,
                status: 'funded',
                updated_at: new Date().toISOString(),
            })

            return {
                transactionId: currentFundingTxn.id,
                totalAmount,
                fundedAmount: totalAmount,
                createdTransaction: false,
                status: 'updated_funding' as const,
                sourceAccountId: normalizedSource,
            }
        }

        return {
            transactionId: batch.funding_transaction_id || null,
            totalAmount,
            fundedAmount: currentFundedAmount,
            createdTransaction: false,
            status: 'already_funded' as const,
            sourceAccountId: normalizedSource,
        }
    }

    const txnId = await createTransaction({
        occurred_at: new Date().toISOString(),
        note: `Transfer to Batch Clearing - ${noteLabel}`,
        type: 'transfer',
        source_account_id: normalizedSource,
        target_account_id: clearingAccountId,
        category_id: transferCategoryId,
        amount: Math.abs(totalAmount),
        tag: String(batch.month_year || '').trim() || null,
        metadata: {
            type: 'batch_funding',
            batch_step: 'step1',
            batch_id: batchId,
            batch_name: noteLabel,
        } as any,
    })

    if (!txnId) throw new Error('Failed to create funding transaction')

    await pocketbaseUpdate<any>('batches', batchId, {
        source_account_id: normalizedSource,
        funding_transaction_id: txnId,
        status: 'funded',
        updated_at: new Date().toISOString(),
    })

    return {
        transactionId: txnId,
        totalAmount,
        fundedAmount: totalAmount,
        createdTransaction: true,
        status: 'funded' as const,
        sourceAccountId: normalizedSource,
    }
}

async function sendBatchToSheetPocketbase(
    batchId: string,
    options?: {
        batchItemIds?: string[]
        batchItemMasterMap?: Record<string, string>
        phaseLabel?: string
        phasePeriod?: 'before' | 'after'
    },
) {
    console.log('[BatchDebug][Action] sendBatchToSheetPocketbase:start', { batchId })
    const batch = await pocketbaseGetById<any>('batches', batchId)
    if (!batch) throw new Error('Batch not found')

    const itemsResp = await pocketbaseList<any>('batch_items', {
        filter: `batch_id = "${batchId}"`,
        perPage: 5000,
        expand: 'target_account_id,master_item_id',
    })
    const allItems = itemsResp.items || []
    const hasExplicitFilter = Array.isArray(options?.batchItemIds)
    const normalizedFilterIds = (options?.batchItemIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .map((id) => toPocketBaseId(id, 'batchitems'))
    const filteredByPhase = hasExplicitFilter
        ? allItems.filter((item: any) => normalizedFilterIds.includes(String(item.id)))
        : allItems

    // Keep only effective transfer rows for sheet export.
    const effectiveItems = filteredByPhase.filter((item: any) => Number(item?.amount || 0) > 0)
    console.log('[BatchDebug][Action] sendBatchToSheetPocketbase:items', {
        batchId,
        allItemsCount: allItems.length,
        filteredByPhaseCount: filteredByPhase.length,
        effectiveItemsCount: effectiveItems.length,
        totalAmount: effectiveItems.reduce((sum: number, item: any) => sum + Math.abs(Number(item?.amount || 0)), 0),
        amountsPreview: effectiveItems.slice(0, 8).map((item: any) => ({ id: item.id, amount: item.amount, receiver_name: item.receiver_name })),
    })
    if (!effectiveItems.length) throw new Error('Batch has no effective items to send')

    const bankType = String(batch.bank_type || '').toUpperCase()
    const endpoint = bankType === 'MBB'
        ? process.env.BATCH_SHEET_MBB_URL
        : process.env.BATCH_SHEET_VIB_URL
    if (!endpoint) throw new Error(`No sheet endpoint configured for ${bankType}`)

    let spreadsheetUrl: string | null = null
    try {
        const settingsResp = await pocketbaseList<any>('batch_settings', {
            filter: `bank_type = "${bankType}"`,
            perPage: 1,
        })
        const settings = settingsResp.items?.[0] || null
        spreadsheetUrl = settings?.display_sheet_url || settings?.sheet_url || null
    } catch {
        spreadsheetUrl = null
    }

    const phaseLabel = options?.phaseLabel
        || (options?.phasePeriod === 'before' ? 'Phase 1' : options?.phasePeriod === 'after' ? 'Phase 2' : null)
        || (String(batch.period || '').toLowerCase() === 'before' ? 'Phase 1' : String(batch.period || '').toLowerCase() === 'after' ? 'Phase 2' : null)
        || (String(batch.name || '').toLowerCase().includes('early') ? 'Phase 1' : String(batch.name || '').toLowerCase().includes('late') ? 'Phase 2' : 'Phase')

    const [yearRaw, monthRaw] = String(batch.month_year || '').split('-')
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthIndex = Math.max(1, Math.min(12, Number(monthRaw || 1)))
    const monthYearLabel = `${monthNames[monthIndex - 1]}${yearRaw || ''}`
    const bankTitle = bankType === 'MBB' ? 'Mbb' : bankType === 'VIB' ? 'Vib' : bankType

    const masterIds = Array.from(new Set(
        effectiveItems
            .map((item: any) => {
                const directMasterId = String(item?.master_item_id || '').trim()
                if (directMasterId) return directMasterId
                const mappedMasterId = String(options?.batchItemMasterMap?.[String(item?.id || '')] || '').trim()
                return mappedMasterId
            })
            .filter(Boolean)
    ))
    const normalizedMasterIds = Array.from(new Set(masterIds.map((id) => toPocketBaseId(id, 'batchmaster'))))

    let masterItems: any[] = []
    if (normalizedMasterIds.length > 0) {
        try {
            const masterFilter = normalizedMasterIds.map((id) => `id = "${id}"`).join(' || ')
            const masterResp = await pocketbaseList<any>('batch_master_items', {
                filter: masterFilter,
                perPage: Math.max(100, normalizedMasterIds.length),
                expand: 'target_account_id',
            })
            masterItems = masterResp.items || []
        } catch {
            masterItems = []
        }
    }
    if (masterItems.length === 0) {
        try {
            const masterResp = await pocketbaseList<any>('batch_master_items', {
                filter: `bank_type = "${bankType}" && is_active = true`,
                perPage: 1000,
                expand: 'target_account_id',
            })
            masterItems = masterResp.items || []
        } catch {
            masterItems = []
        }
    }

    const masterById = new Map<string, any>()
    const mastersByReceiver = new Map<string, any[]>()
    for (const m of masterItems) {
        const id = String(m?.id || '')
        if (id) masterById.set(id, m)
        const receiverKey = String(m?.receiver_name || '').trim().toLowerCase()
        if (receiverKey) {
            const arr = mastersByReceiver.get(receiverKey) || []
            arr.push(m)
            mastersByReceiver.set(receiverKey, arr)
        }
    }

    const normalizedRows = effectiveItems.map((item: any) => {
        const expandedTarget = item?.expand?.target_account_id || null
        const expandedMaster = item?.expand?.master_item_id || null
        const rawMasterId = String(item?.master_item_id || options?.batchItemMasterMap?.[String(item?.id || '')] || '').trim()
        const normalizedMasterId = rawMasterId ? toPocketBaseId(rawMasterId, 'batchmaster') : ''
        const masterFromMap = (normalizedMasterId && masterById.get(normalizedMasterId)) || null

        const receiverName = String(item.receiver_name || expandedMaster?.receiver_name || masterFromMap?.receiver_name || '').trim()
        const receiverKey = receiverName.toLowerCase()
        const receiverMasterCandidates = receiverKey ? (mastersByReceiver.get(receiverKey) || []) : []
        const receiverUniqueMaster = receiverMasterCandidates.length === 1 ? receiverMasterCandidates[0] : null
        const effectiveMaster = expandedMaster || masterFromMap || receiverUniqueMaster || null

        const fallbackBankNumber = String(
            expandedTarget?.account_number ||
            expandedTarget?.bank_number ||
            effectiveMaster?.bank_number ||
            expandedTarget?.number ||
            ''
        ).trim()
        const bankNumber = String(item.bank_number || fallbackBankNumber || '').trim()
        const bankName = String(item.bank_name || effectiveMaster?.bank_name || expandedTarget?.bank_name || '').trim()
        const accountName = String(expandedTarget?.name || '').trim() || receiverName || 'Transfer'
        const note = `${accountName} ${phaseLabel} ${monthYearLabel} by ${bankTitle}`.trim()

        return {
            id: String(item.id || ''),
            receiver_name: receiverName,
            bank_number: bankNumber,
            bank_name: bankName,
            amount: Number(item.amount || 0),
            note,
        }
    })

    const invalidRows = normalizedRows.filter((row) => !row.receiver_name || !row.bank_number || !row.bank_name)
    if (invalidRows.length > 0) {
        const preview = invalidRows
            .slice(0, 3)
            .map((row) => `${row.receiver_name || 'Unknown'} (#${row.id.slice(0, 8)})`)
            .join(', ')
        throw new Error(`Missing beneficiary data (${invalidRows.length} rows). Please sync master rows and save amount so bank number/name snapshot is stored: ${preview}`)
    }

    const payload = {
        bank_type: bankType,
        sheet_name: batch.sheet_name || null,
        spreadsheet_url: spreadsheetUrl,
        items: normalizedRows.map(({ id: _id, ...row }) => row),
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to send to sheet: ${text}`)
    }

    return { success: true, count: normalizedRows.length }
}

export async function cloneBatchItemAction(itemId: string, batchId: string) {
    try {
        const clonedItem = await cloneBatchItem(itemId)
        revalidatePath(`/batch/detail/${batchId}`)
        return { success: true, data: clonedItem }
    } catch (error: any) {
        console.error('Clone batch item failed:', error)
        return { success: false, error: error.message }
    }
}

export async function confirmBatchItemAction(itemId: string, batchId: string, targetAccountId?: string) {
    try {
        await confirmBatchItem(itemId, targetAccountId)
        revalidatePath(`/batch/detail/${batchId}`)
        return { success: true }
    } catch (error: any) {
        console.error('Confirm batch item failed:', error)
        return { success: false, error: error.message }
    }
}

export async function voidBatchItemAction(itemId: string, batchId: string) {
    try {
        await revertBatchItem(itemId)
        revalidatePath(`/batch/detail/${batchId}`)
        revalidatePath('/accounts')
        return { success: true }
    } catch (error: any) {
        console.error('Void batch item failed:', error)
        return { success: false, error: error.message }
    }
}

export async function deleteBatchItemAction(itemId: string, batchId: string) {
    try {
        await deleteBatchItem(itemId)
        revalidatePath(`/batch/detail/${batchId}`)
        return { success: true }
    } catch (error: any) {
        console.error('Delete batch item failed:', error)
        return { success: false, error: error.message }
    }
}

export async function deleteBatchItemsBulkAction(itemIds: string[], batchId: string) {
    try {
        await deleteBatchItemsBulk(itemIds)
        revalidatePath(`/batch/detail/${batchId}`)
        return { success: true }
    } catch (error: any) {
        console.error('Delete batch items failed:', error)
        return { success: false, error: error.message }
    }
}

export async function getBatchesAction() {
    return await getBatches()
}

export async function getBatchByIdAction(id: string) {
    return await getBatchById(id)
}

export async function fundBatchAction(batchId: string, sourceAccountId?: string) {
    console.log('[BatchDebug][Action] fundBatchAction:entry', {
        batchId,
        sourceAccountId: sourceAccountId || null,
        flow: isPocketBaseId(batchId) ? 'pocketbase' : 'legacy-service',
    })
    const result = isPocketBaseId(batchId)
        ? await fundBatchPocketbase(batchId, sourceAccountId)
        : await fundBatch(batchId, sourceAccountId)
    console.log('[BatchDebug][Action] fundBatchAction:result', {
        batchId,
        flow: isPocketBaseId(batchId) ? 'pocketbase' : 'legacy-service',
        result,
    })
    revalidatePath('/batch')
    revalidatePath(`/batch/detail/${batchId}`)
    revalidatePath('/accounts')
    if (result?.sourceAccountId) {
        revalidatePath(`/accounts/${result.sourceAccountId}`)
    }
    return result
}

export async function updateBatchItemAction(id: string, data: any, batchId?: string) {
    try {
        const result = await updateBatchItem(id, data)
        if (batchId) {
            revalidatePath(`/batch/detail/${batchId}`)
            revalidatePath('/batch')
        }
        return { success: true, data: result }
    } catch (error: any) {
        console.error('Failed to update batch item:', error)
        return { success: false, error: error.message || 'Failed to update item' }
    }
}

export async function importBatchItemsAction(
    batchId: string,
    excelData: string,
    batchTag?: string
) {
    const result = await importBatchItemsFromExcel(batchId, excelData, batchTag)
    revalidatePath(`/batch/detail/${batchId}`)
    return result
}
export async function confirmBatchSourceAction(batchId: string, accountId: string) {
    await confirmBatchSource(batchId, accountId)
    revalidatePath(`/batch/detail/${batchId}`)
    revalidatePath('/accounts')
}

export async function sendBatchToSheetAction(
    batchId: string,
    options?: {
        batchItemIds?: string[]
        batchItemMasterMap?: Record<string, string>
        phaseLabel?: string
        phasePeriod?: 'before' | 'after'
    },
) {
    console.log('[BatchDebug][Action] sendBatchToSheetAction:entry', {
        batchId,
        flow: isPocketBaseId(batchId) ? 'pocketbase' : 'legacy-service',
    })
    const result = isPocketBaseId(batchId)
        ? await sendBatchToSheetPocketbase(batchId, options)
        : await sendBatchToSheet(batchId)
    console.log('[BatchDebug][Action] sendBatchToSheetAction:result', {
        batchId,
        flow: isPocketBaseId(batchId) ? 'pocketbase' : 'legacy-service',
        result,
    })
    return result
}

export async function deleteBatchAction(batchId: string) {
    await deleteBatch(batchId)
    revalidatePath('/batch')
}

export async function updateBatchAction(id: string, data: any) {
    const result = await updateBatch(id, data)
    revalidatePath('/batch')
    revalidatePath(`/batch/detail/${id}`)
    return result
}

export async function createBatchAction(data: any) {
    const result = await createBatch(data)
    revalidatePath('/batch')
    return result
}

export async function cloneBatchAction(batchId: string, overrides: any = {}) {
    const result = await cloneBatch(batchId, overrides)
    revalidatePath('/batch')
    return result
}

export async function addBatchItemAction(data: any) {
    const result = await addBatchItem(data)
    revalidatePath(`/batch/detail/${data.batch_id}`)
    return result
}

export async function updateBatchCycleAction(batchId: string, action: 'prev' | 'next') {
    const { updateBatchCycle } = await import('@/services/batch.service')
    const result = await updateBatchCycle(batchId, action)
    revalidatePath(`/batch/detail/${batchId}`)
    return result
}


export async function updateBatchNoteModeAction(batchId: string, mode: 'previous' | 'current') {
    const { updateBatchNoteMode } = await import('@/services/batch.service')
    const result = await updateBatchNoteMode(batchId, mode)
    revalidatePath(`/batch/detail/${batchId}`)
    return result
}

export async function archiveBatchAction(batchId: string) {
    const { archiveBatch } = await import('@/services/batch.service')
    await archiveBatch(batchId)
    revalidatePath('/batch')
    revalidatePath(`/batch/detail/${batchId}`)
}

export async function restoreBatchAction(batchId: string) {
    const { restoreBatch } = await import('@/services/batch.service')
    await restoreBatch(batchId)
    revalidatePath('/batch')
    revalidatePath(`/batch/detail/${batchId}`)
}

export async function syncMasterOldBatchesAction() {
    const { syncMasterOldBatches } = await import('@/services/batch.service')
    const result = await syncMasterOldBatches()
    revalidatePath('/batch')
    return result
}

export async function checkAndAutoCloneBatchesAction() {
    const { checkAndAutoCloneBatches } = await import('@/services/batch.service')
    const result = await checkAndAutoCloneBatches()
    revalidatePath('/batch')
    return result
}
