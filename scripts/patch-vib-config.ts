#!/usr/bin/env node
/**
 * Patch VIB Super account cashback config: migrate cat_ids from SB → PB IDs
 * Usage: npx tsx scripts/patch-vib-config.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

const PB_URL = 'https://api-db.reiwarden.io.vn';
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL!;
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD!;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const VIB_ACCOUNT_IDS = ['sf9u1fqj1gc7258', 'm313qmn2ps30qqn'];
const PB_CATEGORIES_COLLECTION = 'pvl_cat_001';
const PB_ACCOUNTS_COLLECTION = 'pvl_acc_001';

let pbToken = '';

async function pbAuth() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  pbToken = data.token;
  console.log('[Auth] ✅ Logged in');
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
    throw new Error(`PB request failed [${res.status}]: ${text.slice(0, 300)}`);
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

async function main() {
  try {
    await pbAuth();
    
    console.log('\n[1] Building SB → PB category ID map...');
    const supabase = createClient(SB_URL, SB_KEY);
    const { data: sbCategories } = await supabase.from('categories').select('id, name');
    const pbCategories = await pbRequest(`/api/collections/${PB_CATEGORIES_COLLECTION}/records`, { 
      query: { perPage: 500, fields: 'id,slug,name' } 
    });
    
    const sbToPbMap = new Map<string, string>();
    (sbCategories || []).forEach((cat: any) => {
      const pbMatch = (pbCategories.items || []).find((pb: any) => pb.slug === cat.id) 
        || (pbCategories.items || []).find((pb: any) => pb.id === toPocketBaseId(cat.id));
      if (pbMatch) {
        sbToPbMap.set(cat.id, pbMatch.id);
        console.log(`  ${cat.name} (${cat.id.slice(0, 8)}) → PB ${pbMatch.id}`);
      }
    });
    
    console.log(`\n[2] Fetching VIB Super account config...`);
    
    for (const accountId of VIB_ACCOUNT_IDS) {
      console.log(`\n[Processing Account: ${accountId}]`);
      const vibAccount = await pbRequest(`/api/collections/${PB_ACCOUNTS_COLLECTION}/records/${accountId}`);
    
    console.log(`\n[3] Migrating cat_ids in cashback_config & cb_rules_json...`);
    let patchedConfig = JSON.parse(JSON.stringify(vibAccount.cashback_config || {}));
    let patchedRulesJson = JSON.parse(JSON.stringify(vibAccount.cb_rules_json || {}));
    
    // Migrate cashback_config.program.rules_json_v2.tiers[].policies[].cat_ids
    const v2Tiers = patchedConfig?.program?.rules_json_v2?.tiers || [];
    v2Tiers.forEach((tier: any, tierIdx: number) => {
      (tier.policies || []).forEach((policy: any, policyIdx: number) => {
        if (Array.isArray(policy.cat_ids)) {
          const oldIds = [...policy.cat_ids];
          policy.cat_ids = policy.cat_ids.map((sbId: string) => {
            const pbId = sbToPbMap.get(sbId);
            if (pbId) {
              console.log(`  [v2 tier ${tierIdx} policy ${policyIdx}] ${sbId.slice(0, 8)} → ${pbId}`);
              return pbId;
            }
            return sbId;
          });
        }
      });
    });
    
    // Migrate cb_rules_json.tiers[].policies[].cat_ids
    (patchedRulesJson.tiers || []).forEach((tier: any, tierIdx: number) => {
      (tier.policies || []).forEach((policy: any, policyIdx: number) => {
        if (Array.isArray(policy.cat_ids)) {
          const oldIds = [...policy.cat_ids];
          policy.cat_ids = policy.cat_ids.map((sbId: string) => {
            const pbId = sbToPbMap.get(sbId);
            if (pbId) {
              console.log(`  [cb_rules tier ${tierIdx} policy ${policyIdx}] ${sbId.slice(0, 8)} → ${pbId}`);
              return pbId;
            }
            return sbId;
          });
        }
      });
    });
    
    console.log(`\n[4] Updating VIB Super account...`);
      await pbRequest(`/api/collections/${PB_ACCOUNTS_COLLECTION}/records/${accountId}`, {
      method: 'PATCH',
      body: {
        cashback_config: patchedConfig,
        cb_rules_json: patchedRulesJson,
      },
    });
        console.log(`  ✅ Account ${accountId} patched`);
      }
    
      console.log(`\n✅ All ${VIB_ACCOUNT_IDS.length} VIB Super accounts patched!`);
  } catch (err: any) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
