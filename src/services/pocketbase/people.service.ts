import { createClient } from '@/lib/supabase/server'
import { executeWithFallback, logSource } from '@/lib/pocketbase/fallback-helpers'
import { Person } from '@/types/moneyflow.types'
import {
  pocketbaseCreate,
  pocketbaseDelete,
  pocketbaseGetById,
  pocketbaseList,
  pocketbaseUpdate,
  toPocketBaseId,
} from './server'

type PocketBaseRecord = Record<string, unknown>

type PocketBasePersonWrite = {
  name: string
  image_url?: string | null
  sheet_link?: string | null
  google_sheet_url?: string | null
  is_owner?: boolean | null
  is_archived?: boolean | null
  is_group?: boolean | null
  group_parent_id?: string | null
  sheet_full_img?: string | null
  sheet_show_bank_account?: boolean
  sheet_bank_info?: string | null
  sheet_linked_bank_id?: string | null
  sheet_show_qr_image?: boolean
}

function mapPerson(record: PocketBaseRecord): Person {
  return {
    id: String(record.slug || record.id || ''),
    created_at: typeof record.created === 'string' ? record.created : undefined,
    name: String(record.name || ''),
    image_url: (record.image_url as string | null | undefined) ?? null,
    sheet_link: (record.sheet_link as string | null | undefined) ?? null,
    google_sheet_url: (record.google_sheet_url as string | null | undefined) ?? null,
    sheet_full_img: (record.sheet_full_img as string | null | undefined) ?? null,
    sheet_show_bank_account: (record.sheet_show_bank_account as boolean | null | undefined) ?? null,
    sheet_bank_info: (record.sheet_bank_info as string | null | undefined) ?? null,
    sheet_linked_bank_id: (record.sheet_linked_bank_id as string | null | undefined) ?? null,
    sheet_show_qr_image: (record.sheet_show_qr_image as boolean | null | undefined) ?? null,
    is_owner: (record.is_owner as boolean | null | undefined) ?? null,
    is_archived: (record.is_archived as boolean | null | undefined) ?? null,
    is_group: (record.is_group as boolean | null | undefined) ?? null,
    group_parent_id: (record.group_parent_id as string | null | undefined) ?? null,
  }
}

export async function resolvePocketBasePersonRecord(sourceOrPocketBaseId: string): Promise<PocketBaseRecord | null> {
  if (!sourceOrPocketBaseId) return null

  try {
    return await pocketbaseGetById<PocketBaseRecord>('people', sourceOrPocketBaseId)
  } catch {
    // continue
  }

  try {
    const pbId = toPocketBaseId(sourceOrPocketBaseId)
    return await pocketbaseGetById<PocketBaseRecord>('people', pbId)
  } catch {
    // continue
  }

  try {
    const escapedId = sourceOrPocketBaseId.replace(/'/g, "\\'")
    const bySlug = await pocketbaseList<PocketBaseRecord>('people', {
      perPage: 1,
      page: 1,
      filter: `slug='${escapedId}'`,
    })
    return bySlug.items?.[0] ?? null
  } catch {
    return null
  }
}

export async function getPocketBasePeople(): Promise<Person[]> {
  return executeWithFallback(
    async () => {
      logSource('PB', 'people.list')
      const response = await pocketbaseList<PocketBaseRecord>('people', {
        perPage: 500,
        page: 1,
      })
      return response.items.map(mapPerson).sort((a, b) => a.name.localeCompare(b.name))
    },
    async () => {
      logSource('SB', 'people.list fallback')
      const supabase = createClient()
      const { data, error } = await supabase
        .from('people')
        .select('id, created_at, name, image_url, sheet_link, google_sheet_url, is_owner, is_archived, is_group, group_parent_id, sheet_full_img, sheet_show_bank_account, sheet_bank_info, sheet_linked_bank_id, sheet_show_qr_image')
        .order('name', { ascending: true })

      if (error) throw error

      return (data ?? []).map((item) => ({
        id: item.id,
        created_at: item.created_at ?? undefined,
        name: item.name,
        image_url: item.image_url,
        sheet_link: item.sheet_link,
        google_sheet_url: item.google_sheet_url,
        is_owner: item.is_owner,
        is_archived: item.is_archived,
        is_group: item.is_group,
        group_parent_id: item.group_parent_id,
        sheet_full_img: item.sheet_full_img,
        sheet_show_bank_account: item.sheet_show_bank_account,
        sheet_bank_info: item.sheet_bank_info,
        sheet_linked_bank_id: item.sheet_linked_bank_id,
        sheet_show_qr_image: item.sheet_show_qr_image,
      }))
    },
    'people.list'
  )
}

export async function getPocketBasePersonDetails(sourceOrPocketBaseId: string): Promise<Person | null> {
  return executeWithFallback(
    async () => {
      logSource('PB', 'people.get', { sourceOrPocketBaseId })
      const personRecord = await resolvePocketBasePersonRecord(sourceOrPocketBaseId)
      if (!personRecord) return null
      return mapPerson(personRecord)
    },
    async () => {
      logSource('SB', 'people.get fallback', { sourceOrPocketBaseId })
      const supabase = createClient()
      const { data, error } = await supabase
        .from('people')
        .select('id, created_at, name, image_url, sheet_link, google_sheet_url, is_owner, is_archived, is_group, group_parent_id, sheet_full_img, sheet_show_bank_account, sheet_bank_info, sheet_linked_bank_id, sheet_show_qr_image')
        .eq('id', sourceOrPocketBaseId)
        .maybeSingle()

      if (error) throw error
      if (!data) return null

      return {
        id: data.id,
        created_at: data.created_at ?? undefined,
        name: data.name,
        image_url: data.image_url,
        sheet_link: data.sheet_link,
        google_sheet_url: data.google_sheet_url,
        is_owner: data.is_owner,
        is_archived: data.is_archived,
        is_group: data.is_group,
        group_parent_id: data.group_parent_id,
        sheet_full_img: data.sheet_full_img,
        sheet_show_bank_account: data.sheet_show_bank_account,
        sheet_bank_info: data.sheet_bank_info,
        sheet_linked_bank_id: data.sheet_linked_bank_id,
        sheet_show_qr_image: data.sheet_show_qr_image,
      }
    },
    'people.get'
  )
}

export async function getPocketBasePersonById(sourceOrPocketBaseId: string): Promise<Person | null> {
  return getPocketBasePersonDetails(sourceOrPocketBaseId)
}

export async function createPocketBasePerson(
  supabaseId: string,
  data: PocketBasePersonWrite
): Promise<boolean> {
  return executeWithFallback(
    async () => {
      const pbId = toPocketBaseId(supabaseId)
      logSource('PB', 'people.create', { supabaseId, pbId, name: data.name })
      await pocketbaseCreate<PocketBaseRecord>('people', {
        id: pbId,
        slug: supabaseId,
        ...data,
        group_parent_id: data.group_parent_id ? toPocketBaseId(data.group_parent_id) : null,
      })
      return true
    },
    async () => {
      logSource('SB', 'people.create fallback', { supabaseId })
      return false
    },
    'people.create'
  )
}

export async function updatePocketBasePerson(
  sourceOrPocketBaseId: string,
  data: Partial<PocketBasePersonWrite>
): Promise<boolean> {
  return executeWithFallback(
    async () => {
      const record = await resolvePocketBasePersonRecord(sourceOrPocketBaseId)
      if (!record?.id) return false

      const body: Record<string, unknown> = { ...data }
      if (typeof body.group_parent_id === 'string' && body.group_parent_id) {
        body.group_parent_id = toPocketBaseId(body.group_parent_id)
      }

      await pocketbaseUpdate<PocketBaseRecord>('people', String(record.id), body)
      return true
    },
    async () => {
      logSource('SB', 'people.update fallback', { sourceOrPocketBaseId })
      return false
    },
    'people.update'
  )
}

export async function deletePocketBasePerson(sourceOrPocketBaseId: string): Promise<boolean> {
  return executeWithFallback(
    async () => {
      const record = await resolvePocketBasePersonRecord(sourceOrPocketBaseId)
      if (!record?.id) return false
      await pocketbaseDelete('people', String(record.id))
      return true
    },
    async () => {
      logSource('SB', 'people.delete fallback', { sourceOrPocketBaseId })
      return false
    },
    'people.delete'
  )
}
