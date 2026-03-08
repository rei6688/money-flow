/**
 * PocketBase People Service
 * Provides people read/write operations from PocketBase
 * 
 * Phase 3: People & Relationships Refactoring
 * Status: To be implemented
 */

import { logSource } from '@/lib/pocketbase/fallback-helpers'

/**
 * Fetch all people from PocketBase
 */
export async function getPocketBasePeople() {
  logSource('PB', 'people.select')
  throw new Error('getPocketBasePeople not yet implemented - Phase 3 pending')
}

/**
 * Fetch person by ID from PocketBase
 */
export async function getPocketBasePersonById(id: string) {
  logSource('PB', `person.get('${id}')`)
  throw new Error('getPocketBasePersonById not yet implemented - Phase 3 pending')
}

/**
 * Create person in PocketBase
 */
export async function createPocketBasePerson(data: any) {
  logSource('PB', `person.create`, data)
  throw new Error('createPocketBasePerson not yet implemented - Phase 3 pending')
}

/**
 * Update person in PocketBase
 */
export async function updatePocketBasePerson(id: string, data: any) {
  logSource('PB', `person.update('${id}')`, data)
  throw new Error('updatePocketBasePerson not yet implemented - Phase 3 pending')
}
