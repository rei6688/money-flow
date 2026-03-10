#!/usr/bin/env node
/**
 * Clean re-migrate transactions: delete all PB txn, then backfill fresh from SB
 * Usage: node scripts/pb-remigrate-txn.mjs
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local from project root
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const PB_URL = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn';
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL;
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD;
const APP_URL = 'http://localhost:3000';

if (!PB_EMAIL || !PB_PASSWORD) {
  console.error('❌ Missing POCKETBASE_DB_EMAIL or POCKETBASE_DB_PASSWORD in .env.local');
  process.exit(1);
}

console.log(`[Config] PB_URL: ${PB_URL}`);
console.log(`[Config] PB_EMAIL: ${PB_EMAIL}`);

async function getAuthToken() {
  console.log('[Auth] Logging into PocketBase...');
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: PB_EMAIL,
      password: PB_PASSWORD,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PB auth failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log('[Auth] ✅ Logged in as', data.record?.email || 'admin');
  return data.token;
}

async function deleteAllTransactions(token) {
  console.log('[Delete] Fetching all transaction IDs...');
  let page = 1;
  let totalDeleted = 0;

  while (true) {
    const res = await fetch(`${PB_URL}/api/collections/pvl_txn_001/records?page=${page}&perPage=500&fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`[Delete] Fetch failed page ${page}:`, res.status);
      break;
    }

    const data = await res.json();
    const ids = data.items?.map(r => r.id) || [];

    if (ids.length === 0) break;

    console.log(`[Delete] Page ${page}: ${ids.length} records`);

    for (const id of ids) {
      try {
        const delRes = await fetch(`${PB_URL}/api/collections/pvl_txn_001/records/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (delRes.ok) {
          totalDeleted++;
          if (totalDeleted % 50 === 0) console.log(`[Delete] Progress: ${totalDeleted} deleted`);
        }
      } catch (err) {
        console.error(`[Delete] Failed ID ${id}:`, err.message);
      }
    }

    if (!data.totalPages || page >= data.totalPages) break;
    page++;
  }

  console.log(`[Delete] ✅ Total deleted: ${totalDeleted}`);
  return totalDeleted;
}

async function backfillFromSupabase() {
  console.log('[Backfill] Triggering /api/migrate/backfill...');
  
  // Try direct fetch (might need auth)
  const res = await fetch(`${APP_URL}/api/migrate/backfill?collection=transactions`);
  
  if (!res.ok) {
    console.error(`[Backfill] Response status: ${res.status}`);
    const text = await res.text();
    console.error(`[Backfill] Response body:`, text.slice(0, 200));
    throw new Error('Backfill endpoint failed - might need manual trigger');
  }

  const data = await res.json();
  console.log('[Backfill] ✅ Result:', JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  try {
    const token = await getAuthToken();
    await deleteAllTransactions(token);
    
    console.log('\n[Backfill] Waiting 2s before re-import...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await backfillFromSupabase();
    
    console.log('\n✅ Re-migration complete!');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
