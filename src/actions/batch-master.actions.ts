'use server'

import { pocketbaseCreate, pocketbaseDelete, pocketbaseList, pocketbaseUpdate, toPocketBaseId } from '@/services/pocketbase/server'
import { revalidatePath } from 'next/cache'
import { BatchMasterItem } from '@/services/batch-master.service'

function mapBatchMasterItem(record: any): any {
    return {
        ...record,
        phase_id: record?.phase_id || null,
        accounts: record?.expand?.target_account_id || null,
        categories: record?.expand?.category_id || null,
        phases: record?.expand?.phase_id || null,
    }
}

function normalizeMasterPayload(item: Partial<BatchMasterItem>, id: string) {
    return {
        ...item,
        id,
        is_active: item.is_active ?? true,
        target_account_id: item.target_account_id || null,
        category_id: item.category_id || null,
        phase_id: item.phase_id || null,
        updated_at: new Date().toISOString(),
    }
}

function isUnknownFieldError(error: unknown, fieldName: string) {
    const message = String((error as any)?.message || '')
    return message.includes(`\"${fieldName}\"`) || message.includes(`'${fieldName}'`)
}

/**
 * Action to upsert a master checklist item
 */
export async function upsertBatchMasterItemAction(item: Partial<BatchMasterItem>) {
    try {
        const id = item.id ? toPocketBaseId(item.id, 'batchmaster') : toPocketBaseId(`${item.bank_type || 'MBB'}:${item.bank_number || ''}:${Date.now()}`, 'batchmaster')
        const payload = normalizeMasterPayload(item, id)

        let data: any
        try {
            data = item.id
                ? await pocketbaseUpdate<any>('batch_master_items', id, payload)
                : await pocketbaseCreate<any>('batch_master_items', payload)
        } catch (error) {
            if (!isUnknownFieldError(error, 'phase_id')) throw error

            const { phase_id: _phaseId, ...fallbackPayload } = payload as any
            data = item.id
                ? await pocketbaseUpdate<any>('batch_master_items', id, fallbackPayload)
                : await pocketbaseCreate<any>('batch_master_items', fallbackPayload)
        }

        revalidatePath('/batch/settings')
        revalidatePath('/batch')

        return { success: true, data: mapBatchMasterItem(data) }
    } catch (error: any) {
        console.error('Error upserting batch master item:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Action to delete a master checklist item
 */
export async function deleteBatchMasterItemAction(id: string) {
    try {
        await pocketbaseDelete('batch_master_items', toPocketBaseId(id, 'batchmaster'))

        revalidatePath('/batch/settings')
        revalidatePath('/batch')

        return { success: true }
    } catch (error: any) {
        console.error('Error deleting batch master item:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Action to get master items (Server Side)
 */
export async function getBatchMasterItemsAction(bankType?: 'MBB' | 'VIB') {
    try {
        const filterParts: string[] = ['is_active = true']
        if (bankType) filterParts.push(`bank_type = "${bankType}"`)
        const filter = filterParts.join(' && ')

        let result
        try {
            result = await pocketbaseList<any>('batch_master_items', {
                filter,
                sort: 'sort_order',
                perPage: 500,
                expand: 'target_account_id,category_id,phase_id',
            })
        } catch (error) {
            if (!isUnknownFieldError(error, 'phase_id')) throw error
            result = await pocketbaseList<any>('batch_master_items', {
                filter,
                sort: 'sort_order',
                perPage: 500,
                expand: 'target_account_id,category_id',
            })
        }

        return { success: true, data: result.items.map(mapBatchMasterItem) }
    } catch (error: any) {
        console.error('Error fetching batch master items:', error)
        return { success: false, error: error.message }
    }
}
