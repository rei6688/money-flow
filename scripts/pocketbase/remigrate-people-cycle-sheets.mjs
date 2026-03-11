import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PB_URL = (process.env.POCKETBASE_URL || 'https://api-db.reiwarden.io.vn').trim()
const PB_EMAIL = (process.env.POCKETBASE_DB_EMAIL || '').trim()
const PB_PASSWORD = (process.env.POCKETBASE_DB_PASSWORD || '').trim()

if (!SUPABASE_URL || !SUPABASE_KEY || !PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error('[people-remigrate] Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POCKETBASE_URL/POCKETBASE_DB_EMAIL/POCKETBASE_DB_PASSWORD')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const argSet = new Set(process.argv.slice(2))
const isApply = argSet.has('--apply')
const shouldCleanup = argSet.has('--cleanup')

function toPocketBaseId(sourceId, fallbackPrefix = 'mf3') {
  if (!sourceId) {
    const seed = `${fallbackPrefix}-${Date.now()}-${Math.random()}`
    const hash = crypto.createHash('sha256').update(seed).digest()
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let randomId = ''
    for (let i = 0; i < 15; i++) randomId += chars[hash[i] % chars.length]
    return randomId
  }
  if (/^[a-z0-9]{15}$/.test(String(sourceId))) return String(sourceId)
  const hash = crypto.createHash('sha256').update(String(sourceId)).digest()
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 15; i++) result += chars[hash[i] % chars.length]
  return result
}

async function pbAuthHeaders() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })
  if (!res.ok) throw new Error(`[people-remigrate] PB auth failed: ${await res.text()}`)
  const body = await res.json()
  return {
    'Content-Type': 'application/json',
    Authorization: body.token,
  }
}

async function pbListAll(collection, headers, fields = 'id') {
  const rows = []
  let page = 1
  let totalPages = 1
  do {
    const res = await fetch(`${PB_URL}/api/collections/${collection}/records?page=${page}&perPage=200&fields=${encodeURIComponent(fields)}`, { headers })
    if (!res.ok) throw new Error(`[people-remigrate] list ${collection} p${page} failed: ${await res.text()}`)
    const data = await res.json()
    rows.push(...(data.items || []))
    totalPages = data.totalPages || 1
    page += 1
  } while (page <= totalPages)
  return rows
}

async function pbDeleteAll(collection, headers) {
  const rows = await pbListAll(collection, headers, 'id')
  if (rows.length === 0) return 0
  let deleted = 0
  const chunkSize = 30
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    await Promise.all(chunk.map(async (row) => {
      const res = await fetch(`${PB_URL}/api/collections/${collection}/records/${row.id}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) throw new Error(`[people-remigrate] delete ${collection}/${row.id} failed: ${await res.text()}`)
    }))
    deleted += chunk.length
  }
  return deleted
}

async function pbUpsert(collection, id, body, headers) {
  const check = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}?fields=id`, { headers })
  if (check.ok) {
    const patch = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
    if (!patch.ok) throw new Error(`[people-remigrate] patch ${collection}/${id} failed: ${await patch.text()}`)
    return 'updated'
  }
  if (check.status !== 404) throw new Error(`[people-remigrate] check ${collection}/${id} failed: ${await check.text()}`)
  const create = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, ...body }),
  })
  if (!create.ok) throw new Error(`[people-remigrate] create ${collection}/${id} failed: ${await create.text()}`)
  return 'created'
}

async function main() {
  console.log(`\n[people-remigrate] mode=${isApply ? 'APPLY' : 'DRY-RUN'} cleanup=${shouldCleanup ? 'yes' : 'no'}`)

  const headers = await pbAuthHeaders()
  const [{ data: people, error: peopleError }, { data: cycleSheets, error: cycleError }] = await Promise.all([
    supabase
      .from('people')
      .select('id,name,image_url,sheet_link,google_sheet_url,is_owner,is_archived,is_group,group_parent_id,sheet_full_img,sheet_show_bank_account,sheet_bank_info,sheet_linked_bank_id,sheet_show_qr_image')
      .order('name', { ascending: true }),
    supabase
      .from('person_cycle_sheets')
      .select('id,person_id,cycle_tag,sheet_id,sheet_url,created_at,updated_at')
      .order('created_at', { ascending: true }),
  ])

  if (peopleError) throw peopleError
  if (cycleError) throw cycleError

  const sourcePeople = people || []
  const sourceCycleSheets = cycleSheets || []

  console.log(`[people-remigrate] source people=${sourcePeople.length}, person_cycle_sheets=${sourceCycleSheets.length}`)

  if (!isApply) {
    console.log('[people-remigrate] DRY-RUN done. Re-run with --apply to write.')
    return
  }

  if (shouldCleanup) {
    const deletedSheets = await pbDeleteAll('person_cycle_sheets', headers)
    const deletedPeople = await pbDeleteAll('people', headers)
    console.log(`[people-remigrate] cleanup deleted person_cycle_sheets=${deletedSheets}, people=${deletedPeople}`)
  }

  let peopleCreated = 0
  let peopleUpdated = 0
  for (const p of sourcePeople) {
    const mode = await pbUpsert('people', toPocketBaseId(p.id, 'people'), {
      slug: p.id,
      name: p.name,
      image_url: p.image_url ?? null,
      sheet_link: p.sheet_link ?? null,
      google_sheet_url: p.google_sheet_url ?? null,
      is_owner: p.is_owner ?? false,
      is_archived: p.is_archived ?? false,
      is_group: p.is_group ?? false,
      group_parent_id: p.group_parent_id ? toPocketBaseId(p.group_parent_id, 'people') : null,
      sheet_full_img: p.sheet_full_img ?? null,
      sheet_show_bank_account: p.sheet_show_bank_account ?? false,
      sheet_bank_info: p.sheet_bank_info ?? null,
      sheet_linked_bank_id: p.sheet_linked_bank_id ? toPocketBaseId(p.sheet_linked_bank_id, 'accounts') : null,
      sheet_show_qr_image: p.sheet_show_qr_image ?? false,
    }, headers)
    if (mode === 'created') peopleCreated += 1
    else peopleUpdated += 1
  }

  let sheetsCreated = 0
  let sheetsUpdated = 0
  for (const s of sourceCycleSheets) {
    const mode = await pbUpsert('person_cycle_sheets', toPocketBaseId(s.id, 'person_cycle_sheets'), {
      person_id: s.person_id ? toPocketBaseId(s.person_id, 'people') : null,
      cycle_tag: s.cycle_tag,
      sheet_id: s.sheet_id ?? null,
      sheet_url: s.sheet_url ?? null,
    }, headers)
    if (mode === 'created') sheetsCreated += 1
    else sheetsUpdated += 1
  }

  console.log('[people-remigrate] DONE')
  console.log(`[people-remigrate] people created=${peopleCreated}, updated=${peopleUpdated}`)
  console.log(`[people-remigrate] person_cycle_sheets created=${sheetsCreated}, updated=${sheetsUpdated}`)
}

main().catch((error) => {
  console.error('[people-remigrate] fatal:', error)
  process.exit(1)
})
