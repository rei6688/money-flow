'use server'

import { pocketbaseCreate, pocketbaseList, pocketbaseUpdate, toPocketBaseId } from '@/services/pocketbase/server'
import { revalidatePath } from 'next/cache'

interface UpsertBatchItemParams {
    monthYear: string
    period: 'before' | 'after'
    bankType: 'MBB' | 'VIB'
    masterItemId: string
    amount: number
    receiverName: string
    bankNumber: string
    bankName: string
    targetAccountId: string | null
}

/**
 * High-speed amount update action
 * Ensures a batch exists and an item exists, then updates the amount.
 */
export async function upsertBatchItemAmountAction(params: UpsertBatchItemParams) {
    try {
        // 1. Ensure Batch exists
        // monthYear is YYYY-MM
        const [year, month] = params.monthYear.split('-')
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const monthName = `${monthNames[parseInt(month) - 1]} ${year} (${params.period === 'before' ? 'Early' : 'Late'})`

        const batchResult = await pocketbaseList<any>('batches', {
            filter: `month_year = "${params.monthYear}" && bank_type = "${params.bankType}"`,
            perPage: 100,
        })
        let batch = batchResult.items || []

        // Manual filter by period name suffix or column if possible
        const expectedSuffix = params.period === 'before' ? '(Early)' : '(Late)'
        const matchedBatch = batch.find((b: any) =>
            (b.period === params.period) ||
            (b.name?.includes(expectedSuffix))
        ) || null

        let batchId = matchedBatch?.id

        if (!batchId) {
            // Create batch
            const insertData: any = {
                id: toPocketBaseId(`${params.bankType}:${params.monthYear}:${params.period}`, 'batches'),
                    month_year: params.monthYear,
                    name: monthName,
                    bank_type: params.bankType,
                    period: params.period,
                    status: 'draft'
                }
            let newBatch: any
            try {
                newBatch = await pocketbaseCreate<any>('batches', insertData)
            } catch {
                // Fallback if period column is not available
                const { period: _period, ...fallbackInsert } = insertData
                newBatch = await pocketbaseCreate<any>('batches', fallbackInsert)
            }

            batchId = newBatch.id
        }

        // 2. Ensure Batch Item exists
        // Some migrated datasets can throw PB 400 when filtering directly by master_item_id.
        // Query by batch first, then match master ids in-app (raw + normalized).
        const existingItemsResult = await pocketbaseList<any>('batch_items', {
            filter: `batch_id = "${batchId}"`,
            perPage: 5000,
        })
        const normalizedMasterId = toPocketBaseId(params.masterItemId, 'batchmaster')
        const deterministicBatchItemId = toPocketBaseId(`${batchId}:${params.masterItemId}`, 'batchitems')
        const existingItem = (existingItemsResult.items || []).find((item: any) => {
            const rawMasterId = String(item?.master_item_id || '')
            return item?.id === deterministicBatchItemId || rawMasterId === params.masterItemId || rawMasterId === normalizedMasterId
        }) || null

        const targetAccountId = params.targetAccountId
            ? toPocketBaseId(params.targetAccountId, 'accounts')
            : null
        const persistedMasterId = existingItem?.master_item_id || normalizedMasterId

        if (existingItem) {
            // Update amount first. If account relation is invalid in migrated data,
            // keep amount save successful and skip relation update.
            try {
                await pocketbaseUpdate<any>('batch_items', existingItem.id, {
                    amount: params.amount,
                    receiver_name: params.receiverName,
                    bank_number: params.bankNumber,
                    bank_name: params.bankName,
                    target_account_id: targetAccountId,
                })
            } catch {
                await pocketbaseUpdate<any>('batch_items', existingItem.id, {
                    amount: params.amount,
                    receiver_name: params.receiverName,
                    bank_number: params.bankNumber,
                    bank_name: params.bankName,
                })
            }
        } else {
            // Create
            try {
                await pocketbaseCreate<any>('batch_items', {
                        id: deterministicBatchItemId,
                        batch_id: batchId,
                        master_item_id: persistedMasterId,
                        amount: params.amount,
                        receiver_name: params.receiverName,
                        bank_number: params.bankNumber,
                        bank_name: params.bankName,
                        target_account_id: targetAccountId,
                        status: 'draft'
                    })
            } catch (createError: any) {
                const message = String(createError?.message || '')
                if (message.includes('validation_not_unique') && message.includes('id')) {
                    // Id already exists from prior deterministic insert/migration path.
                    try {
                        await pocketbaseUpdate<any>('batch_items', deterministicBatchItemId, {
                            master_item_id: persistedMasterId,
                            amount: params.amount,
                            receiver_name: params.receiverName,
                            bank_number: params.bankNumber,
                            bank_name: params.bankName,
                            target_account_id: targetAccountId,
                            status: 'draft',
                        })
                    } catch {
                        await pocketbaseUpdate<any>('batch_items', deterministicBatchItemId, {
                            master_item_id: persistedMasterId,
                            amount: params.amount,
                            receiver_name: params.receiverName,
                            bank_number: params.bankNumber,
                            bank_name: params.bankName,
                            status: 'draft',
                        })
                    }
                } else {
                    // Retry create without relation field for relation mismatch scenarios.
                    try {
                        await pocketbaseCreate<any>('batch_items', {
                            id: deterministicBatchItemId,
                            batch_id: batchId,
                            master_item_id: persistedMasterId,
                            amount: params.amount,
                            receiver_name: params.receiverName,
                            bank_number: params.bankNumber,
                            bank_name: params.bankName,
                            status: 'draft',
                        })
                    } catch {
                        throw createError
                    }
                }
            }
        }

        revalidatePath('/batch')
        return { success: true, batchId }
    } catch (error: any) {
        console.error('Speed update failed:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Bulk initialize a batch for a month/period using all active master items
 */
export async function bulkInitializeFromMasterAction(params: {
    monthYear: string
    period: 'before' | 'after'
    bankType: 'MBB' | 'VIB'
    phaseId?: string
}) {
    try {
        // 1. Fetch all active master items (prefer phase_id, fallback to cutoff_period)
        let masterItems: any[] = []
        try {
            const phaseAwareFilter = params.phaseId
                ? `bank_type = "${params.bankType}" && is_active = true && phase_id = "${params.phaseId}"`
                : `bank_type = "${params.bankType}" && is_active = true && cutoff_period = "${params.period}"`

            const masterResult = await pocketbaseList<any>('batch_master_items', {
                filter: phaseAwareFilter,
                perPage: 1000,
                sort: 'sort_order',
            })
            masterItems = masterResult.items || []
        } catch (phaseErr) {
            const fallbackFilter = `bank_type = "${params.bankType}" && is_active = true && cutoff_period = "${params.period}"`
            const fallbackResult = await pocketbaseList<any>('batch_master_items', {
                filter: fallbackFilter,
                perPage: 1000,
                sort: 'sort_order',
            })
            masterItems = fallbackResult.items || []
            console.warn('bulkInitializeFromMasterAction phase filter fallback:', (phaseErr as any)?.message)
        }

        if (!masterItems || masterItems.length === 0) {
            return { success: false, error: 'No active master items found for this period.' }
        }

        // 2. Ensure Batch exists
        const [year, month] = params.monthYear.split('-')
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const monthName = `${monthNames[parseInt(month) - 1]} ${year} (${params.period === 'before' ? 'Early' : 'Late'})`

        const allBatchesResult = await pocketbaseList<any>('batches', {
            filter: `month_year = "${params.monthYear}" && bank_type = "${params.bankType}"`,
            perPage: 100,
        })
        const allBatches = allBatchesResult.items || []

        const expectedSuffix = params.period === 'before' ? '(Early)' : '(Late)'
        const batch = allBatches?.find((b: any) =>
            (b.period === params.period) ||
            (b.name?.includes(expectedSuffix))
        ) || null

        let batchId = batch?.id
        if (!batchId) {
            const insertData: any = {
                id: toPocketBaseId(`${params.bankType}:${params.monthYear}:${params.period}`, 'batches'),
                month_year: params.monthYear,
                name: monthName,
                bank_type: params.bankType,
                status: 'draft'
            }
            // Only add period if the column is likely to exist (we'll try and if it fails, we'll try without)
            try {
                const newBatch = await pocketbaseCreate<any>('batches', {
                    ...insertData,
                    period: params.period,
                    phase_id: params.phaseId || null,
                })
                batchId = newBatch.id
            } catch (e) {
                const newBatch = await pocketbaseCreate<any>('batches', insertData)
                batchId = newBatch.id
            }
        }

        // 3. Fetch existing items to avoid duplicates
        const existingItemsResult = await pocketbaseList<any>('batch_items', {
            filter: `batch_id = "${batchId}"`,
            perPage: 5000,
        })
        const existingItems = existingItemsResult.items || []

        const existingMasterIds = new Set(existingItems?.map((i: any) => i.master_item_id) || [])

        // 4. Filter and insert missing items
        const itemsToInsert = masterItems
            .filter((m: any) => !existingMasterIds.has(m.id))
            .map((m: any) => ({
                id: toPocketBaseId(`${batchId}:${m.id}`, 'batchitems'),
                batch_id: batchId,
                master_item_id: m.id,
                amount: 0,
                receiver_name: m.receiver_name,
                bank_number: m.bank_number,
                bank_name: m.bank_name,
                target_account_id: m.target_account_id,
                status: 'draft'
            }))

        if (itemsToInsert.length > 0) {
            for (const item of itemsToInsert) {
                await pocketbaseCreate<any>('batch_items', item)
            }
        }

        revalidatePath('/batch')
        return { success: true, batchId, initializedCount: itemsToInsert.length }
    } catch (error: any) {
        console.error('Bulk initialization failed:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Toggle confirmation status of a batch item
 */
export async function toggleBatchItemConfirmAction(params: {
    batchItemId: string
    currentStatus: string
}) {
    try {
        const batchItemId = toPocketBaseId(params.batchItemId, 'batchitems')
        if (params.currentStatus === 'confirmed') {
            // Unconfirm (void transaction)
            const itemResult = await pocketbaseList<any>('batch_items', {
                filter: `id = "${batchItemId}"`,
                perPage: 1,
            })
            const item = itemResult.items[0] || null
            if (item?.transaction_id) {
                const { voidTransaction } = await import('@/services/transaction.service')
                await voidTransaction(item.transaction_id)
                // Also revert batch item status
                const { revertBatchItem } = await import('@/services/batch.service')
                await revertBatchItem(item.transaction_id)
            } else {
                await pocketbaseUpdate<any>('batch_items', batchItemId, { status: 'pending' })
            }
            revalidatePath('/batch')
            return { success: true, newStatus: 'pending' }
        } else {
            // Confirm (create transaction)
            const { confirmBatchItem } = await import('@/services/batch.service')
            await confirmBatchItem(params.batchItemId)
            revalidatePath('/batch')
            return { success: true, newStatus: 'confirmed' }
        }
    } catch (error: any) {
        console.error('Confirm toggle failed:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Bulk confirm batch items
 */
export async function bulkConfirmBatchItemsAction(batchId: string, itemIds: string[]) {
    try {
        if (!itemIds || itemIds.length === 0) return { success: true, count: 0 }
        const { confirmBatchItem } = await import('@/services/batch.service')

        let count = 0
        for (const id of itemIds) {
            await confirmBatchItem(id)
            count++
        }

        revalidatePath('/batch')
        return { success: true, count }
    } catch (error: any) {
        console.error('Bulk confirm failed:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Bulk unconfirm batch items
 */
export async function bulkUnconfirmBatchItemsAction(batchId: string, itemIds: string[]) {
    try {
        if (!itemIds || itemIds.length === 0) return { success: true, count: 0 }

        const normalizedItemIds = itemIds.map((id) => toPocketBaseId(id, 'batchitems'))
        const itemFilter = normalizedItemIds.map((id) => `id = "${id}"`).join(' || ')
        const itemsResult = await pocketbaseList<any>('batch_items', {
            filter: itemFilter,
            perPage: Math.max(normalizedItemIds.length, 1),
        })
        const items = itemsResult.items || []

        const { voidTransaction } = await import('@/services/transaction.service')
        const { revertBatchItem } = await import('@/services/batch.service')

        let count = 0
        for (const item of items || []) {
            if (item.transaction_id) {
                await voidTransaction(item.transaction_id)
                await revertBatchItem(item.transaction_id)
            } else {
                await pocketbaseUpdate<any>('batch_items', item.id, { status: 'pending' })
            }
            count++
        }

        revalidatePath('/batch')
        return { success: true, count }
    } catch (error: any) {
        console.error('Bulk unconfirm failed:', error)
        return { success: false, error: error.message }
    }
}
