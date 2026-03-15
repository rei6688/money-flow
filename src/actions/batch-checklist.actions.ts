'use server'

import { pocketbaseList } from '@/services/pocketbase/server'

/**
 * Fetch all data needed for the 12-month recurring checklist
 */
export async function getChecklistDataAction(bankType: 'MBB' | 'VIB', year: number = new Date().getFullYear()) {
    try {
        // 1. Fetch Master Items
        const masterResult = await pocketbaseList<any>('batch_master_items', {
            filter: `bank_type = "${bankType}" && is_active = true`,
            sort: 'sort_order',
            perPage: 1000,
            expand: 'target_account_id',
        })
        const masterItems = masterResult.items.map((item: any) => ({
            ...item,
            accounts: item?.expand?.target_account_id || null,
        }))

        // 2. Fetch Batches for the given year
        const yearPattern = `${year}-`
        const batchesResult = await pocketbaseList<any>('batches', {
            filter: `bank_type = "${bankType}" && month_year ~ "${yearPattern}"`,
            perPage: 500,
            sort: 'month_year',
        })
        const batches = batchesResult.items || []

        // 2b. Fetch all batch_items for loaded batches
        const batchIds = batches.map((b: any) => b.id).filter(Boolean)
        let batchItems: any[] = []
        if (batchIds.length > 0) {
            const batchFilter = batchIds.map((id: string) => `batch_id = "${id}"`).join(' || ')
            const batchItemsResult = await pocketbaseList<any>('batch_items', {
                filter: batchFilter,
                perPage: 5000,
            })
            batchItems = batchItemsResult.items || []
        }

        // 3. Fetch active phases for this bank type (isolated, non-fatal)
        let phases: any[] = []
        try {
            const phasesResult = await pocketbaseList<any>('batch_phases', {
                filter: `bank_type = "${bankType}" && is_active = true`,
                perPage: 100,
                sort: 'sort_order',
            })
            phases = phasesResult.items || []
        } catch (phaseErr: any) {
            console.warn('batch_phases fetch failed (non-fatal):', phaseErr?.message)
        }

        // Fetch Funding Txns
        const fundingTxnIds = batches.map((b: any) => b.funding_transaction_id).filter(Boolean) || []
        let fundingTxns: any[] = []
        if (fundingTxnIds.length > 0) {
            const txnFilter = fundingTxnIds.map((id: string) => `id = "${id}"`).join(' || ')
            const txnsResult = await pocketbaseList<any>('transactions', {
                filter: txnFilter,
                perPage: 500,
                expand: 'account_id,target_account_id',
            })
            fundingTxns = (txnsResult.items || []).map((txn: any) => ({
                ...txn,
                account: txn?.expand?.account_id || null,
                target_account: txn?.expand?.target_account_id || null,
            }))
        }

        // Fallback: for migrated PB data, funding_transaction_id may be missing on batch
        // while transaction exists with metadata.batch_id + step1 markers.
        const fallbackFundingByBatch = new Map<string, any>()
        const batchesMissingFunding = batches.filter((b: any) => !b.funding_transaction_id)
        for (const b of batchesMissingFunding) {
            try {
                const escapedBatchId = String(b.id || '').replace(/"/g, '\\"')
                const fallbackFilter = `metadata ~ "\\\"batch_id\\\":\\\"${escapedBatchId}\\\"" && (metadata ~ "\\\"batch_step\\\":\\\"step1\\\"" || metadata ~ "\\\"type\\\":\\\"batch_funding\\\"")`
                const fallbackTxns = await pocketbaseList<any>('transactions', {
                    filter: fallbackFilter,
                    perPage: 1,
                    sort: '-created',
                    expand: 'account_id,target_account_id',
                })
                const txn = fallbackTxns.items?.[0]
                if (txn) {
                    fallbackFundingByBatch.set(b.id, {
                        ...txn,
                        account: txn?.expand?.account_id || null,
                        target_account: txn?.expand?.target_account_id || null,
                    })
                }
            } catch {
                // non-fatal fallback lookup
            }
        }

        const enrichedBatches = batches.map((b: any) => ({
            ...b,
            batch_items: batchItems.filter((item: any) => item.batch_id === b.id),
            funding_transaction: fundingTxns.find((t: any) => t.id === b.funding_transaction_id) || fallbackFundingByBatch.get(b.id) || null
        }))

        return {
            success: true,
            data: {
                masterItems,
                batches: enrichedBatches,
                phases: phases || []
            }
        }
    } catch (error: any) {
        console.error('Failed to fetch checklist data:', error)
        return { success: false, error: error.message }
    }
}
