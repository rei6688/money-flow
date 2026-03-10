'use server'

import { createClient } from '@/lib/supabase/server'
import { resolvePocketBasePersonRecord } from '@/services/pocketbase/people.service'
import { PersonCycleSheet } from '@/types/moneyflow.types'

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

async function resolveSupabasePersonId(sourceOrPocketBaseId: string): Promise<string | null> {
  if (!sourceOrPocketBaseId) return null
  if (isUuid(sourceOrPocketBaseId)) return sourceOrPocketBaseId

  const record = await resolvePocketBasePersonRecord(sourceOrPocketBaseId)
  const slug = typeof record?.slug === 'string' ? record.slug : null
  if (slug && isUuid(slug)) return slug

  return null
}

export async function getPersonCycleSheets(personId: string): Promise<PersonCycleSheet[]> {
  if (!personId) return []
  const resolvedPersonId = await resolveSupabasePersonId(personId)
  if (!resolvedPersonId) return []
  const supabase = createClient()
  const { data, error } = await (supabase as any)
    .from('person_cycle_sheets')
    .select('id, person_id, cycle_tag, sheet_id, sheet_url, created_at, updated_at')
    .eq('person_id', resolvedPersonId)

  if (error) {
    console.warn('Unable to load person cycle sheets:', error)
    return []
  }

  return (data as PersonCycleSheet[]) ?? []
}
