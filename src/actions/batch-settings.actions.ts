'use server'

import { pocketbaseCreate, pocketbaseList, pocketbaseUpdate, toPocketBaseId } from '@/services/pocketbase/server'
import { revalidatePath } from 'next/cache'

async function getBatchSettingsRecord(bankType: 'MBB' | 'VIB') {
    const result = await pocketbaseList<any>('batch_settings', {
        filter: `bank_type = "${bankType}"`,
        perPage: 1,
    })
    return result.items[0] || null
}

export async function updateBatchSettingsAction(
    bankType: 'MBB' | 'VIB',
    settings: {
        sheet_url?: string | null
        webhook_url?: string | null
        image_url?: string | null
        cutoff_day?: number | null
        display_sheet_url?: string | null
        display_sheet_name?: string | null
        sheet_name?: string | null
    }
) {
    try {
        const existing = await getBatchSettingsRecord(bankType)
        const payload = {
            ...settings,
            bank_type: bankType,
            updated_at: new Date().toISOString(),
        }

        const data = existing
            ? await pocketbaseUpdate<any>('batch_settings', existing.id, payload)
            : await pocketbaseCreate<any>('batch_settings', {
                id: toPocketBaseId(`batch-settings:${bankType}`, 'batchsettings'),
                ...payload,
            })

        revalidatePath('/batch')
        revalidatePath('/batch/settings')

        return { success: true, data }
    } catch (error: any) {
        console.error('Error updating batch settings:', error)
        return { success: false, error: error.message }
    }
}

export async function getBatchSettingsAction(bankType: 'MBB' | 'VIB') {
    try {
        const data = await getBatchSettingsRecord(bankType)
        if (!data) {
            return { success: false, error: `No batch settings found for ${bankType}` }
        }

        return { success: true, data }
    } catch (error: any) {
        console.error('Error fetching batch settings:', error)
        return { success: false, error: error.message }
    }
}
