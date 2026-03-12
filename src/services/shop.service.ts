'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import {
  pocketbaseList,
  pocketbaseGetById,
  toPocketBaseId,
  pocketbaseCreate,
  pocketbaseUpdate,
  pocketbaseDelete,
} from '@/services/pocketbase/server'
import {
  getPocketBaseShops,
  createPocketBaseShop,
  updatePocketBaseShop,
  togglePocketBaseShopArchive,
  deletePocketBaseShop,
  togglePocketBaseShopsArchiveBulk,
  deletePocketBaseShopsBulk,
} from '@/services/pocketbase/account-details.service'

export async function getShops(): Promise<any[]> {
  console.log('[DB:PB] shops.list')
  try {
    return await getPocketBaseShops()
  } catch (err) {
    console.error('[DB:PB] shops.list failed:', err)
    return []
  }
}

export async function getShopById(id: string): Promise<any | null> {
  console.log('[DB:PB] shops.getById', { id })
  try {
    const pbId = toPocketBaseId(id, 'shops')
    return await pocketbaseGetById<any>('shops', pbId)
  } catch (error) {
    console.error('[DB:PB] getShopById failed:', error)
    return null
  }
}

export async function createShop(input: {
  name: string;
  image_url?: string | null;
  default_category_id?: string | null
}): Promise<any | null> {
  console.log('[DB:PB] shops.create', { name: input.name })
  
  const tempId = crypto.randomUUID()
  try {
    const success = await createPocketBaseShop(tempId, {
      name: input.name.trim(),
      image_url: input.image_url ?? null,
      default_category_id: input.default_category_id ?? null,
    })

    if (!success) throw new Error('Failed to create shop in PocketBase')

    const shops = await getPocketBaseShops()
    return shops.find(s => s.name === input.name.trim()) || null
  } catch (err) {
    console.error('[DB:PB] shops.create failed:', err)
    return null
  }
}

export async function updateShop(id: string, input: { name?: string; image_url?: string | null; default_category_id?: string | null }): Promise<boolean> {
  console.log('[DB:PB] shops.update', { id })
  
  try {
    const success = await updatePocketBaseShop(id, {
      name: input.name,
      image_url: input.image_url,
      default_category_id: input.default_category_id,
    })
    return !!success
  } catch (err) {
    console.error('[DB:PB] shops.update failed:', err)
    return false
  }
}

export async function toggleShopArchive(id: string, isArchived: boolean): Promise<boolean> {
  console.log('[DB:PB] shops.toggleArchive', { id, isArchived })
  try {
    const success = await togglePocketBaseShopArchive(id, isArchived)
    if (success) revalidatePath('/categories')
    return success
  } catch (err) {
    console.error('[DB:PB] shops.toggleArchive failed:', err)
    return false
  }
}

export async function deleteShop(id: string, targetId?: string): Promise<{ success: boolean; error?: string; hasTransactions?: boolean }> {
  console.log('[DB:PB] shops.delete', { id, targetId })
  
  try {
    const pbId = toPocketBaseId(id, 'shops')
    
    // 1. Check for existing transactions
    const txns = await pocketbaseList<any>('transactions', {
      filter: `shop_id='${pbId}'`,
      perPage: 1
    })
    
    const hasTransactions = txns.totalItems > 0

    if (hasTransactions) {
      if (!targetId) {
        return { success: false, hasTransactions: true, error: 'Shop has associated transactions' }
      }

      // 2. Handover transactions to target shop
      const targetPbId = toPocketBaseId(targetId, 'shops')
      const allTxns = await pocketbaseList<any>('transactions', {
        filter: `shop_id='${pbId}'`,
        perPage: 500
      })
      for (const txn of allTxns.items) {
        await pocketbaseUpdate('transactions', txn.id, { shop_id: targetPbId })
      }
    }

    // 3. Delete the shop
    const success = await deletePocketBaseShop(pbId)
    if (success) revalidatePath('/categories')
    return { success }
  } catch (err) {
    console.error('[DB:PB] deleteShop failed:', err)
    return { success: false, error: (err as any).message }
  }
}

export async function toggleShopsArchiveBulk(ids: string[], isArchived: boolean): Promise<boolean> {
  console.log('[DB:PB] shops.toggleArchiveBulk', { count: ids.length, isArchived })
  try {
    const success = await togglePocketBaseShopsArchiveBulk(ids, isArchived)
    if (success) revalidatePath('/categories')
    return success
  } catch (err) {
    console.error('[DB:PB] toggleShopsArchiveBulk failed:', err)
    return false
  }
}

export async function deleteShopsBulk(ids: string[], targetId?: string): Promise<{ success: boolean; error?: string; hasTransactionsIds?: string[] }> {
  console.log('[DB:PB] shops.deleteBulk', { count: ids.length, targetId })
  
  try {
    const idsWithTransactions: string[] = []
    const pbIds = ids.map(id => toPocketBaseId(id, 'shops'))
    
    for (const pbId of pbIds) {
      const txns = await pocketbaseList<any>('transactions', {
        filter: `shop_id='${pbId}'`,
        perPage: 1
      })
      if (txns.totalItems > 0) idsWithTransactions.push(pbId)
    }

    if (idsWithTransactions.length > 0 && !targetId) {
      return { success: false, hasTransactionsIds: idsWithTransactions, error: 'Some shops have associated transactions' }
    }

    if (targetId && idsWithTransactions.length > 0) {
      const targetPbId = toPocketBaseId(targetId, 'shops')
      for (const pbId of idsWithTransactions) {
        const allTxns = await pocketbaseList<any>('transactions', {
          filter: `shop_id='${pbId}'`,
          perPage: 500
        })
        for (const txn of allTxns.items) {
          await pocketbaseUpdate('transactions', txn.id, { shop_id: targetPbId })
        }
      }
    }

    const success = await deletePocketBaseShopsBulk(pbIds)
    if (success) revalidatePath('/categories')
    return { success: true }
  } catch (err) {
    console.error('[DB:PB] deleteShopsBulk failed:', err)
    return { success: false, error: (err as any).message }
  }
}

export async function archiveShop(id: string, targetId?: string): Promise<{ success: boolean; error?: string; hasTransactions?: boolean }> {
  console.log('[DB:PB] shops.archive', { id, targetId })
  
  try {
    const pbId = toPocketBaseId(id, 'shops')
    
    if (targetId) {
      const targetPbId = toPocketBaseId(targetId, 'shops')
      const allTxns = await pocketbaseList<any>('transactions', {
        filter: `shop_id='${pbId}'`,
        perPage: 500
      })
      for (const txn of allTxns.items) {
        await pocketbaseUpdate('transactions', txn.id, { shop_id: targetPbId })
      }
    } else {
      const txns = await pocketbaseList<any>('transactions', {
        filter: `shop_id='${pbId}' && status != 'void'`,
        perPage: 1
      })
      if (txns.totalItems > 0) {
        return { success: false, hasTransactions: true, error: 'Shop has transactions' }
      }
    }

    const success = await pocketbaseUpdate('shops', pbId, { is_archived: true })
    if (success) revalidatePath('/categories')
    return { success: !!success }
  } catch (err) {
    console.error('[DB:PB] archiveShop failed:', err)
    return { success: false, error: (err as any).message }
  }
}

export async function getShopStats(year: number) {
  console.log('[DB:PB] shops.getStats', { year })
  const startDate = `${year}-01-01 00:00:00.000Z`
  const endDate = `${year}-12-31 23:59:59.999Z`

  try {
    const response = await pocketbaseList<any>('transactions', {
      filter: `occurred_at >= '${startDate}' && occurred_at <= '${endDate}' && status != 'void'`,
      perPage: 2000
    })

    const stats: Record<string, { total: number; count: number }> = {}

    response.items.forEach((txn: any) => {
      if (!txn.shop_id) return
      if (!stats[txn.shop_id]) {
        stats[txn.shop_id] = { total: 0, count: 0 }
      }
      stats[txn.shop_id].total += txn.amount || 0
      stats[txn.shop_id].count += 1
    })

    return stats
  } catch (error) {
    console.error('[DB:PB] getShopStats failed:', error)
    return {}
  }
}
