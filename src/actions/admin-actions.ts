'use server'

import { pocketbaseList } from '@/services/pocketbase/server'
import { recalculateBalance } from '@/services/account.service'
import { revalidatePath } from 'next/cache'

export async function fixAllAccountBalances() {
    try {
        // 1. Get all accounts from PB
        const response = await pocketbaseList<any>('accounts', {
            perPage: 500
        });
        const accounts = response.items;

        if (!accounts || accounts.length === 0) {
            return { success: true, message: 'No accounts found' }
        }

        // 2. Recalculate each account
        let successCount = 0
        let failCount = 0

        for (const account of accounts) {
            try {
                // recalculateBalance already uses PocketBase internal
                const result = await recalculateBalance(account.id)
                if (result) successCount++
                else failCount++
            } catch (e) {
                console.error(`[DB:PB] Failed to recalculate account ${account.name} (${account.id})`, e)
                failCount++
            }
        }

        revalidatePath('/accounts')

        return {
            success: true,
            message: `Recalculated ${successCount} accounts. Failed: ${failCount}`
        }
    } catch (error: any) {
        console.error('[DB:PB] Error in fixAllAccountBalances:', error)
        return { success: false, error: error.message }
    }
}
