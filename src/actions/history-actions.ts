'use server'

import { pocketbaseList, pocketbaseGetById, toPocketBaseId } from '@/services/pocketbase/server'

type TransactionHistoryPbRecord = {
    id: string
    transaction_id?: string | null
    snapshot_before?: unknown
    change_type?: 'edit' | 'void' | string
    created?: string
    changed_by?: string | null
}

type PocketBaseTransactionRecord = Record<string, unknown>

export type TransactionHistoryRecord = {
    id: string
    transaction_id: string
    snapshot_before: Record<string, unknown>
    change_type: 'edit' | 'void'
    created_at: string
    changed_by: string | null
    changed_by_email?: string | null
}

export type HistoryDiff = {
    field: string
    oldValue: unknown
    newValue: unknown
}

export type TransactionHistoryWithDiff = TransactionHistoryRecord & {
    diffs: HistoryDiff[]
}

/**
 * Fetch transaction history for a given transaction ID
 */
export async function getTransactionHistory(
    transactionId: string
): Promise<{ success: boolean; data?: TransactionHistoryWithDiff[]; error?: string }> {
    try {
        const pbTxnId = toPocketBaseId(transactionId, 'transactions');

        let historyItems: TransactionHistoryPbRecord[] = []

        // Primary query: direct relation by transaction_id.
        // Some migrated datasets can trigger PB 400 for filtered JSON/relation queries,
        // so we guard and gracefully fallback to in-app filtering.
        try {
            const historyResp = await pocketbaseList<TransactionHistoryPbRecord>('transaction_history', {
                filter: `transaction_id = "${pbTxnId}"`,
                sort: '-created', // PocketBase uses 'created' for timestamp
                perPage: 100
            });
            historyItems = historyResp.items || []
        } catch {
            historyItems = []
        }

        // Fallback for legacy migrated rows where transaction_id may be empty
        // and the transaction reference lives inside snapshot_before.id.
        if (!historyItems.length) {
            const fallbackAttempts: Array<Record<string, string | number>> = [
                { sort: '-created', perPage: 200 },
                { perPage: 200 },
                { sort: '-changed_at', perPage: 100 },
                { perPage: 100 },
            ]

            for (const params of fallbackAttempts) {
                try {
                    const fallbackResp = await pocketbaseList<TransactionHistoryPbRecord>('transaction_history', params)
                    historyItems = (fallbackResp.items || []).filter((item) => {
                        const snapshot = parseSnapshot(item.snapshot_before)
                        const relationId = String(item.transaction_id || '')
                        const snapshotId = String(snapshot.id || '')
                        return relationId === pbTxnId || snapshotId === pbTxnId || snapshotId === transactionId
                    })
                    if (historyItems.length > 0) break
                } catch {
                    // Keep trying next fallback shape.
                }
            }
        }

        // Fetch current transaction state for comparison
        const currentTxn = await pocketbaseGetById<PocketBaseTransactionRecord>('transactions', pbTxnId);

        // Parse snapshots and compute diffs
        const result: TransactionHistoryWithDiff[] = []

        for (let i = 0; i < historyItems.length; i++) {
            const record = historyItems[i]
            const snapshotBefore = parseSnapshot(record.snapshot_before)

            // Get the "after" state - either the next snapshot or current transaction
            let snapshotAfter: Record<string, unknown>
            if (i === 0) {
                // Most recent change - compare to current state
                snapshotAfter = currentTxn ? flattenTransaction(currentTxn) : {}
            } else {
                // Compare to the previous snapshot (which is more recent in our desc order)
                snapshotAfter = parseSnapshot(historyItems[i - 1].snapshot_before)
            }

            const diffs = computeDiffs(snapshotBefore, snapshotAfter)

            result.push({
                id: record.id,
                transaction_id: String(record.transaction_id || ''),
                snapshot_before: snapshotBefore,
                change_type: record.change_type === 'void' ? 'void' : 'edit',
                created_at: record.created || '', // Use PB created timestamp
                changed_by: record.changed_by || null,
                changed_by_email: null, // PB doesn't expose this easily here
                diffs,
            })
        }

        return { success: true, data: result }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred'
        console.error('[DB:PB] getTransactionHistory failed:', error)
        return { success: false, error: message }
    }
}

/**
 * Check if a transaction has any history records
 */
export async function hasTransactionHistory(transactionId: string): Promise<boolean> {
    try {
        const pbTxnId = toPocketBaseId(transactionId, 'transactions');
        try {
            const resp = await pocketbaseList<TransactionHistoryPbRecord>('transaction_history', {
                filter: `transaction_id = "${pbTxnId}"`,
                perPage: 1
            });

            if (resp.totalItems > 0) return true
        } catch {
            // Ignore and use fallback scan below.
        }

        const fallbackAttempts: Array<Record<string, string | number>> = [
            { sort: '-created', perPage: 200 },
            { perPage: 200 },
            { sort: '-changed_at', perPage: 100 },
            { perPage: 100 },
        ]

        for (const params of fallbackAttempts) {
            try {
                const fallbackResp = await pocketbaseList<TransactionHistoryPbRecord>('transaction_history', params)
                const found = (fallbackResp.items || []).some((item) => {
                    const snapshot = parseSnapshot(item.snapshot_before)
                    const relationId = String(item.transaction_id || '')
                    const snapshotId = String(snapshot.id || '')
                    return relationId === pbTxnId || snapshotId === pbTxnId || snapshotId === transactionId
                })
                if (found) return true
            } catch {
                // Keep trying next fallback shape.
            }
        }

        return false
    } catch {
        return false
    }
}

/**
 * Parse snapshot_before JSON safely
 */
function parseSnapshot(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null) {
        return value as Record<string, unknown>
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return {}
        }
    }
    return {}
}

/**
 * Flatten transaction object for comparison
 */
function flattenTransaction(txn: Record<string, unknown>): Record<string, unknown> {
    // Keep only relevant fields for comparison
    const relevantFields = [
        'amount', 'original_amount', 'occurred_at', 'note', 'status',
        'category_id', 'account_id', 'target_account_id', 'person_id',
        'shop_id', 'type', 'cashback_share_percent', 'cashback_share_fixed',
        'tag', 'metadata', 'debt_cycle_tag', 'persisted_cycle_tag',
        'statement_cycle_tag', 'final_price', 'date'
    ]

    const result: Record<string, unknown> = {}
    for (const field of relevantFields) {
        if (field in txn) {
            result[field] = txn[field]
        }
    }

    // Normalise legacy/current transaction date keys for stable comparison.
    if (!('occurred_at' in result) && 'date' in result) {
        result.occurred_at = result.date
    }

    if (!('date' in result) && 'occurred_at' in result) {
        result.date = result.occurred_at
    }

    return result
}

/**
 * Compute differences between two snapshots
 */
function computeDiffs(
    before: Record<string, unknown>,
    after: Record<string, unknown>
): HistoryDiff[] {
    const diffs: HistoryDiff[] = []
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

    // Fields to skip in diff display
    const skipFields = ['id', 'created', 'updated', 'user_id', 'collectionId', 'collectionName']

    // Human-readable field names
    const fieldLabels: Record<string, string> = {
        amount: 'Amount',
        original_amount: 'Original Amount',
        occurred_at: 'Date',
        date: 'Date',
        note: 'Note',
        status: 'Status',
        category_id: 'Category',
        account_id: 'Account',
        target_account_id: 'Target Account',
        person_id: 'Person',
        shop_id: 'Shop',
        type: 'Type',
        cashback_share_percent: 'Cashback %',
        cashback_share_fixed: 'Cashback Fixed',
        tag: 'Tag',
        debt_cycle_tag: 'Debt Cycle Tag',
        persisted_cycle_tag: 'Persisted Cycle Tag',
        statement_cycle_tag: 'Statement Cycle Tag',
        final_price: 'Final Price',
    }

    for (const key of allKeys) {
        if (skipFields.includes(key)) continue

        const oldVal = before[key]
        const newVal = after[key]

        // Skip if both are null/undefined
        if (oldVal == null && newVal == null) continue

        // Check if values are different
        if (!deepEqual(oldVal, newVal)) {
            diffs.push({
                field: fieldLabels[key] || formatFieldName(key),
                oldValue: oldVal,
                newValue: newVal,
            })
        }
    }

    return diffs
}

/**
 * Deep equality check
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== typeof b) return false

    if (typeof a === 'object') {
        const aJson = JSON.stringify(a)
        const bJson = JSON.stringify(b)
        return aJson === bJson
    }

    return false
}

/**
 * Format field name to human-readable
 */
function formatFieldName(field: string): string {
    return field
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
}
