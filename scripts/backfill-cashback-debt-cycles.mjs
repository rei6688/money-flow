/**
 * Backfill Script: SB → PB Migration for Debt Cycles & Cashback Share Fields
 * 
 * Purpose:
 * - Populate debt_cycle_tag in PB from SB transaction.tag (for type='debt')
 * - Backfill cashback_share_percent, cashback_share_fixed, cashback_mode to PB
 * - Validate final_price calculation matches metadata
 * 
 * Usage: node scripts/backfill-cashback-debt-cycles.mjs [--dry-run] [--limit 100]
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://api-db.reiwarden.io.vn'
const PB_PASSWORD = (process.env.POCKETBASE_DB_PASSWORD || '').trim()

if (!SUPABASE_URL || !SUPABASE_KEY || !PB_PASSWORD) {
  console.error('[Backfill] Missing environment variables. Please check .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const isDryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.find(arg => arg.startsWith('--limit'))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity

console.log(`[Backfill] Starting backfill script (dry-run: ${isDryRun}, limit: ${limit < Infinity ? limit : 'unlimited'})`)

// Helper functions
function toPocketBaseId(supabaseId, collection = 'transactions') {
  const hash = crypto.createHash('sha256').update(supabaseId).digest()
  const base32Chars = 'abcdefghijklmnopqrstuvwxyz234567'
  let result = ''
  for (let i = 0; i < 15; i++) {
    result += base32Chars[(hash[i] >>> (i % 8 - 3)) & 31]
  }
  return result
}

async function pocketbaseRequest(path, options = {}) {
  const url = `${PB_URL}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  const response = await fetch(url, { ...options, headers })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PocketBase request failed [${response.status}] ${path}: ${text}`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

async function pocketbaseGetById(collection, id) {
  return pocketbaseRequest(`/api/collections/${collection}/records/${id}`)
}

async function pocketbaseUpdate(collection, id, data) {
  return pocketbaseRequest(`/api/collections/${collection}/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/**
 * Validate final_price = amount - (amount * share_percent + share_fixed)
 */
function validateFinalPrice(amount, sharePercent, shareFixed) {
  if (amount === null) return null

  const percent = sharePercent ?? 0
  const fixed = shareFixed ?? 0
  const normalizedPercent = percent > 1 ? percent / 100 : percent

  // final_price = amount - cashback (where cashback = amount * percent + fixed)
  const cashback = Math.abs(amount) * normalizedPercent + fixed
  return amount - cashback
}

async function main() {
  const stats = {
    total: 0,
    processed: 0,
    updated: 0,
    errors: [],
  }

  try {
    // Fetch all SB transactions
    console.log('[Backfill] Fetching transactions from Supabase...')
    const { data: sbTxns, error: sbError } = await supabase
      .from('transactions')
      .select(
        'id, type, tag, cashback_share_percent, cashback_share_fixed, cashback_mode, amount, final_price, metadata'
      )
      .order('occurred_at', { ascending: true })
      .limit(limit)

    if (sbError) {
      console.error('[Backfill] SB fetch error:', sbError)
      return
    }

    stats.total = (sbTxns || []).length
    console.log(`[Backfill] Found ${stats.total} transactions to process`)

    if (!sbTxns || sbTxns.length === 0) {
      console.log('[Backfill] No transactions found. Exiting.')
      return
    }

    // Process each transaction
    for (const sbTxn of sbTxns) {
      stats.processed++
      const sbTxnId = sbTxn.id
      const progress = `[${stats.processed}/${stats.total}]`

      try {
        // Resolve PB transaction
        const pbId = toPocketBaseId(sbTxnId, 'transactions')
        let pbTxn = null
        
        try {
          pbTxn = await pocketbaseGetById('transactions', pbId)
        } catch (err) {
          console.warn(`${progress} PB transaction not found for SB id ${sbTxnId}`)
          stats.errors.push({
            id: sbTxnId,
            error: 'PB transaction not found',
          })
          continue
        }

        // Prepare update payload
        const payload = {}
        let updated = false

        // 1. Backfill debt_cycle_tag from tag (for debt transactions)
        if (sbTxn.type === 'debt' && sbTxn.tag && (!pbTxn.debt_cycle_tag || pbTxn.debt_cycle_tag === '')) {
          payload.debt_cycle_tag = sbTxn.tag
          updated = true
          console.log(`${progress} Setting debt_cycle_tag="${sbTxn.tag}" for ${sbTxnId}`)
        }

        // 2. Backfill cashback share fields
        if (sbTxn.cashback_share_percent !== null && sbTxn.cashback_share_percent !== undefined &&
            (!pbTxn.cashback_share_percent || pbTxn.cashback_share_percent === 0)) {
          payload.cashback_share_percent = sbTxn.cashback_share_percent
          updated = true
          console.log(`${progress} Setting cashback_share_percent=${sbTxn.cashback_share_percent} for ${sbTxnId}`)
        }

        if (sbTxn.cashback_share_fixed !== null && sbTxn.cashback_share_fixed !== undefined &&
            (!pbTxn.cashback_share_fixed || pbTxn.cashback_share_fixed === 0)) {
          payload.cashback_share_fixed = sbTxn.cashback_share_fixed
          updated = true
          console.log(`${progress} Setting cashback_share_fixed=${sbTxn.cashback_share_fixed} for ${sbTxnId}`)
        }

        if (sbTxn.cashback_mode && (!pbTxn.cashback_mode || pbTxn.cashback_mode === '')) {
          payload.cashback_mode = sbTxn.cashback_mode
          updated = true
          console.log(`${progress} Setting cashback_mode="${sbTxn.cashback_mode}" for ${sbTxnId}`)
        }

        // 3. Validate and sync final_price to metadata if discrepancy
        const expectedFinalPrice = validateFinalPrice(
          sbTxn.amount,
          sbTxn.cashback_share_percent,
          sbTxn.cashback_share_fixed
        )

        if (expectedFinalPrice !== null && sbTxn.final_price !== null) {
          if (Math.abs(expectedFinalPrice - sbTxn.final_price) > 0.01) {
            console.warn(
              `${progress} Final price mismatch for ${sbTxnId}: expected=${expectedFinalPrice}, actual=${sbTxn.final_price}`
            )
          }
        }

        // Update PB if changes exist
        if (updated && !isDryRun) {
          await pocketbaseUpdate('transactions', pbId, payload)
          stats.updated++
          console.log(`${progress} ✓ Updated PB transaction ${sbTxnId}`)
        } else if (updated) {
          stats.updated++
          console.log(`${progress} [DRY RUN] Would update ${sbTxnId}`)
        } else {
          console.log(`${progress} No changes needed for ${sbTxnId}`)
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`${progress} Error processing ${sbTxnId}: ${errorMsg}`)
        stats.errors.push({
          id: sbTxnId,
          error: errorMsg,
        })
      }
    }

    // Summary
    console.log('\n[Backfill] === SUMMARY ===')
    console.log(`Total processed: ${stats.processed}`)
    console.log(`Updated: ${stats.updated}`)
    console.log(`Errors: ${stats.errors.length}`)

    if (stats.errors.length > 0) {
      console.log('\n[Backfill] === ERRORS ===')
      stats.errors.forEach(({ id, error }) => {
        console.log(`  ${id}: ${error}`)
      })
    }

    console.log(`\n[Backfill] Backfill completed in ${isDryRun ? 'DRY RUN' : 'PRODUCTION'} mode.`)
  } catch (err) {
    console.error('[Backfill] Fatal error:', err)
    process.exit(1)
  }
}

main().catch(console.error)
