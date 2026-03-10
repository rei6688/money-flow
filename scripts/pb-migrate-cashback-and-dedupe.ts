#!/usr/bin/env node
/**
 * Migrate cashback config cat_ids (SB -> PB) for all accounts
 * + Deduplicate accounts by (account_number, name) and relink transactions.
 *
 * Usage:
 *   npx tsx scripts/pb-migrate-cashback-and-dedupe.ts --apply
 *   npx tsx scripts/pb-migrate-cashback-and-dedupe.ts --dry-run
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const PB_URL = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn'
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const PB_ACCOUNTS = 'pvl_acc_001'
const PB_CATEGORIES = 'pvl_cat_001'
const PB_TRANSACTIONS = 'pvl_txn_001'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = process.argv.includes('--dry-run') || !APPLY

if (!PB_EMAIL || !PB_PASSWORD || !SB_URL || !SB_KEY) {
  console.error('Missing required env vars in .env.local')
  process.exit(1)
}

let pbToken = ''
const supabase = createClient(SB_URL, SB_KEY)

function stableToPocketBaseId(sourceId: string): string {
  const compact = String(sourceId || '').replace(/-/g, '')
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  if (!compact) return 'mf3aaaaaaaaaaaa'
  let out = ''
  for (let i = 0; i < 15; i++) {
    const code = compact.charCodeAt(i % compact.length)
    out += chars[code % chars.length]
  }
  return out
}

async function pbAuth() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })

  if (!res.ok) throw new Error(`PB auth failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  pbToken = json.token
}

async function pbRequest(path: string, options: any = {}) {
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
  const res = await fetch(`${PB_URL}${path}${query}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pbToken}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PB request failed [${res.status}] ${path}: ${text.slice(0, 220)}`)
  }

  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function pbListAll(collection: string, fields?: string) {
  const all: any[] = []
  let page = 1
  while (true) {
    const json = await pbRequest(`/api/collections/${collection}/records`, {
      query: {
        page: String(page),
        perPage: '500',
        ...(fields ? { fields } : {}),
      },
    })
    const items = json?.items || []
    all.push(...items)
    if (!json?.totalPages || page >= json.totalPages) break
    page += 1
  }
  return all
}

function migratePolicyCatIds(rules: any, map: Map<string, string>): { changed: boolean; value: any } {
  if (!rules || typeof rules !== 'object') return { changed: false, value: rules }
  const next = JSON.parse(JSON.stringify(rules))
  let changed = false

  const mutatePolicies = (policies: any[]) => {
    if (!Array.isArray(policies)) return
    for (const p of policies) {
      if (!Array.isArray(p?.cat_ids)) continue
      const old = [...p.cat_ids]
      p.cat_ids = p.cat_ids.map((id: string) => map.get(id) || id)
      if (JSON.stringify(old) !== JSON.stringify(p.cat_ids)) changed = true
    }
  }

  if (Array.isArray(next?.tiers)) {
    for (const tier of next.tiers) mutatePolicies(tier?.policies || [])
  }

  if (Array.isArray(next?.policies)) mutatePolicies(next.policies)

  if (Array.isArray(next?.program?.rules_json_v2?.tiers)) {
    for (const tier of next.program.rules_json_v2.tiers) mutatePolicies(tier?.policies || [])
  }

  return { changed, value: next }
}

async function migrateAllAccountsCatIds() {
  console.log('\n[1/2] Migrating cashback config cat_ids for all accounts...')

  const [sbCategories, pbCategories, pbAccounts] = await Promise.all([
    supabase.from('categories').select('id, name').then((r) => r.data || []),
    pbListAll(PB_CATEGORIES, 'id,slug,name'),
    pbListAll(PB_ACCOUNTS, 'id,name,account_number,slug,cashback_config,cb_rules_json,created,updated'),
  ])

  const sbToPb = new Map<string, string>()
  for (const c of sbCategories as any[]) {
    const bySlug = pbCategories.find((p: any) => p.slug === c.id)
    const byStable = pbCategories.find((p: any) => p.id === stableToPocketBaseId(c.id))
    const match = bySlug || byStable
    if (match) sbToPb.set(c.id, match.id)
  }

  let scanned = 0
  let patched = 0

  for (const acc of pbAccounts as any[]) {
    scanned += 1
    const m1 = migratePolicyCatIds(acc.cashback_config, sbToPb)
    const m2 = migratePolicyCatIds(acc.cb_rules_json, sbToPb)

    if (!m1.changed && !m2.changed) continue

    if (DRY_RUN) {
      patched += 1
      continue
    }

    await pbRequest(`/api/collections/${PB_ACCOUNTS}/records/${acc.id}`, {
      method: 'PATCH',
      body: {
        cashback_config: m1.value,
        cb_rules_json: m2.value,
      },
    })
    patched += 1
  }

  console.log(`  categories mapped: ${sbToPb.size}`)
  console.log(`  accounts scanned: ${scanned}`)
  console.log(`  accounts patched: ${patched}${DRY_RUN ? ' (dry-run)' : ''}`)
}

function normalizeName(v: string | null | undefined) {
  return String(v || '').trim().toLowerCase()
}

async function dedupeAccountsAndRelinkTxns() {
  console.log('\n[2/2] Deduping accounts and relinking transactions...')

  const pbAccounts = await pbListAll(PB_ACCOUNTS, 'id,name,account_number,slug,created')
  const groups = new Map<string, any[]>()

  for (const a of pbAccounts as any[]) {
    const name = normalizeName(a.name)
    const accountNumber = String(a.account_number || '').trim()
    if (!name || !accountNumber) continue
    const key = `${name}||${accountNumber}`
    const list = groups.get(key) || []
    list.push(a)
    groups.set(key, list)
  }

  const duplicateGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1)

  let groupsProcessed = 0
  let relinkedAsSource = 0
  let relinkedAsTarget = 0
  let deletedAccounts = 0

  for (const [, rows] of duplicateGroups) {
    groupsProcessed += 1

    const sorted = [...rows].sort((a, b) => {
      const aHasSlug = a.slug ? 1 : 0
      const bHasSlug = b.slug ? 1 : 0
      if (aHasSlug !== bHasSlug) return bHasSlug - aHasSlug
      const at = new Date(a.created || 0).getTime()
      const bt = new Date(b.created || 0).getTime()
      return at - bt
    })

    const keep = sorted[0]
    const remove = sorted.slice(1)

    for (const dup of remove) {
      const sourceTxns = await pbRequest(`/api/collections/${PB_TRANSACTIONS}/records`, {
        query: {
          perPage: '500',
          fields: 'id,account_id,to_account_id',
          filter: `account_id = \"${dup.id}\"`,
        },
      })

      for (const t of sourceTxns.items || []) {
        if (!DRY_RUN) {
          await pbRequest(`/api/collections/${PB_TRANSACTIONS}/records/${t.id}`, {
            method: 'PATCH',
            body: { account_id: keep.id },
          })
        }
        relinkedAsSource += 1
      }

      const targetTxns = await pbRequest(`/api/collections/${PB_TRANSACTIONS}/records`, {
        query: {
          perPage: '500',
          fields: 'id,account_id,to_account_id',
          filter: `to_account_id = \"${dup.id}\"`,
        },
      })

      for (const t of targetTxns.items || []) {
        if (!DRY_RUN) {
          await pbRequest(`/api/collections/${PB_TRANSACTIONS}/records/${t.id}`, {
            method: 'PATCH',
            body: { to_account_id: keep.id },
          })
        }
        relinkedAsTarget += 1
      }

      if (!DRY_RUN) {
        await pbRequest(`/api/collections/${PB_ACCOUNTS}/records/${dup.id}`, { method: 'DELETE' })
      }
      deletedAccounts += 1
    }
  }

  console.log(`  duplicate groups: ${duplicateGroups.length}`)
  console.log(`  groups processed: ${groupsProcessed}`)
  console.log(`  txns relinked (account_id): ${relinkedAsSource}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log(`  txns relinked (to_account_id): ${relinkedAsTarget}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log(`  duplicate accounts deleted: ${deletedAccounts}${DRY_RUN ? ' (dry-run)' : ''}`)
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`)
  await pbAuth()
  await migrateAllAccountsCatIds()
  await dedupeAccountsAndRelinkTxns()
  console.log('\nDone')
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
