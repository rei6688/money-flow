'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { Category } from '@/types/moneyflow.types'
import {
  pocketbaseList,
  pocketbaseGetById,
  toPocketBaseId,
  pocketbaseCreate,
  pocketbaseUpdate,
  pocketbaseDelete,
} from '@/services/pocketbase/server'
import {
  getPocketBaseCategories,
  createPocketBaseCategory,
  updatePocketBaseCategory,
  togglePocketBaseCategoryArchive,
  deletePocketBaseCategory,
  togglePocketBaseCategoriesArchiveBulk,
  deletePocketBaseCategoriesBulk,
} from '@/services/pocketbase/account-details.service'

export async function getCategories(): Promise<Category[]> {
  console.log('[DB:PB] categories.list')
  try {
    return await getPocketBaseCategories()
  } catch (err) {
    console.error('[DB:PB] categories.list failed:', err)
    return []
  }
}

export async function createCategory(category: Omit<Category, 'id'>): Promise<Category | null> {
  console.log('[DB:PB] categories.create', { name: category.name })
  
  // Create a temporary ID to hash for consistent PB ID if needed, 
  // but for categories we can just let PB generate or use random
  const tempId = crypto.randomUUID()
  
  try {
    const success = await createPocketBaseCategory(tempId, {
      name: category.name,
      type: category.type,
      icon: category.icon ?? null,
      image_url: category.image_url ?? null,
      kind: category.kind ?? null,
      mcc_codes: (category as any).mcc_codes ?? null,
    })

    if (!success) throw new Error('Failed to create category in PocketBase')
    
    revalidatePath('/categories')
    // Re-fetch to return the actual object with PB ID
    const categories = await getPocketBaseCategories()
    return categories.find(c => c.name === category.name) || null
  } catch (err) {
    console.error('[DB:PB] categories.create failed:', err)
    return null
  }
}

export async function updateCategory(id: string, updates: Partial<Category>): Promise<Category | null> {
  console.log('[DB:PB] categories.update', { id })
  
  try {
    const success = await updatePocketBaseCategory(id, {
      name: updates.name,
      type: updates.type,
      icon: updates.icon ?? null,
      image_url: updates.image_url ?? null,
      kind: updates.kind ?? null,
      mcc_codes: (updates as any).mcc_codes ?? null,
    })

    if (!success) throw new Error('Failed to update category in PocketBase')

    revalidatePath('/categories')
    return (await getCategoryById(id))
  } catch (err) {
    console.error('[DB:PB] categories.update failed:', err)
    return null
  }
}

export async function getCategoryById(id: string): Promise<Category | null> {
  console.log('[DB:PB] categories.getById', { id })
  try {
    const pbId = toPocketBaseId(id, 'categories')
    const item = await pocketbaseGetById<any>('categories', pbId)
    if (!item) return null

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      parent_id: item.parent_id ?? undefined,
      icon: item.icon,
      image_url: item.image_url,
      kind: item.kind,
      mcc_codes: item.mcc_codes,
      is_archived: item.is_archived,
    }
  } catch (error) {
    console.error('[DB:PB] getCategoryById failed:', error)
    return null
  }
}

export async function getCategoryStats(year: number) {
  console.log('[DB:PB] categories.getStats', { year })
  const startDate = `${year}-01-01 00:00:00.000Z`
  const endDate = `${year}-12-31 23:59:59.999Z`

  try {
    // This could potentially fetch thousands of txns, but typical personal use is limited
    const response = await pocketbaseList<any>('transactions', {
      filter: `occurred_at >= '${startDate}' && occurred_at <= '${endDate}' && status != 'void'`,
      perPage: 2000
    })

    const stats: Record<string, { total: number; count: number }> = {}

    response.items.forEach((txn: any) => {
      if (!txn.category_id) return
      if (!stats[txn.category_id]) {
        stats[txn.category_id] = { total: 0, count: 0 }
      }
      stats[txn.category_id].total += txn.amount || 0
      stats[txn.category_id].count += 1
    })

    return stats
  } catch (error) {
    console.error('[DB:PB] getCategoryStats failed:', error)
    return {}
  }
}

export async function toggleCategoryArchive(id: string, isArchived: boolean): Promise<boolean> {
  console.log('[DB:PB] categories.toggleArchive', { id, isArchived })
  try {
    const success = await togglePocketBaseCategoryArchive(id, isArchived)
    if (success) revalidatePath('/categories')
    return success
  } catch (err) {
    console.error('[DB:PB] categories.toggleArchive failed:', err)
    return false
  }
}

export async function deleteCategory(id: string, targetId?: string): Promise<{ success: boolean; error?: string; hasTransactions?: boolean }> {
  console.log('[DB:PB] categories.delete', { id, targetId })
  
  try {
    const pbId = toPocketBaseId(id, 'categories')
    
    // 1. Check for existing transactions
    const txns = await pocketbaseList<any>('transactions', {
      filter: `category_id='${pbId}'`,
      perPage: 1
    })
    
    const hasTransactions = txns.totalItems > 0

    if (hasTransactions) {
      if (!targetId) {
        return { success: false, hasTransactions: true, error: 'Category has associated transactions' }
      }

      // 2. Handover transactions to target category
      const targetPbId = toPocketBaseId(targetId, 'categories')
      const allTxns = await pocketbaseList<any>('transactions', {
        filter: `category_id='${pbId}'`,
        perPage: 500
      })
      
      for (const txn of allTxns.items) {
        await pocketbaseUpdate('transactions', txn.id, { category_id: targetPbId })
      }
    }

    // 3. Delete the category
    const success = await deletePocketBaseCategory(pbId)
    if (success) revalidatePath('/categories')
    return { success }
  } catch (err) {
    console.error('[DB:PB] deleteCategory failed:', err)
    return { success: false, error: (err as any).message }
  }
}

export async function toggleCategoriesArchiveBulk(ids: string[], isArchived: boolean): Promise<boolean> {
  console.log('[DB:PB] categories.toggleArchiveBulk', { count: ids.length, isArchived })
  try {
    const success = await togglePocketBaseCategoriesArchiveBulk(ids, isArchived)
    if (success) revalidatePath('/categories')
    return success
  } catch (err) {
    console.error('[DB:PB] toggleCategoriesArchiveBulk failed:', err)
    return false
  }
}

export async function deleteCategoriesBulk(ids: string[], targetId?: string): Promise<{ success: boolean; error?: string; hasTransactionsIds?: string[] }> {
  console.log('[DB:PB] categories.deleteBulk', { count: ids.length, targetId })
  
  try {
    // 1. Find categories with transactions
    const idsWithTransactions: string[] = []
    const pbIds = ids.map(id => toPocketBaseId(id, 'categories'))
    
    for (const pbId of pbIds) {
      const txns = await pocketbaseList<any>('transactions', {
        filter: `category_id='${pbId}'`,
        perPage: 1
      })
      if (txns.totalItems > 0) idsWithTransactions.push(pbId)
    }

    if (idsWithTransactions.length > 0 && !targetId) {
      return { success: false, hasTransactionsIds: idsWithTransactions, error: 'Some categories have associated transactions' }
    }

    // 2. Handover if targetId provided
    if (targetId && idsWithTransactions.length > 0) {
      const targetPbId = toPocketBaseId(targetId, 'categories')
      for (const pbId of idsWithTransactions) {
        const allTxns = await pocketbaseList<any>('transactions', {
          filter: `category_id='${pbId}'`,
          perPage: 500
        })
        for (const txn of allTxns.items) {
          await pocketbaseUpdate('transactions', txn.id, { category_id: targetPbId })
        }
      }
    }

    // 3. Delete categories
    const success = await deletePocketBaseCategoriesBulk(pbIds)
    if (success) revalidatePath('/categories')
    return { success: true }
  } catch (err) {
    console.error('[DB:PB] deleteCategoriesBulk failed:', err)
    return { success: false, error: (err as any).message }
  }
}

export async function archiveCategory(id: string, targetId?: string): Promise<{ success: boolean; error?: string; hasTransactions?: boolean }> {
  console.log('[DB:PB] categories.archive', { id, targetId })
  
  try {
    const pbId = toPocketBaseId(id, 'categories')
    
    if (targetId) {
      const targetPbId = toPocketBaseId(targetId, 'categories')
      const allTxns = await pocketbaseList<any>('transactions', {
        filter: `category_id='${pbId}'`,
        perPage: 500
      })
      for (const txn of allTxns.items) {
        await pocketbaseUpdate('transactions', txn.id, { category_id: targetPbId })
      }
    } else {
      const txns = await pocketbaseList<any>('transactions', {
        filter: `category_id='${pbId}' && status != 'void'`,
        perPage: 1
      })
      if (txns.totalItems > 0) {
        return { success: false, hasTransactions: true, error: 'Category has transactions' }
      }
    }

    const success = await pocketbaseUpdate('categories', pbId, { is_archived: true })
    if (success) revalidatePath('/categories')
    return { success: !!success }
  } catch (err) {
    console.error('[DB:PB] archiveCategory failed:', err)
    return { success: false, error: (err as any).message }
  }
}
