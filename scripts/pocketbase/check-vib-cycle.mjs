import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const base = process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn'
const email = process.env.POCKETBASE_DB_EMAIL
const password = process.env.POCKETBASE_DB_PASSWORD

const authRes = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password }),
})
const auth = await authRes.json()
const headers = { Authorization: auth.token }

const accountId = 'm313qmn2ps30qqn'
const accRes = await fetch(`${base}/api/collections/accounts/records/${accountId}`, { headers })
const acc = await accRes.json()
console.log('account', { id: acc.id, slug: acc.slug, name: acc.name })

const filters = [
  `account_id='${accountId}'`,
  acc.slug ? `account_id='${acc.slug}'` : null,
].filter(Boolean)

for (const filter of filters) {
  const url = `${base}/api/collections/cashback_cycles/records?perPage=5&sort=-cycle_tag&filter=${encodeURIComponent(filter)}`
  const response = await fetch(url, { headers })
  const data = await response.json()
  console.log('cycles', { filter, status: response.status, count: (data.items || []).length, sample: data.items?.[0]?.cycle_tag })
}
