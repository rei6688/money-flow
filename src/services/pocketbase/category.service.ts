/**
 * PocketBase Category Service
 * Provides category read/write operations from PocketBase
 * 
 * Phase 1: Foundation Tables Refactoring
 * Status: To be implemented
 */

import { logSource } from '@/lib/pocketbase/fallback-helpers'

/**
 * Fetch all categories from PocketBase
 */
export async function getPocketBaseCategories() {
  logSource('PB', 'categories.select')
  throw new Error('getPocketBaseCategories not yet implemented - Phase 1 pending')
}

/**
 * Fetch category by ID from PocketBase
 */
export async function getPocketBaseCategoryById(id: string) {
  logSource('PB', `category.get('${id}')`)
  throw new Error('getPocketBaseCategoryById not yet implemented - Phase 1 pending')
}

/**
 * Create category in PocketBase
 */
export async function createPocketBaseCategory(data: any) {
  logSource('PB', `category.create`, data)
  throw new Error('createPocketBaseCategory not yet implemented - Phase 1 pending')
}

/**
 * Update category in PocketBase
 */
export async function updatePocketBaseCategory(id: string, data: any) {
  logSource('PB', `category.update('${id}')`, data)
  throw new Error('updatePocketBaseCategory not yet implemented - Phase 1 pending')
}
