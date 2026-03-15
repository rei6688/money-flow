'use server'

import { revalidatePath } from 'next/cache'
import { createBatch, createBatchFromClone } from '@/services/batch.service'
import { pocketbaseList, pocketbaseUpdate, toPocketBaseId } from '@/services/pocketbase/server'

/**
 * Create a fresh batch (empty)
 */
export async function createFreshBatchAction(params: {
    monthYear: string
    monthName: string
    bankType: 'MBB' | 'VIB'
}) {
    try {
        const batch = await createBatch({
            name: params.monthName,
            month_year: params.monthYear,
            bank_type: params.bankType,
            status: 'pending',

            is_template: false
        })

        revalidatePath(`/batch/${params.bankType.toLowerCase()}`)
        revalidatePath('/batch')

        return {
            success: true,
            data: batch
        }
    } catch (error) {
        console.error('Failed to create fresh batch:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create batch'
        }
    }
}

/**
 * Create a batch by cloning from another batch
 */
export async function createCloneBatchAction(params: {
    monthYear: string
    monthName: string
    bankType: 'MBB' | 'VIB'
    sourceBatchId: string
    amounts: Record<string, { amount: number; skip: boolean }>
}) {
    try {
        // Convert amounts to items array
        const items = Object.entries(params.amounts)
            .filter(([_, data]) => !data.skip && data.amount > 0)
            .map(([bankCode, data]) => ({
                bank_name: bankCode, // Will be mapped to full name in service
                bank_code: bankCode,
                amount: data.amount
            }))

        const batch = await createBatchFromClone({
            source_batch_id: params.sourceBatchId,
            month_year: params.monthYear,
            bank_type: params.bankType,
            items
        })

        revalidatePath(`/batch/${params.bankType.toLowerCase()}`)
        revalidatePath('/batch')

        return {
            success: true,
            data: batch
        }
    } catch (error) {
        console.error('Failed to create clone batch:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create batch'
        }
    }
}

/**
 * Get batch items for a specific batch
 */
export async function getBatchItemsAction(batchId: string) {
    try {
        const result = await pocketbaseList<any>('batch_items', {
            filter: `batch_id = "${toPocketBaseId(batchId, 'batches')}"`,
            sort: 'created',
            perPage: 1000,
        })

        return {
            success: true,
            data: result.items || []
        }
    } catch (error) {
        console.error('Failed to get batch items:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get batch items',
            data: []
        }
    }
}

/**
 * Set period on an existing batch record.
 */
export async function setBatchPeriodAction(batchId: string, period: 'before' | 'after') {
    try {
        const normalizedId = toPocketBaseId(batchId, 'batches')
        const data = await pocketbaseUpdate<any>('batches', normalizedId, {
            period,
            updated_at: new Date().toISOString(),
        })

        revalidatePath('/batch')
        return { success: true, data }
    } catch (error) {
        console.error('Failed to set batch period:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to set batch period',
        }
    }
}

/**
 * Set phase_id on an existing batch record.
 */
export async function setBatchPhaseAction(batchId: string, phaseId: string) {
    try {
        const normalizedId = toPocketBaseId(batchId, 'batches')
        const data = await pocketbaseUpdate<any>('batches', normalizedId, {
            phase_id: phaseId,
            updated_at: new Date().toISOString(),
        })

        revalidatePath('/batch')
        return { success: true, data }
    } catch (error) {
        console.error('Failed to set batch phase:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to set batch phase',
        }
    }
}
