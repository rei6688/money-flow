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

const ids = ['m313qmn2ps30qqn', '0ece401d-36eb-4414-a637-03814c88c216']
for (const id of ids) {
  const filters = [
    `(account_id='${id}' || to_account_id='${id}' || target_account_id='${id}')`,
    `(account_id='${id}' || to_account_id='${id}')`,
  ]
  for (const filter of filters) {
    const url = `${base}/api/collections/transactions/records?perPage=5&filter=${encodeURIComponent(filter)}&sort=-date`
    const response = await fetch(url, { headers })
    const raw = await response.text()
    let parsed
    try { parsed = JSON.parse(raw) } catch { parsed = { raw } }
    console.log({ id, filter, status: response.status, count: parsed.items?.length ?? null, message: parsed.message })
  }
}
