import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const PB_URL = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn'
const email = process.env.POCKETBASE_DB_EMAIL
const pass = process.env.POCKETBASE_DB_PASSWORD
const sourceId = process.argv[2]

if (!sourceId) {
  console.error('Usage: node scripts/pocketbase/check-source-txn.mjs <source_uuid>')
  process.exit(1)
}

const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: email, password: pass }),
})
if (!auth.ok) {
  throw new Error(`Auth failed: ${auth.status} ${await auth.text()}`)
}
const authData = await auth.json()

const qs = new URLSearchParams({ perPage: '1', filter: `metadata.source_id='${sourceId}'` })
const res = await fetch(`${PB_URL}/api/collections/transactions/records?${qs.toString()}`, {
  headers: { Authorization: authData.token },
})
if (!res.ok) {
  throw new Error(`Query failed: ${res.status} ${await res.text()}`)
}
const data = await res.json()
const record = (data.items || [])[0]

if (!record) {
  console.log('not-found')
  process.exit(0)
}

console.log(JSON.stringify({
  id: record.id,
  type: record.type,
  amount: record.amount,
  final_price: record.final_price,
  cashback_share_percent: record.cashback_share_percent,
  cashback_share_fixed: record.cashback_share_fixed,
  cashback_mode: record.cashback_mode,
  debt_cycle_tag: record.debt_cycle_tag,
  persisted_cycle_tag: record.persisted_cycle_tag,
  metadata: record.metadata,
}, null, 2))
