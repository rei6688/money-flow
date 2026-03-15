'use server'

import { pocketbaseCreate, pocketbaseUpdate, pocketbaseDelete, pocketbaseList, toPocketBaseId } from '@/services/pocketbase/server'
import { revalidatePath } from 'next/cache'
import { syncTransactionToSheet } from '@/services/sheet.service'

/**
 * Handles batch debt repayment.
 * 1. Creates a PARENT transaction (Real Money In to Bank).
 * 2. Creates CHILD transactions (Virtual Allocations to Person's Debt Cycles).
 */
export async function repayBatchDebt(
    personId: string,
    totalAmount: number,
    bankAccountId: string,
    allocations: Record<string, number>, // Maps tagLabel -> amount
    note?: string
) {
    try {
        const pbPersonId = toPocketBaseId(personId, 'people');
        const pbBankAccountId = toPocketBaseId(bankAccountId, 'accounts');

        // 1. Create PARENT Transaction (Money Movement)
        const parentId = toPocketBaseId(crypto.randomUUID(), 'transactions');
        const parentTxn = {
            id: parentId,
            occurred_at: new Date().toISOString(),
            date: new Date().toISOString(),
            note: note ? `Repayment: ${note}` : 'Debt Repayment (Batch)',
            description: note ? `Repayment: ${note}` : 'Debt Repayment (Batch)',
            type: 'income',
            account_id: pbBankAccountId,
            amount: Math.abs(totalAmount),
            person_id: null,
            metadata: {
                is_debt_repayment_parent: true,
                original_person_id: pbPersonId
            },
            status: 'posted'
        }

        const parent = await pocketbaseCreate<any>('transactions', parentTxn);

        // 2. Create CHILD Transactions (Allocations)
        const childrenToInsert = Object.entries(allocations)
            .filter(([_, amount]) => amount > 0)
            .map(([tag, amount]) => ({
                id: toPocketBaseId(crypto.randomUUID(), 'transactions'),
                occurred_at: new Date().toISOString(),
                date: new Date().toISOString(),
                note: `Allocated Repayment for ${tag}`,
                description: `Allocated Repayment for ${tag}`,
                type: 'repayment',
                account_id: pbBankAccountId,
                person_id: pbPersonId,
                amount: Math.abs(amount),
                tag: tag,
                linked_transaction_id: parent.id,
                status: 'posted',
                metadata: {
                    is_debt_repayment_child: true,
                    parent_transaction_id: parent.id
                }
            }));

        // Handle Excess (Unallocated)
        const allocatedSum = Object.values(allocations).reduce((a, b) => a + b, 0)
        const excess = Math.abs(totalAmount) - allocatedSum

        if (excess > 0.01) {
            childrenToInsert.push({
                id: toPocketBaseId(crypto.randomUUID(), 'transactions'),
                occurred_at: new Date().toISOString(),
                date: new Date().toISOString(),
                note: `Unallocated Repayment (Excess)`,
                description: `Unallocated Repayment (Excess)`,
                type: 'repayment',
                account_id: pbBankAccountId,
                person_id: pbPersonId,
                amount: excess,
                tag: null,
                linked_transaction_id: parent.id,
                status: 'posted',
                metadata: {
                    is_debt_repayment_child: true,
                    is_excess: true,
                    parent_transaction_id: parent.id
                } as any
            })
        }

        // PocketBase sequential creation for children
        const createdChildren = [];
        try {
            for (const child of childrenToInsert) {
                const created = await pocketbaseCreate<any>('transactions', child);
                createdChildren.push(created);

                await syncTransactionToSheet(pbPersonId, {
                    id: created.id,
                    occurred_at: created.occurred_at,
                    note: created.note,
                    tag: created.tag || null,
                    amount: Math.abs(Number(created.amount || 0)),
                    original_amount: Math.abs(Number(created.amount || 0)),
                    type: created.type,
                    status: created.status || 'posted',
                } as any, 'create');
            }
        } catch (childError) {
            console.error("[DB:PB] Child Creation Error:", childError);
            // Rollback parent
            await pocketbaseDelete('transactions', parent.id);
            throw childError;
        }

        // 3. Recalculate Bank Balance
        const { recalculateBalance, getAccountDetails } = await import('@/services/account.service')

        let bankName = "Bank Transfer"
        try {
            const bankAccount = await getAccountDetails(bankAccountId)
            if (bankAccount) bankName = bankAccount.name
        } catch (e) {
            console.warn("Could not fetch bank name for repayment tag", e)
        }

        // Update Parent with Shop Name (for Sync)
        await pocketbaseUpdate('transactions', parent.id, { shop: bankName });
        await recalculateBalance(bankAccountId);

        // 4. Revalidate UI
        revalidatePath('/people')
        revalidatePath(`/people/${personId}`)
        revalidatePath('/transactions')
        revalidatePath('/accounts')

        return { success: true, parentId: parent.id }

    } catch (error: any) {
        console.error("[DB:PB] repayBatchDebt failed:", error)
        return { success: false, error: error.message }
    }
}
