#!/usr/bin/env node

/**
 * Migration Script: Add Missing Fields to PocketBase Accounts Collection
 *
 * This script:
 * 1. Adds 13 missing fields to the accounts collection schema
 * 2. Backfills data from Supabase for all accounts
 *
 * Missing fields:
 * - holder_type, holder_person_id
 * - parent_account_id, secured_by_account_id
 * - annual_fee, annual_fee_waiver_target
 * - cb_type, cb_base_rate, cb_max_budget, cb_is_unlimited
 * - cb_rules_json, cb_min_spend, cb_cycle_type
 */

import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

const POCKETBASE_URL =
  process.env.POCKETBASE_URL || "https://api-db.reiwarden.io.vn";
const POCKETBASE_EMAIL = process.env.POCKETBASE_DB_EMAIL?.trim();
const POCKETBASE_PASSWORD = process.env.POCKETBASE_DB_PASSWORD?.trim();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
  console.error("❌ Missing POCKETBASE_DB_EMAIL or POCKETBASE_DB_PASSWORD");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let cachedToken = null;
let tokenExpiresAt = 0;

function toPocketBaseId(input, collection = "") {
  if (!input) return null;
  const str = String(input).trim().toLowerCase();

  // Already PB format (15-char alphanumeric)
  if (/^[a-z0-9]{15}$/.test(str)) return str;

  // Hash to deterministic PB ID
  const prefix = collection ? `${collection}:` : "";
  const hash = createHash("sha256").update(`${prefix}${str}`).digest("hex");
  return hash.substring(0, 15);
}

async function pbAuth() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30000) return cachedToken;

  const res = await fetch(
    `${POCKETBASE_URL}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: POCKETBASE_EMAIL,
        password: POCKETBASE_PASSWORD,
      }),
    },
  );

  if (!res.ok) throw new Error(`Auth failed: ${await res.text()}`);

  const data = await res.json();
  cachedToken = data.token;

  try {
    const payload = JSON.parse(
      Buffer.from(data.token.split(".")[1], "base64url").toString(),
    );
    tokenExpiresAt = (payload.exp || 0) * 1000;
  } catch {
    tokenExpiresAt = Date.now() + 5 * 60 * 1000;
  }

  return cachedToken;
}

async function pbRequest(path, options = {}) {
  const token = await pbAuth();
  const { method = "GET", body, params } = options;

  let url = `${POCKETBASE_URL}${path}`;
  if (params) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v));
    }
    if (search.toString()) url += `?${search}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PB request failed [${method} ${path}]: ${text}`);
  }

  return res.json();
}

async function updateCollectionSchema() {
  console.log("\n📝 Step 1: Updating PocketBase accounts schema...");

  // Fetch current schema
  const collectionsResponse = await pbRequest("/api/collections");
  console.log(`   DEBUG: Response type: ${typeof collectionsResponse}`);
  console.log(`   DEBUG: Has items: ${!!collectionsResponse.items}`);

  const collections = collectionsResponse.items || collectionsResponse;
  const accountsCollection = collections.find((c) => c.name === "accounts");

  if (!accountsCollection) {
    throw new Error("accounts collection not found!");
  }

  console.log(
    `   DEBUG: Collection keys: ${Object.keys(accountsCollection).join(", ")}`,
  );

  const currentSchema = accountsCollection.fields || [];
  console.log(`   Current fields: ${currentSchema.length}`);

  // Define new fields - PocketBase v0.23+ flat schema format
  const newFields = [
    {
      id: "f_acc_holder_type",
      name: "holder_type",
      type: "select",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 1,
      values: ["me", "relative", "other"],
    },
    {
      id: "f_acc_holder_person",
      name: "holder_person_id",
      type: "relation",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      collectionId: "pvl_people_001",
      cascadeDelete: false,
      minSelect: null,
      maxSelect: 1,
      displayFields: null,
    },
    {
      id: "f_acc_parent",
      name: "parent_account_id",
      type: "relation",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      collectionId: "pvl_acc_001",
      cascadeDelete: false,
      minSelect: null,
      maxSelect: 1,
      displayFields: null,
    },
    {
      id: "f_acc_secured",
      name: "secured_by_account_id",
      type: "relation",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      collectionId: "pvl_acc_001",
      cascadeDelete: false,
      minSelect: null,
      maxSelect: 1,
      displayFields: null,
    },
    {
      id: "f_acc_annual_fee",
      name: "annual_fee",
      type: "number",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      min: null,
      max: null,
      noDecimal: false,
    },
    {
      id: "f_acc_annual_waiver",
      name: "annual_fee_waiver_target",
      type: "number",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      min: null,
      max: null,
      noDecimal: false,
    },
    {
      id: "f_acc_cb_type",
      name: "cb_type",
      type: "select",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 1,
      values: ["none", "simple", "tiered"],
    },
    {
      id: "f_acc_cb_base_rate",
      name: "cb_base_rate",
      type: "number",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      min: null,
      max: null,
      noDecimal: false,
    },
    {
      id: "f_acc_cb_max_budget",
      name: "cb_max_budget",
      type: "number",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      min: null,
      max: null,
      noDecimal: false,
    },
    {
      id: "f_acc_cb_unlimited",
      name: "cb_is_unlimited",
      type: "bool",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
    },
    {
      id: "f_acc_cb_rules",
      name: "cb_rules_json",
      type: "json",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      maxSize: 2000000,
    },
    {
      id: "f_acc_cb_min_spend",
      name: "cb_min_spend",
      type: "number",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      min: null,
      max: null,
      noDecimal: false,
    },
    {
      id: "f_acc_cb_cycle_type",
      name: "cb_cycle_type",
      type: "select",
      system: false,
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 1,
      values: ["calendar_month", "statement_cycle"],
    },
  ];

  // Merge with existing schema
  const existingFieldNames = currentSchema.map((f) => f.name);
  const fieldsToAdd = newFields.filter(
    (f) => !existingFieldNames.includes(f.name),
  );

  if (fieldsToAdd.length === 0) {
    console.log("   ✅ All fields already exist, skipping schema update");
    return;
  }

  console.log(
    `   Adding ${fieldsToAdd.length} new fields: ${fieldsToAdd.map((f) => f.name).join(", ")}`,
  );

  const updatedSchema = [...currentSchema, ...fieldsToAdd];

  await pbRequest(`/api/collections/${accountsCollection.id}`, {
    method: "PATCH",
    body: {
      fields: updatedSchema,
    },
  });

  console.log("   ✅ Schema updated successfully");
}

async function backfillFromSupabase() {
  console.log("\n📦 Step 2: Backfilling data from Supabase...");

  // Fetch all accounts from Supabase
  const { data: sbAccounts, error } = await supabase.from("accounts").select(`
      id,
      holder_type,
      holder_person_id,
      parent_account_id,
      secured_by_account_id,
      annual_fee,
      annual_fee_waiver_target,
      cb_type,
      cb_base_rate,
      cb_max_budget,
      cb_is_unlimited,
      cb_rules_json,
      cb_min_spend,
      cb_cycle_type
    `);

  if (error) throw error;

  console.log(`   Found ${sbAccounts.length} accounts in Supabase`);

  // Fetch all PB accounts
  const pbAccounts = await pbRequest("/api/collections/accounts/records", {
    params: { perPage: 500 },
  });

  console.log(`   Found ${pbAccounts.items.length} accounts in PocketBase`);

  // Create lookup map: Supabase UUID -> PB ID
  const sbToPbMap = new Map();
  for (const pbAcc of pbAccounts.items) {
    if (pbAcc.slug) sbToPbMap.set(pbAcc.slug, pbAcc.id);
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const sbAcc of sbAccounts) {
    const pbId =
      sbToPbMap.get(sbAcc.id) || toPocketBaseId(sbAcc.id, "accounts");

    try {
      const updateData = {};

      // Holder fields
      if (sbAcc.holder_type) updateData.holder_type = sbAcc.holder_type;
      if (sbAcc.holder_person_id) {
        updateData.holder_person_id = toPocketBaseId(
          sbAcc.holder_person_id,
          "people",
        );
      }

      // Account relations
      if (sbAcc.parent_account_id) {
        updateData.parent_account_id = toPocketBaseId(
          sbAcc.parent_account_id,
          "accounts",
        );
      }
      if (sbAcc.secured_by_account_id) {
        updateData.secured_by_account_id = toPocketBaseId(
          sbAcc.secured_by_account_id,
          "accounts",
        );
      }

      // Fee fields
      if (sbAcc.annual_fee !== null && sbAcc.annual_fee !== undefined) {
        updateData.annual_fee = sbAcc.annual_fee;
      }
      if (
        sbAcc.annual_fee_waiver_target !== null &&
        sbAcc.annual_fee_waiver_target !== undefined
      ) {
        updateData.annual_fee_waiver_target = sbAcc.annual_fee_waiver_target;
      }

      // Cashback fields
      if (sbAcc.cb_type) updateData.cb_type = sbAcc.cb_type;
      if (sbAcc.cb_base_rate !== null && sbAcc.cb_base_rate !== undefined) {
        updateData.cb_base_rate = sbAcc.cb_base_rate;
      }
      if (sbAcc.cb_max_budget !== null && sbAcc.cb_max_budget !== undefined) {
        updateData.cb_max_budget = sbAcc.cb_max_budget;
      }
      if (
        sbAcc.cb_is_unlimited !== null &&
        sbAcc.cb_is_unlimited !== undefined
      ) {
        updateData.cb_is_unlimited = sbAcc.cb_is_unlimited;
      }
      if (sbAcc.cb_rules_json) updateData.cb_rules_json = sbAcc.cb_rules_json;
      if (sbAcc.cb_min_spend !== null && sbAcc.cb_min_spend !== undefined) {
        updateData.cb_min_spend = sbAcc.cb_min_spend;
      }
      if (sbAcc.cb_cycle_type) updateData.cb_cycle_type = sbAcc.cb_cycle_type;

      // Skip if nothing to update
      if (Object.keys(updateData).length === 0) {
        skipped++;
        continue;
      }

      await pbRequest(`/api/collections/accounts/records/${pbId}`, {
        method: "PATCH",
        body: updateData,
      });

      updated++;
      if (updated % 10 === 0) {
        process.stdout.write(`\r   Progress: ${updated}/${sbAccounts.length}`);
      }
    } catch (err) {
      errors++;
      console.error(
        `\n   ⚠️  Failed to update account ${sbAcc.id}: ${err.message}`,
      );
    }
  }

  console.log(
    `\n   ✅ Backfill complete: ${updated} updated, ${skipped} skipped, ${errors} errors`,
  );
}

async function verifyMigration() {
  console.log("\n🔍 Step 3: Verifying migration...");

  const accounts = await pbRequest("/api/collections/accounts/records", {
    params: { perPage: 10 },
  });

  const sampleAccount = accounts.items[0];
  if (!sampleAccount) {
    console.log("   ⚠️  No accounts found for verification");
    return;
  }

  const newFields = [
    "holder_type",
    "holder_person_id",
    "parent_account_id",
    "secured_by_account_id",
    "annual_fee",
    "annual_fee_waiver_target",
    "cb_type",
    "cb_base_rate",
    "cb_max_budget",
    "cb_is_unlimited",
    "cb_rules_json",
    "cb_min_spend",
    "cb_cycle_type",
  ];

  const missingFields = newFields.filter((field) => !(field in sampleAccount));

  if (missingFields.length > 0) {
    console.log(`   ⚠️  Missing fields in sample: ${missingFields.join(", ")}`);
  } else {
    console.log("   ✅ All new fields present in PocketBase records");
  }

  // Show sample data
  console.log("\n   Sample account data:");
  console.log(`   - ID: ${sampleAccount.id}`);
  console.log(`   - Name: ${sampleAccount.name}`);
  console.log(`   - Holder Type: ${sampleAccount.holder_type || "null"}`);
  console.log(
    `   - Holder Person ID: ${sampleAccount.holder_person_id || "null"}`,
  );
  console.log(`   - CB Type: ${sampleAccount.cb_type || "null"}`);
  console.log(`   - Annual Fee: ${sampleAccount.annual_fee || "null"}`);
}

async function main() {
  console.log("🚀 Starting PocketBase Accounts Migration");
  console.log("=".repeat(60));

  try {
    await updateCollectionSchema();
    await backfillFromSupabase();
    await verifyMigration();

    console.log("\n" + "=".repeat(60));
    console.log("✅ Migration completed successfully!");
    console.log("\nNext steps:");
    console.log(
      "1. Test account editing at http://localhost:3001/accounts/[id]",
    );
    console.log("2. Verify Owner field now saves correctly");
    console.log("3. Run Phase 1-3 fixes (lint, routes, sheet config)");
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
