/**
 * Direct backfill executor - run as Node script to bypass Next.js middleware
 * Usage: npx tsx scripts/direct-backfill.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const PB_URL = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn';
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL!;
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD!;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PB_TRANSACTIONS_COLLECTION = 'pvl_txn_001';
const PB_ACCOUNTS_COLLECTION = 'pvl_acc_001';
const PB_CATEGORIES_COLLECTION = 'pvl_cat_001';
const PB_SHOPS_COLLECTION = 'pvl_shop_001';
const PB_PEOPLE_COLLECTION = 'pvl_people_001';

let pbToken = '';

async function pbAuth() {
  console.log('[PB Auth] Logging in...');
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  
  const data = await res.json();
  pbToken = data.token;
  console.log('[PB Auth] ✅ Success');
}

async function pbRequest(path: string, options: any = {}) {
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : '';
  const url = `${PB_URL}${path}${query}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pbToken}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PB request failed [${res.status}]: ${text.slice(0, 200)}`);
  }
  
  return res.json();
}

function toPocketBaseId(sourceId: string): string {
  const hash = sourceId.split('-').join('').slice(0, 15);
  const base32 = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 15; i++) {
    const charCode = hash.charCodeAt(i % hash.length);
    result += base32[charCode % base32.length];
  }
  return result;
}

async function backfillCategories() {
  console.log('\n[Categories] Starting backfill...');
  const supabase = createClient(SB_URL, SB_KEY);
  
  const { data: sbCategories, error } = await supabase.from('categories').select('*').order('name');
  if (error) throw new Error(`SB categories fetch failed: ${error.message}`);
  
  console.log(`[Categories] Retrieved ${(sbCategories || []).length} from Supabase`);
  
  let created = 0;
  let updated = 0;
  
  for (const cat of (sbCategories || [])) {
    const pbId = toPocketBaseId(cat.id);
    
    const body = {
      slug: cat.id,
      name: cat.name,
      icon: cat.icon || '',
      kind: cat.kind || 'expense',
      tags: cat.tags || [],
      parent_category_id: null, // FK mapping needed
    };
    
    try {
      await pbRequest(`/api/collections/${PB_CATEGORIES_COLLECTION}/records/${pbId}`, { method: 'PATCH', body });
      updated++;
    } catch (err) {
      if (String(err).includes('[404]')) {
        await pbRequest(`/api/collections/${PB_CATEGORIES_COLLECTION}/records`, { method: 'POST', body: { id: pbId, ...body } });
        created++;
      } else {
        console.error(`[Categories] Error for ${cat.name}:`, String(err).slice(0, 100));
      }
    }
  }
  
  console.log(`[Categories] ✅ Done: ${created} created, ${updated} updated`);
}

async function backfillShops() {
  console.log('\n[Shops] Starting backfill...');
  const supabase = createClient(SB_URL, SB_KEY);
  
  const { data: sbShops, error } = await supabase.from('shops').select('*').order('name');
  if (error) throw new Error(`SB shops fetch failed: ${error.message}`);
  
  console.log(`[Shops] Retrieved ${(sbShops || []).length} from Supabase`);
  
  let created = 0;
  let updated = 0;
  
  for (const shop of (sbShops || [])) {
    const pbId = toPocketBaseId(shop.id);
    
    const body = {
      name: shop.name,
      image_url: shop.image_url || null,
      metadata: shop.metadata || {},
    };
    
    try {
      await pbRequest(`/api/collections/${PB_SHOPS_COLLECTION}/records/${pbId}`, { method: 'PATCH', body });
      updated++;
    } catch (err) {
      if (String(err).includes('[404]')) {
        await pbRequest(`/api/collections/${PB_SHOPS_COLLECTION}/records`, { method: 'POST', body: { id: pbId, ...body } });
        created++;
      } else {
        console.error(`[Shops] Error for ${shop.name}:`, String(err).slice(0, 100));
      }
    }
  }
  
  console.log(`[Shops] ✅ Done: ${created} created, ${updated} updated`);
}

async function backfillAccounts() {
  console.log('\n[Accounts] Starting backfill...');
  const supabase = createClient(SB_URL, SB_KEY);
  
  const { data: sbAccounts, error } = await supabase.from('accounts').select('*').order('name');
  if (error) throw new Error(`SB accounts fetch failed: ${error.message}`);
  
  console.log(`[Accounts] Retrieved ${(sbAccounts || []).length} from Supabase`);
  
  // Build category ID map for config migration
  const { data: sbCategories } = await supabase.from('categories').select('id');
  const pbCategories = await pbRequest(`/api/collections/${PB_CATEGORIES_COLLECTION}/records`, { query: { perPage: 500, fields: 'id,slug' } });
  
  const sbToPbCategoryMap = new Map<string, string>();
  (sbCategories || []).forEach((cat: any) => {
    const pbMatch = (pbCategories.items || []).find((pb: any) => pb.slug === cat.id) 
      || (pbCategories.items || []).find((pb: any) => pb.id === toPocketBaseId(cat.id));
    if (pbMatch) sbToPbCategoryMap.set(cat.id, pbMatch.id);
  });
  
  console.log(`[Accounts] Built category map: ${sbToPbCategoryMap.size} entries`);
  
  let created = 0;
  let updated = 0;
  
  for (const acc of (sbAccounts || [])) {
    const pbId = toPocketBaseId(acc.id);
    
    // Migrate cashback config cat_ids from SB → PB
    let migratedCashbackConfig = acc.cashback_config;
    let migratedRulesJson = acc.cb_rules_json;
    
    if (acc.cashback_config) {
      migratedCashbackConfig = JSON.parse(JSON.stringify(acc.cashback_config));
      const tiers = migratedCashbackConfig?.program?.rules_json_v2?.tiers || [];
      tiers.forEach((tier: any) => {
        (tier.policies || []).forEach((policy: any) => {
          if (Array.isArray(policy.cat_ids)) {
            policy.cat_ids = policy.cat_ids.map((sbId: string) => sbToPbCategoryMap.get(sbId) || sbId);
          }
        });
      });
    }
    
    if (acc.cb_rules_json?.tiers) {
      migratedRulesJson = JSON.parse(JSON.stringify(acc.cb_rules_json));
      (migratedRulesJson.tiers || []).forEach((tier: any) => {
        (tier.policies || []).forEach((policy: any) => {
          if (Array.isArray(policy.cat_ids)) {
            policy.cat_ids = policy.cat_ids.map((sbId: string) => sbToPbCategoryMap.get(sbId) || sbId);
          }
        });
      });
    }
    
    const body = {
      slug: acc.id,
      name: acc.name,
      type: acc.type === 'ewallet' ? 'e_wallet' : (acc.type || 'bank'),
      currency: acc.currency || 'VND',
      current_balance: acc.current_balance || 0,
      credit_limit: acc.credit_limit || 0,
      is_active: acc.is_active ?? true,
      image_url: acc.image_url || null,
      receiver_name: acc.receiver_name || null,
      account_number: acc.account_number || null,
      total_in: acc.total_in || 0,
      total_out: acc.total_out || 0,
      cashback_config: migratedCashbackConfig || null,
      cashback_config_version: acc.cashback_config_version || 1,
      annual_fee: acc.annual_fee || null,
      annual_fee_waiver_target: acc.annual_fee_waiver_target || null,
      cb_type: acc.cb_type || 'none',
      cb_base_rate: acc.cb_base_rate || 0,
      cb_max_budget: acc.cb_max_budget || null,
      cb_is_unlimited: acc.cb_is_unlimited || false,
      cb_rules_json: migratedRulesJson || null,
      cb_min_spend: acc.cb_min_spend || null,
      cb_cycle_type: acc.cb_cycle_type || 'calendar_month',
      statement_day: acc.statement_day || null,
      due_date: acc.due_date || null,
      holder_type: acc.holder_type || null,
      holder_person_id: null, // FK mapping needed
      parent_account_id: null, // FK mapping needed
      secured_by_account_id: null, // FK mapping needed
      owner_id: null, // FK mapping needed if people collection exists
    };
    
    try {
      await pbRequest(`/api/collections/${PB_ACCOUNTS_COLLECTION}/records/${pbId}`, { method: 'PATCH', body });
      updated++;
    } catch (err) {
      if (String(err).includes('[404]')) {
        await pbRequest(`/api/collections/${PB_ACCOUNTS_COLLECTION}/records`, { method: 'POST', body: { id: pbId, ...body } });
        created++;
      } else {
        console.error(`[Accounts] Error for ${acc.name}:`, String(err).slice(0, 100));
      }
    }
  }
  
  console.log(`[Accounts] ✅ Done: ${created} created, ${updated} updated`);
}

async function backfillTransactions() {
  console.log('\n[Transactions] Starting backfill...');
  const supabase = createClient(SB_URL, SB_KEY);
  
  // Build ID maps first
  console.log('[ID Maps] Building account/category/shop/person maps...');
  
  const { data: sbAccounts } = await supabase.from('accounts').select('id');
  const { data: sbCategories } = await supabase.from('categories').select('id');
  const { data: sbShops } = await supabase.from('shops').select('id, name');
  const { data: sbPeople } = await supabase.from('people').select('id, name');
  
  // Fetch PB records
  const pbAccounts = await pbRequest(`/api/collections/${PB_ACCOUNTS_COLLECTION}/records`, { query: { perPage: 500, fields: 'id,slug' } });
  const pbCategories = await pbRequest(`/api/collections/${PB_CATEGORIES_COLLECTION}/records`, { query: { perPage: 500, fields: 'id,slug' } });
  const pbShops = await pbRequest(`/api/collections/${PB_SHOPS_COLLECTION}/records`, { query: { perPage: 500, fields: 'id,name' } });
  const pbPeople = await pbRequest(`/api/collections/${PB_PEOPLE_COLLECTION}/records`, { query: { perPage: 500, fields: 'id,name' } });
  
  console.log(`[ID Maps Debug] PB categories count: ${pbCategories.items?.length || 0}`);
  if (pbCategories.items?.length > 0) {
    console.log(`[ID Maps Debug] Sample PB category:`, pbCategories.items[0]);
  }
  
  const accountMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const shopMap = new Map<string, string>();
  const personMap = new Map<string, string>();
  
  (sbAccounts || []).forEach((acc: any) => {
    const match = (pbAccounts.items || []).find((pb: any) => pb.slug === acc.id);
    if (match) accountMap.set(acc.id, match.id);
  });
  
  (sbCategories || []).forEach((cat: any) => {
    const match = (pbCategories.items || []).find((pb: any) => pb.slug === cat.id);
    if (match) {
      categoryMap.set(cat.id, match.id);
    } else {
      // Fallback: try deterministic ID match
      const expectedPbId = toPocketBaseId(cat.id);
      const pbRecord = (pbCategories.items || []).find((pb: any) => pb.id === expectedPbId);
      if (pbRecord) {
        categoryMap.set(cat.id, pbRecord.id);
      }
    }
  });
  
  (sbShops || []).forEach((shop: any) => {
    const match = (pbShops.items || []).find((pb: any) => pb.name?.toLowerCase() === shop.name?.toLowerCase());
    if (match) shopMap.set(shop.id, match.id);
  });
  
  (sbPeople || []).forEach((person: any) => {
    const match = (pbPeople.items || []).find((pb: any) => pb.name?.toLowerCase() === person.name?.toLowerCase());
    if (match) personMap.set(person.id, match.id);
  });
  
  console.log(`[ID Maps] Built: ${accountMap.size} accounts, ${categoryMap.size} categories, ${shopMap.size} shops, ${personMap.size} people`);
  
  // Fetch all SB transactions
  console.log('[SB Fetch] Loading transactions from Supabase...');
  const { data: sbTxns, error: sbError } = await supabase
    .from('transactions')
    .select('id, occurred_at, note, type, account_id, target_account_id, category_id, person_id, shop_id, amount, status, tag, persisted_cycle_tag, cashback_share_percent, cashback_share_fixed, cashback_mode, metadata')
    .order('occurred_at', { ascending: true });
  
  if (sbError) throw new Error(`SB fetch failed: ${sbError.message}`);
  
  console.log(`[SB Fetch] ✅ Loaded ${(sbTxns || []).length} transactions`);
  
  let created = 0;
  let updated = 0;
  let failed = 0;
  
  for (const txn of (sbTxns || [])) {
    const pbId = toPocketBaseId(txn.id);
    
    try {
      const body = {
        date: txn.occurred_at,
        description: txn.note || '',
        type: txn.type,
        account_id: accountMap.get(txn.account_id) || '',
        to_account_id: txn.target_account_id ? (accountMap.get(txn.target_account_id) || '') : '',
        category_id: txn.category_id ? (categoryMap.get(txn.category_id) || '') : '',
        person_id: txn.person_id ? (personMap.get(txn.person_id) || '') : '',
        shop_id: txn.shop_id ? (shopMap.get(txn.shop_id) || '') : '',
        amount: txn.amount,
        final_price: txn.amount,
        cashback_amount: 0,
        is_installment: false,
        parent_transaction_id: '',
        metadata: {
          ...(txn.metadata || {}),
          source_id: txn.id,
          status: txn.status || 'posted',
          tag: txn.tag || null,
          persisted_cycle_tag: txn.persisted_cycle_tag || null,
          cashback_share_percent: txn.cashback_share_percent || null,
          cashback_share_fixed: txn.cashback_share_fixed || null,
          cashback_mode: txn.cashback_mode || null,
        },
      };
      
      // Try PATCH first
      try {
        await pbRequest(`/api/collections/${PB_TRANSACTIONS_COLLECTION}/records/${pbId}`, { method: 'PATCH', body });
        updated++;
      } catch (patchErr) {
        // 404 = not found, create new
        if (String(patchErr).includes('[404]')) {
          await pbRequest(`/api/collections/${PB_TRANSACTIONS_COLLECTION}/records`, { method: 'POST', body: { id: pbId, ...body } });
          created++;
        } else {
          throw patchErr;
        }
      }
      
      if ((created + updated) % 50 === 0) {
        console.log(`[Progress] ${created} created, ${updated} updated`);
      }
    } catch (err) {
      failed++;
      console.error(`[Error] TXN ${txn.id}:`, String(err).slice(0, 100));
    }
  }
  
  console.log(`\n[Transactions] ✅ Done: ${created} created, ${updated} updated, ${failed} failed`);
}

async function main() {
  try {
    await pbAuth();
    
    console.log('\n🚀 Starting full backfill (categories → shops → accounts → transactions)...\n');
    
    await backfillCategories();
    await backfillShops();
    await backfillAccounts();
    await backfillTransactions();
    
    console.log('\n✅ Full backfill complete!');
  } catch (err: any) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

main();
