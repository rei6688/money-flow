/**
 * PocketBase Transaction Service
 * Phase 3: Transaction read migration to PB-first pattern
 * 
 * Key Features:
 * - Maps PB transaction schema to TransactionWithDetails
 * - Handles dual-ID bridge for account linking (PB base32 ↔ SB UUID)
 * - Preserves all business logic (void, refund, split bills)
 * - Compatible with existing transaction service layer
 * 
 * Note: This is a utility module, not a Server Actions module.
 * Functions here are called from other server-side code.
 */

import { Json } from "@/types/database.types";
import { CashbackMode } from "@/types/moneyflow.types";

/**
 * PocketBase transaction record structure
 * Collection: pvl_txn_001
 */
type PocketBaseTransaction = {
  id: string; // PB base32 ID
  account_id: string; // Can be PB or SB account ID
  to_account_id: string; // Target account for transfers
  date: string; // ISO date
  description: string; // Transaction details
  amount: number; // Raw amount
  final_price: number; // Amount after cashback
  type: 'income' | 'expense' | 'transfer' | 'debt' | 'repayment';
  category_id: string;
  shop_id: string;
  person_id: string;
  cashback_amount: number;
  is_installment: boolean;
  parent_transaction_id: string;
  metadata: {
    persisted_cycle_tag?: string | null;
    cashback_mode?: CashbackMode | null;
    cashback_share_percent?: number | null;
    cashback_share_fixed?: number | null;
    is_invest?: boolean;
    [key: string]: any;
  } | null;
  collectionId: string;
  collectionName: string;
};

/**
 * Flat transaction row matching Supabase schema
 * This is the intermediate format before mapping to TransactionWithDetails
 */
type FlatTransactionRow = {
  id: string;
  occurred_at: string;
  note: string | null;
  status: 'posted' | 'pending' | 'void' | 'waiting_refund' | 'refunded' | 'completed';
  tag: string | null;
  created_at: string;
  created_by: string | null;
  amount: number;
  type: 'income' | 'expense' | 'transfer' | 'debt' | 'repayment';
  account_id: string;
  target_account_id: string | null;
  category_id: string | null;
  person_id: string | null;
  metadata: Json | null;
  shop_id: string | null;
  persisted_cycle_tag?: string | null;
  is_installment?: boolean | null;
  installment_plan_id?: string | null;
  cashback_share_percent?: number | null;
  cashback_share_fixed?: number | null;
  cashback_share_amount?: number | null;
  cashback_mode?: CashbackMode | null;
  currency?: string | null;
  linked_transaction_id?: string | null;
  final_price?: number | null;
  transaction_history?: { count: number }[];
  cashback_entries?: { amount: number; mode: string; metadata: Json | null }[];
};

export type PocketBaseTransactionMutationInput = {
  occurred_at: string;
  note?: string | null;
  amount: number;
  type: 'income' | 'expense' | 'transfer' | 'debt' | 'repayment';
  account_id: string;
  target_account_id?: string | null;
  category_id?: string | null;
  person_id?: string | null;
  shop_id?: string | null;
  metadata?: Json | null;
  is_installment?: boolean;
  linked_transaction_id?: string | null;
  persisted_cycle_tag?: string | null;
  cashback_mode?: CashbackMode | null;
  cashback_share_percent?: number | null;
  cashback_share_fixed?: number | null;
  final_price?: number | null;
};

const PB_API_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://api-db.reiwarden.io.vn';
const PB_TXN_COLLECTION = 'pvl_txn_001';

function buildPocketBaseMutationPayload(input: PocketBaseTransactionMutationInput) {
  const baseMetadata = (input.metadata && typeof input.metadata === 'object')
    ? { ...(input.metadata as Record<string, unknown>) }
    : {};

  const metadata = {
    ...baseMetadata,
    persisted_cycle_tag: input.persisted_cycle_tag ?? null,
    cashback_mode: input.cashback_mode ?? null,
    cashback_share_percent: input.cashback_share_percent ?? null,
    cashback_share_fixed: input.cashback_share_fixed ?? null,
  };

  return {
    date: input.occurred_at,
    description: input.note ?? '',
    amount: input.amount,
    final_price: input.final_price ?? input.amount,
    type: input.type,
    account_id: input.account_id,
    to_account_id: input.target_account_id ?? '',
    category_id: input.category_id ?? '',
    person_id: input.person_id ?? '',
    shop_id: input.shop_id ?? '',
    cashback_amount: 0,
    is_installment: Boolean(input.is_installment),
    parent_transaction_id: input.linked_transaction_id ?? '',
    metadata,
  };
}

/**
 * Map PocketBase transaction record to FlatTransactionRow format
 * This bridges PB schema → SB schema for compatibility
 */
export function mapPocketBaseTransactionRow(
  record: PocketBaseTransaction
): FlatTransactionRow {
  // Extract metadata fields
  const metadata = record.metadata || {};
  const persistedCycleTag = metadata.persisted_cycle_tag || null;
  const cashbackMode = metadata.cashback_mode || null;
  const cashbackSharePercent = metadata.cashback_share_percent || null;
  const cashbackShareFixed = metadata.cashback_share_fixed || null;

  // Map PB fields to SB schema
  return {
    id: record.id,
    occurred_at: record.date,
    note: record.description || null,
    status: 'posted', // PB doesn't have status field, default to 'posted'
    tag: null, // PB doesn't use tag field currently
    created_at: record.date, // Use transaction date as created_at
    created_by: null, // PB doesn't track creator
    amount: record.amount,
    type: record.type,
    account_id: record.account_id || '',
    target_account_id: record.to_account_id || null,
    category_id: record.category_id || null,
    person_id: record.person_id || null,
    metadata: record.metadata as Json,
    shop_id: record.shop_id || null,
    persisted_cycle_tag: persistedCycleTag,
    is_installment: record.is_installment || null,
    installment_plan_id: null, // PB uses parent_transaction_id instead
    cashback_share_percent: cashbackSharePercent,
    cashback_share_fixed: cashbackShareFixed,
    cashback_share_amount: null, // Calculated later
    cashback_mode: cashbackMode,
    currency: 'VND', // Default currency
    linked_transaction_id: record.parent_transaction_id || null,
    final_price: record.final_price || null,
    transaction_history: [], // Not tracked in PB
    cashback_entries: record.cashback_amount > 0 
      ? [{
          amount: record.cashback_amount,
          mode: cashbackMode || 'unknown',
          metadata: null
        }]
      : []
  };
}

/**
 * Load transactions from PocketBase API
 * Filters by account, person, category, etc.
 * 
 * @param options - Filter options matching loadTransactions() signature
 * @returns Array of FlatTransactionRow for further processing
 */
export async function loadPocketBaseTransactions(options: {
  transactionId?: string;
  accountId?: string;
  personId?: string;
  personIds?: string[];
  categoryId?: string;
  shopId?: string;
  limit?: number;
  includeVoided?: boolean;
}): Promise<FlatTransactionRow[]> {
  // Build filter string
  const filters: string[] = [];

  if (options.transactionId) {
    filters.push(`id='${options.transactionId}'`);
  }

  if (options.accountId) {
    // Handle both direct match and transfer target
    filters.push(`(account_id='${options.accountId}' || to_account_id='${options.accountId}')`);
  }

  if (options.personId) {
    filters.push(`person_id='${options.personId}'`);
  }

  if (options.personIds && options.personIds.length > 0) {
    const personFilter = options.personIds.map(id => `person_id='${id}'`).join(' || ');
    filters.push(`(${personFilter})`);
  }

  if (options.categoryId) {
    filters.push(`category_id='${options.categoryId}'`);
  }

  if (options.shopId) {
    filters.push(`shop_id='${options.shopId}'`);
  }

  const filterParam = filters.length > 0 ? `&filter=${encodeURIComponent(filters.join(' && '))}` : '';
  const limitParam = options.limit ? `&perPage=${options.limit}` : '&perPage=500';
  const sortParam = '&sort=-date'; // Most recent first

  const url = `${PB_API_URL}/api/collections/${PB_TXN_COLLECTION}/records?${filterParam}${limitParam}${sortParam}`;

  console.log('[loadPocketBaseTransactions] Query start:', {
    accountId: options.accountId,
    transactionId: options.transactionId,
    personId: options.personId,
    categoryId: options.categoryId,
    shopId: options.shopId,
    includeVoided: options.includeVoided,
    filters,
    url,
  });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store', // Always fetch fresh data
    });

    if (!response.ok) {
      console.error('[loadPocketBaseTransactions] API error:', {
        status: response.status,
        statusText: response.statusText,
        url
      });
      return [];
    }

    const data = await response.json();
    const items = (data.items || []) as PocketBaseTransaction[];

    const filteredItems = options.includeVoided
      ? items
      : items.filter((item) => item?.metadata?.status !== 'void');

    const sample = filteredItems.slice(0, 5).map((item) => ({
      id: item.id,
      account_id: item.account_id,
      to_account_id: item.to_account_id,
      type: item.type,
      date: item.date,
      metadata_status: item?.metadata?.status ?? null,
    }));

    const directMatchCount = options.accountId
      ? filteredItems.filter((item) => item.account_id === options.accountId || item.to_account_id === options.accountId).length
      : filteredItems.length;

    console.log('[loadPocketBaseTransactions] Fetched from PB:', {
      count: filteredItems.length,
      accountId: options.accountId,
      filters: filters.join(' && '),
      directMatchCount,
      sample,
    });

    // Map PB records to FlatTransactionRow format
    return filteredItems.map(mapPocketBaseTransactionRow);

  } catch (error) {
    console.error('[loadPocketBaseTransactions] Fetch error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      accountId: options.accountId
    });
    return [];
  }
}

/**
 * Dual-ID Account Bridge Map
 * Maps PB account IDs ↔ SB account IDs for transaction linking
 * 
 * This is critical for Phase 3 migration where:
 * - Accounts are in PB (base32 IDs)
 * - Old transactions may reference SB UUIDs
 * - New transactions use PB IDs
 */
export type AccountIdBridge = {
  pb_id: string; // PB base32 ID (e.g., "hk10cfr1lusxorn")
  sb_id: string; // SB UUID (e.g., "e2e64637-...")
  name: string;  // For debugging
};

/**
 * Build account ID bridge from PB accounts
 * Fetches all accounts and creates bidirectional map
 * 
 * Usage:
 * - When transaction has SB account_id → resolve to PB account
 * - When querying PB transactions → accept both PB and SB IDs
 */
export async function buildAccountIdBridge(): Promise<{
  pbToSb: Map<string, string>; // PB ID → SB ID
  sbToPb: Map<string, string>; // SB ID → PB ID
  bridges: AccountIdBridge[];
}> {
  const PB_API_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://api-db.reiwarden.io.vn';
  
  try {
    const response = await fetch(
      `${PB_API_URL}/api/collections/pvl_acc_001/records?perPage=500&fields=id,name,sb_account_id`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      console.warn('[buildAccountIdBridge] Failed to fetch accounts from PB');
      return { pbToSb: new Map(), sbToPb: new Map(), bridges: [] };
    }

    const data = await response.json();
    const items = data.items || [];

    const pbToSb = new Map<string, string>();
    const sbToPb = new Map<string, string>();
    const bridges: AccountIdBridge[] = [];

    for (const item of items) {
      if (item.sb_account_id && item.id) {
        pbToSb.set(item.id, item.sb_account_id);
        sbToPb.set(item.sb_account_id, item.id);
        bridges.push({
          pb_id: item.id,
          sb_id: item.sb_account_id,
          name: item.name || 'Unknown'
        });
      }
    }

    console.log('[buildAccountIdBridge] Built bridge:', {
      totalAccounts: items.length,
      bridgedAccounts: bridges.length
    });

    return { pbToSb, sbToPb, bridges };

  } catch (error) {
    console.error('[buildAccountIdBridge] Error:', error);
    return { pbToSb: new Map(), sbToPb: new Map(), bridges: [] };
  }
}

/**
 * Resolve account ID to PB format
 * Accepts either PB base32 or SB UUID, returns PB ID
 * 
 * @param accountId - PB or SB account ID
 * @param bridge - Account ID bridge map
 * @returns PB account ID or original if not found
 */
export function resolveAccountIdToPB(
  accountId: string,
  bridge: { sbToPb: Map<string, string> }
): string {
  // Check if it's a UUID (SB ID)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId);
  
  if (isUuid) {
    // Look up PB ID from SB ID
    const pbId = bridge.sbToPb.get(accountId);
    if (pbId) {
      console.log('[resolveAccountIdToPB] Resolved SB→PB:', { sbId: accountId, pbId });
      return pbId;
    }
  }
  
  // Already PB ID or not in bridge
  return accountId;
}

export async function createPocketBaseTransaction(
  input: PocketBaseTransactionMutationInput,
): Promise<string | null> {
  try {
    const response = await fetch(
      `${PB_API_URL}/api/collections/${PB_TXN_COLLECTION}/records`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPocketBaseMutationPayload(input)),
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.error('[createPocketBaseTransaction] API error:', {
        status: response.status,
        body,
      });
      return null;
    }

    const created = await response.json();
    return created?.id ?? null;
  } catch (error) {
    console.error('[createPocketBaseTransaction] Failed:', error);
    return null;
  }
}

export async function updatePocketBaseTransaction(
  id: string,
  input: PocketBaseTransactionMutationInput,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${PB_API_URL}/api/collections/${PB_TXN_COLLECTION}/records/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPocketBaseMutationPayload(input)),
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.error('[updatePocketBaseTransaction] API error:', {
        id,
        status: response.status,
        body,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[updatePocketBaseTransaction] Failed:', { id, error });
    return false;
  }
}

export async function deletePocketBaseTransaction(id: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${PB_API_URL}/api/collections/${PB_TXN_COLLECTION}/records/${id}`,
      {
        method: 'DELETE',
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.error('[deletePocketBaseTransaction] API error:', {
        id,
        status: response.status,
        body,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[deletePocketBaseTransaction] Failed:', { id, error });
    return false;
  }
}

export async function voidPocketBaseTransaction(id: string): Promise<boolean> {
  try {
    const getResponse = await fetch(
      `${PB_API_URL}/api/collections/${PB_TXN_COLLECTION}/records/${id}`,
      { cache: 'no-store' },
    );

    if (!getResponse.ok) {
      const body = await getResponse.text();
      console.error('[voidPocketBaseTransaction] Failed to fetch record:', {
        id,
        status: getResponse.status,
        body,
      });
      return false;
    }

    const current = await getResponse.json();
    const metadata = {
      ...(current?.metadata ?? {}),
      status: 'void',
    };

    const patchResponse = await fetch(
      `${PB_API_URL}/api/collections/${PB_TXN_COLLECTION}/records/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata }),
        cache: 'no-store',
      },
    );

    if (!patchResponse.ok) {
      const body = await patchResponse.text();
      console.error('[voidPocketBaseTransaction] API error:', {
        id,
        status: patchResponse.status,
        body,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[voidPocketBaseTransaction] Failed:', { id, error });
    return false;
  }
}
