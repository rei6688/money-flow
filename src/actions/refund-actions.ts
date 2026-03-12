'use server'

import { pocketbaseGetById, pocketbaseCreate, toPocketBaseId } from '@/services/pocketbase/server'
import { SYSTEM_ACCOUNTS } from '@/lib/constants'
import { revalidatePath } from 'next/cache'

/**
 * Confirm money received from pending refunds
 * Creates a transaction moving money from Pending Refunds to the target account
 */
export async function confirmRefundMoneyReceived(
    transactionId: string,
    targetAccountId: string
) {
    try {
        const pbTxnId = toPocketBaseId(transactionId, 'transactions');
        const pbTargetId = toPocketBaseId(targetAccountId, 'accounts');
        const pbPendingRefundsId = toPocketBaseId(SYSTEM_ACCOUNTS.PENDING_REFUNDS, 'accounts');

        // 1. Get the original transaction
        const originalTx = await pocketbaseGetById<any>('transactions', pbTxnId);

        if (!originalTx) {
            throw new Error('Transaction not found');
        }

        // Verify this is a refund to Pending Refunds
        if (originalTx.target_account_id !== pbPendingRefundsId) {
            throw new Error('Transaction is not a valid pending refund (Target != Pending Refunds)');
        }

        const refundAmount = Math.abs(originalTx.amount);

        // 2. Create new transaction (Transfer: Pending Refunds -> Target Account)
        const id = toPocketBaseId(crypto.randomUUID(), 'transactions');
        await pocketbaseCreate('transactions', {
            id,
            occurred_at: new Date().toISOString(),
            date: new Date().toISOString(),
            note: `Refund Received: ${originalTx.note || 'Pending refund'}`,
            status: 'posted',
            tag: 'REFUND_CONFIRMED',
            type: 'transfer',
            account_id: pbPendingRefundsId,
            target_account_id: pbTargetId,
            amount: -refundAmount, // Standard transfer logic: negative from source
        });

        // 3. Recalculate balances
        const { recalculateBalance } = await import('@/services/account.service');
        await recalculateBalance(SYSTEM_ACCOUNTS.PENDING_REFUNDS);
        await recalculateBalance(targetAccountId);

        revalidatePath('/');
        return { success: true, transactionId: id };
    } catch (error: any) {
        console.error('[DB:PB] confirmRefundMoneyReceived failed:', error);
        return { success: false, error: error.message };
    }
}

import { getPendingRefunds } from '@/services/transaction.service'

export async function getPendingRefundsAction() {
    return getPendingRefunds()
}
