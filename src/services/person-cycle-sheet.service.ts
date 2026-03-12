'use server'

import { pocketbaseList, toPocketBaseId } from '@/services/pocketbase/server'
import { PersonCycleSheet } from '@/types/moneyflow.types'

/**
 * Returns person cycle sheets from PocketBase.
 * The person_id must be a valid PocketBase ID.
 */
export async function getPersonCycleSheets(personId: string): Promise<PersonCycleSheet[]> {
  if (!personId) return []
  try {
    const pbId = toPocketBaseId(personId, 'people');
    console.log(`[DB:PB] person-cycle-sheets.get person=${pbId}`)
    
    const response = await pocketbaseList('person_cycle_sheets', {
        filter: `person_id = "${pbId}"`,
        sort: '-cycle_tag'
    });

    return (response.items as PersonCycleSheet[]) ?? []
  } catch (err) {
    console.error('[DB:PB] Failed to get person cycle sheets:', err)
    return []
  }
}
