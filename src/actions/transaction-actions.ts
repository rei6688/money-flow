'use server';

import { Json } from '@/types/database.types';
import { syncTransactionToSheet } from '@/services/sheet.service';
import { parseMetadata } from '@/lib/transaction-mapper';
import { normalizeMonthTag } from '@/lib/month-tag';
import { revalidatePath } from 'next/cache';
import { REFUND_PENDING_ACCOUNT_ID } from '@/constants/refunds';
import { CashbackMode } from '@/types/moneyflow.types';
import {
  createTransaction as createPBTransaction,
  updateTransaction as updatePBTransaction,
  voidTransaction as voidPBTransaction,
  confirmRefund as confirmPBRefund,
} from '@/services/transaction.service';
import {
  pocketbaseCreate,
  pocketbaseGetById,
  pocketbaseList,
  pocketbaseUpdate,
  toPocketBaseId,
} from '@/services/pocketbase/server';

export type CreateTransactionInput = {
  occurred_at: string;
  note: string;
  type: 'expense' | 'income' | 'debt' | 'transfer' | 'repayment' | 'credit_pay';
  source_account_id: string;
  person_id?: string | null;
  destination_account_id?: string | null;
  category_id?: string | null;
  debt_account_id?: string | null;
  amount: number;
  tag: string;
  cashback_share_percent?: number | null;
  cashback_share_fixed?: number | null;
  discount_category_id?: string | null;
  shop_id?: string | null;
  cashback_mode?: CashbackMode | null;
  linked_transaction_id?: string | null;
};

export async function createTransaction(input: CreateTransactionInput): Promise<string | null> {
  // 1. PB-PRIMARY Write (+ sheet sync handled inside service)
  const transactionId = await createPBTransaction(input as any);
  if (!transactionId) {
    console.error('[DB:PB] Failed to create transaction in PocketBase');
    return null;
  }

  return transactionId;
}

export async function updateTransaction(id: string, input: CreateTransactionInput): Promise<boolean> {
  const pbId = toPocketBaseId(id, 'transactions');
  
  // 1. PB-PRIMARY Write (+ sheet sync handled inside service)
  const success = await updatePBTransaction(pbId, input as any);
  if (!success) return false;

  return true;
}

export async function voidTransactionAction(id: string): Promise<boolean> {
  const pbId = toPocketBaseId(id, 'transactions');
  // Sheet sync is handled inside service layer.
  return await voidPBTransaction(pbId);
}

export async function restoreTransaction(id: string): Promise<boolean> {
  const pbId = toPocketBaseId(id, 'transactions');
  
  try {
    await pocketbaseUpdate('transactions', pbId, { status: 'posted' });
    
    const existing = await pocketbaseGetById<any>('transactions', pbId);
    const existingMeta =
      typeof existing?.metadata === 'object' && existing.metadata !== null
        ? existing.metadata
        : {};

    const originalTxnId =
      typeof existingMeta.original_transaction_id === 'string'
        ? existingMeta.original_transaction_id
        : null;
    const isRefundRequestTxn =
      Boolean(originalTxnId) && existingMeta.is_refund_confirmation !== true;

    if (isRefundRequestTxn && originalTxnId) {
      try {
        const originalTxn = await pocketbaseGetById<any>('transactions', originalTxnId);
        if (originalTxn) {
          const originalMeta =
            typeof originalTxn.metadata === 'object' && originalTxn.metadata !== null
              ? originalTxn.metadata
              : {};

          await pocketbaseUpdate('transactions', originalTxnId, {
            status: originalTxn.status === 'posted' ? 'waiting_refund' : originalTxn.status,
            metadata: {
              ...(originalMeta as Record<string, unknown>),
              has_refund_request: true,
              refund_status: 'requested',
              refund_request_id: pbId,
              refund_restored_at: new Date().toISOString(),
            },
          });
        }
      } catch (restoreRefundChainError) {
        console.warn('[DB:PB] restoreTransaction refund chain restore skipped:', restoreRefundChainError);
      }
    }

    // Sync restore to sheet
    if (existing?.person_id) {
       void syncTransactionToSheet(existing.person_id, {
         id: pbId,
         occurred_at: existing.occurred_at,
         note: existing.note,
         tag: existing.tag,
         amount: existing.amount,
         original_amount: existing.amount
       } as any, 'create').catch(err => console.error('Sheet Sync Error (Restore):', err));
    }

    revalidatePath('/transactions');
    return true;
  } catch (error) {
    console.error('[DB:PB] restoreTransaction failed:', error);
    return false;
  }
}

export async function confirmRefundAction(
  pendingTransactionId: string,
  targetAccountId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await confirmPBRefund(pendingTransactionId, targetAccountId);
    return result;
  } catch (error: any) {
    console.error('Confirm Refund Action Error:', error);
    return { success: false, error: error.message };
  }
}

export async function updateTransactionMetadata(id: string, metadata: any): Promise<boolean> {
  try {
    const pbId = toPocketBaseId(id, 'transactions');
    const existing = await pocketbaseGetById<any>('transactions', pbId);
    
    const newMetadata = {
      ...(typeof existing.metadata === 'object' ? existing.metadata : {}),
      ...metadata
    };

    await pocketbaseUpdate('transactions', pbId, { metadata: newMetadata });
    revalidatePath('/transactions');
    return true;
  } catch (error) {
    console.error('[DB:PB] updateTransactionMetadata failed:', error);
    return false;
  }
}

export async function deleteSplitBillAction(baseTransactionId: string): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
  try {
    const pbBaseId = toPocketBaseId(baseTransactionId, 'transactions');
    
    // 1. Find all child transactions
    // Note: PocketBase filter for JSON field might be tricky, usually metadata.split_parent_id
    const children = await pocketbaseList<any>('transactions', {
      filter: `metadata.split_parent_id = "${pbBaseId}"`,
      perPage: 500
    });

    let deletedCount = 0;
    
    // 2. Delete children
    for (const child of children.items) {
      await pocketbaseUpdate('transactions', child.id, { status: 'void' }); // Prefer voiding over hard delete for consistency
      deletedCount++;
    }

    // 3. Void base transaction
    await pocketbaseUpdate('transactions', pbBaseId, { status: 'void' });
    deletedCount++;

    revalidatePath('/transactions');
    return { success: true, deletedCount };
  } catch (error: any) {
    console.error('[DB:PB] deleteSplitBillAction failed:', error);
    return { success: false, error: error.message };
  }
}

export async function bulkMoveTransactionsToCategory(transactionIds: string[], categoryId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const pbCategoryId = toPocketBaseId(categoryId, 'categories');

    for (const id of transactionIds) {
      const pbTxnId = toPocketBaseId(id, 'transactions');
      await pocketbaseUpdate('transactions', pbTxnId, { category_id: pbCategoryId });
    }

    revalidatePath('/transactions');
    return { success: true };
  } catch (error: any) {
    console.error('[DB:PB] bulkMoveTransactionsToCategory failed:', error);
    return { success: false, error: error.message };
  }
}

export async function updateSplitBillAction(
  baseTransactionId: string,
  data: {
    title: string;
    note: string;
    qrImageUrl: string | null;
    participants: {
      personId: string;
      amount: number;
      isNew?: boolean;
      isRemoved?: boolean;
      transactionId?: string;
    }[];
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const pbBaseId = toPocketBaseId(baseTransactionId, 'transactions');
    const baseTxn = await pocketbaseGetById<any>('transactions', pbBaseId);

    // 1. Update base transaction
    const baseMetadata = {
      ...(typeof baseTxn.metadata === 'object' ? baseTxn.metadata : {}),
      title: data.title,
      note: data.note,
      qr_image_url: data.qrImageUrl
    };
    await pocketbaseUpdate('transactions', pbBaseId, { metadata: baseMetadata, note: data.note });

    // 2. Process participants
    for (const p of data.participants) {
      if (p.isRemoved && p.transactionId) {
        const pbChildId = toPocketBaseId(p.transactionId, 'transactions');
        await pocketbaseUpdate('transactions', pbChildId, { status: 'void' });
      } else if (p.isNew) {
        // Create new transaction for split
        const pbPersonId = toPocketBaseId(p.personId, 'people');
        // Find debt account for this person
        const personWithDebt = await pocketbaseGetById<any>('people', pbPersonId);
        const debtAccountId = personWithDebt.debt_account_id;

        if (!debtAccountId) {
          console.warn(`No debt account for person ${p.personId}`);
          continue;
        }

        await pocketbaseCreate('transactions', {
          date: baseTxn.date,
          amount: p.amount,
          type: 'debt',
          to_account_id: debtAccountId,
          from_account_id: baseTxn.from_account_id,
          person_id: pbPersonId,
          status: 'confirmed',
          metadata: {
            split_parent_id: pbBaseId,
            split_title: data.title
          }
        });
      } else if (p.transactionId) {
        const pbChildId = toPocketBaseId(p.transactionId, 'transactions');
        await pocketbaseUpdate('transactions', pbChildId, {
          amount: p.amount,
          metadata: {
            split_parent_id: pbBaseId,
            split_title: data.title
          }
        });
      }
    }

    revalidatePath('/transactions');
    return { success: true };
  } catch (error: any) {
    console.error('[DB:PB] updateSplitBillAction failed:', error);
    return { success: false, error: error.message };
  }
}

export async function bulkMoveToCategory(transactionIds: string[], categoryId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const pbCatId = toPocketBaseId(categoryId, 'categories');
    for (const id of transactionIds) {
      const pbId = toPocketBaseId(id, 'transactions');
      await pocketbaseUpdate('transactions', pbId, { category_id: pbCatId });
    }
    revalidatePath('/transactions');
    return { success: true };
  } catch (error: any) {
    console.error('[DB:PB] bulkMoveToCategory failed:', error);
    return { success: false, error: error.message };
  }
}

export async function getOriginalAccount(refundRequestId: string): Promise<any | null> {
  try {
    const pbId = toPocketBaseId(refundRequestId, 'transactions');
    const record = await pocketbaseGetById<any>('transactions', pbId);
    if (!record) return null;

    const meta = parseMetadata(record.metadata);
    const originalAccountId = meta?.original_account_id;
    if (!originalAccountId) return null;

    const account = await pocketbaseGetById<any>('accounts', originalAccountId as string);
    if (!account) return null;

    return {
      id: account.id,
      name: account.name,
      type: account.type || 'general',
      image_url: account.image_url,
      current_balance: account.current_balance || 0
    };
  } catch (err) {
    console.error('getOriginalAccount failed:', err);
    return null;
  }
}

/**
 * Marks a transaction as waiting for refund.
 */
export async function requestRefund(
  transactionId: string,
  amount: number,
  isPartial: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const pbId = toPocketBaseId(transactionId, 'transactions');
    const existing = await pocketbaseGetById<any>('transactions', pbId);
    if (!existing) throw new Error('Transaction not found');

    const existingMeta =
      typeof existing.metadata === 'object' && existing.metadata !== null
        ? existing.metadata
        : {};

    if (existingMeta.refund_request_id) {
      return { success: true };
    }

    const refundAmount = Math.max(0, Math.abs(Number(amount || 0)));
    if (refundAmount <= 0) {
      return { success: false, error: 'Refund amount must be positive' };
    }

    const pendingRefundId = toPocketBaseId(
      `${pbId}:refund:${Date.now()}:${Math.random()}`,
      'transactions',
    );
    const shortId = (value: string | null | undefined) => String(value || '').slice(0, 6)
    const gd1Tag = `[GD1|${shortId(pbId)}→${shortId(pendingRefundId)}]`
    const gd2Tag = `[GD2|${shortId(pbId)}]`
    const pendingRefundAccountId = toPocketBaseId(
      REFUND_PENDING_ACCOUNT_ID,
      'accounts',
    );

    const pendingMeta = {
      original_transaction_id: pbId,
      original_account_id: existing.account_id || null,
      original_transaction_type: existing.type || null,
      has_refund_request: true,
      is_refund_confirmation: false,
      refund_amount: refundAmount,
      is_partial_refund: isPartial,
      refund_requested_at: new Date().toISOString(),
      refund_stage_tag: 'GD2',
      refund_sequence: 2,
      ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
    };

    await pocketbaseCreate('transactions', {
      id: pendingRefundId,
      date: existing.date || existing.occurred_at || new Date().toISOString(),
      occurred_at: existing.occurred_at || existing.date || new Date().toISOString(),
      note: `${gd2Tag} Refund for: ${existing.note || existing.description || 'Order'}`,
      description: `${gd2Tag} Refund for: ${existing.note || existing.description || 'Order'}`,
      type: existing.type || 'expense',
      status: 'pending',
      amount: refundAmount,
      final_price: refundAmount,
      account_id: pendingRefundAccountId,
      to_account_id: existing.account_id || null,
      category_id: existing.category_id || null,
      person_id: existing.person_id || null,
      shop_id: existing.shop_id || null,
      tag: existing.tag || null,
      debt_cycle_tag: existing.debt_cycle_tag || existing.tag || null,
      persisted_cycle_tag: existing.persisted_cycle_tag || null,
      cashback_share_percent: 0,
      cashback_share_fixed: 0,
      cashback_mode: 'none_back',
      metadata: pendingMeta,
    });

    const updateData: any = {
      status: 'waiting_refund',
      note:
        typeof existing.note === 'string' && existing.note.startsWith('[GD1|')
          ? existing.note
          : `${gd1Tag} ${existing.note || existing.description || 'Order'}`,
      metadata: {
        ...(existingMeta as Record<string, unknown>),
        has_refund_request: true,
        refund_amount: refundAmount,
        is_partial_refund: isPartial,
        refund_requested_at: new Date().toISOString(),
        refund_request_id: pendingRefundId,
        refund_status: 'requested',
        refund_stage_tag: 'GD1',
        refund_sequence: 1,
      }
    };

    await pocketbaseUpdate('transactions', pbId, updateData);
    try {
      revalidatePath('/transactions');
    } catch (revalidateError) {
      console.warn('[DB:PB] requestRefund revalidate skipped:', revalidateError);
    }
    return { success: true };
  } catch (error: any) {
    console.error('[DB:PB] requestRefund failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancels an order and requests a full refund.
 */
export async function cancelOrder(transactionId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const pbId = toPocketBaseId(transactionId, 'transactions');
    const existing = await pocketbaseGetById<any>('transactions', pbId);
    if (!existing) throw new Error('Transaction not found');

    const amount = Math.abs(existing.amount);
    return await requestRefund(transactionId, amount, false);
  } catch (error: any) {
    console.error('[DB:PB] cancelOrder failed:', error);
    return { success: false, error: error.message };
  }
}
