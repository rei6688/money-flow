/**
 * PocketBase Category Service
 * Provides category read/write operations from PocketBase
 * Phase 1: Foundation Tables Implementation
 * Collection ID: pvl_cat_001
 */

import { logSource } from '@/lib/pocketbase/fallback-helpers'

const CATEGORIES_COLLECTION_ID = 'pvl_cat_001'

/**
 * Map PocketBase category record to Category type
 */
function mapPBCategory(record: any) {
  const imageUrl = typeof record.image_url === 'string' && record.image_url.startsWith('http')
    ? record.image_url
    : undefined

  const normalizedType =
    record.type === 'income' ||
    record.type === 'expense' ||
    record.type === 'transfer' ||
    record.type === 'investment'
      ? record.type
      : 'expense'

  const normalizedKind = record.kind === 'internal' || record.kind === 'external' ? record.kind : null

  return {
    id: record.id,
    name: record.name,
    type: normalizedType,
    icon: record.icon || undefined,
    image_url: imageUrl,
    kind: normalizedKind,
    mcc_codes: Array.isArray(record.mcc_codes) ? record.mcc_codes : undefined,
    parent_id: record.parent_id || undefined,
    is_archived: record.is_archived ?? false,
  }
}

/**
 * Fetch all categories from PocketBase
 */
export async function getPocketBaseCategories(): Promise<any[]> {
  logSource('PB', 'categories.select')

  try {
    const candidateUrls = [
      `https://api-db.reiwarden.io.vn/api/collections/${CATEGORIES_COLLECTION_ID}/records?perPage=200`,
      'https://api-db.reiwarden.io.vn/api/collections/categories/records?perPage=200',
    ]

    let response: Response | null = null
    let lastErrorText = ''

    for (const url of candidateUrls) {
      const currentResponse = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (currentResponse.ok) {
        response = currentResponse
        break
      }

      lastErrorText = await currentResponse.text()
      logSource('PB', 'categories.select attempt failed', {
        url,
        status: currentResponse.status,
      })
    }

    if (!response) {
      throw new Error(`PB request failed after retries: ${lastErrorText}`)
    }

    const data = await response.json()
    const records = data.items || []
    logSource('PB', 'categories.select result', { count: records.length })
    return records.map(mapPBCategory)
  } catch (error) {
    logSource('PB', 'categories.select failed', error)
    throw error
  }
}

/**
 * Fetch category by ID from PocketBase
 */
export async function getPocketBaseCategoryById(id: string): Promise<any> {
  logSource('PB', `category.get('${id}')`)

  try {
    const response = await fetch(
      `https://api-db.reiwarden.io.vn/api/collections/${CATEGORIES_COLLECTION_ID}/records/${id}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    )

    if (!response.ok) {
      throw new Error(`PB request failed [${response.status}]`)
    }

    const record = await response.json()
    return mapPBCategory(record)
  } catch (error) {
    logSource('PB', `category.get('${id}') failed`, error)
    throw error
  }
}

/**
 * Create category in PocketBase
 */
export async function createPocketBaseCategory(data: { name: string; icon?: string; parent_id?: string }) {
  logSource('PB', 'category.create', { name: data.name })

  try {
    const payload = {
      name: data.name,
      icon: data.icon || '',
      parent_id: data.parent_id || '',
      is_archived: false,
      type: 'expense',
      kind: 'internal',
      mcc_codes: [],
    }

    const response = await fetch(
      `https://api-db.reiwarden.io.vn/api/collections/${CATEGORIES_COLLECTION_ID}/records`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`PB request failed [${response.status}]: ${error}`)
    }

    const record = await response.json()
    return mapPBCategory(record)
  } catch (error) {
    logSource('PB', 'category.create failed', error)
    throw error
  }
}

/**
 * Update category in PocketBase
 */
export async function updatePocketBaseCategory(
  id: string,
  data: { name?: string; icon?: string; parent_id?: string; is_archived?: boolean }
) {
  logSource('PB', `category.update('${id}')`, data)

  try {
    const payload: Record<string, any> = {}
    if (data.name !== undefined) payload.name = data.name
    if (data.icon !== undefined) payload.icon = data.icon
    if (data.parent_id !== undefined) payload.parent_id = data.parent_id
    if (data.is_archived !== undefined) payload.is_archived = data.is_archived

    const response = await fetch(
      `https://api-db.reiwarden.io.vn/api/collections/${CATEGORIES_COLLECTION_ID}/records/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`PB request failed [${response.status}]: ${error}`)
    }

    const record = await response.json()
    return mapPBCategory(record)
  } catch (error) {
    logSource('PB', `category.update('${id}') failed`, error)
    throw error
  }
}
