/**
 * PocketBase Shop Service
 * Provides shop read/write operations from PocketBase
 * Phase 1: Foundation Tables Implementation
 * Collection ID: pvl_shop_001
 */

import { logSource } from '@/lib/pocketbase/fallback-helpers'

const SHOPS_COLLECTION_ID = 'pvl_shop_001'

/**
 * Map PocketBase shop record to Shop type
 */
function mapPBShop(record: any) {
  const imageUrl = typeof record.image_url === 'string' && record.image_url.startsWith('http')
    ? record.image_url
    : undefined

  return {
    id: record.id,
    name: record.name,
    image_url: imageUrl,
    default_category_id: record.default_category_id || undefined,
    is_archived: record.is_archived ?? false,
  }
}

/**
 * Fetch all shops from PocketBase
 */
export async function getPocketBaseShops(): Promise<any[]> {
  logSource('PB', 'shops.select')

  try {
    const candidateUrls = [
      `https://api-db.reiwarden.io.vn/api/collections/${SHOPS_COLLECTION_ID}/records?perPage=200`,
      'https://api-db.reiwarden.io.vn/api/collections/shops/records?perPage=200',
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
      logSource('PB', 'shops.select attempt failed', {
        url,
        status: currentResponse.status,
      })
    }

    if (!response) {
      throw new Error(`PB request failed after retries: ${lastErrorText}`)
    }

    const data = await response.json()
    const records = data.items || []
    logSource('PB', 'shops.select result', { count: records.length })
    return records.map(mapPBShop)
  } catch (error) {
    logSource('PB', 'shops.select failed', error)
    throw error
  }
}

/**
 * Fetch shop by ID from PocketBase
 */
export async function getPocketBaseShopById(id: string): Promise<any> {
  logSource('PB', `shop.get('${id}')`)

  try {
    const response = await fetch(
      `https://api-db.reiwarden.io.vn/api/collections/${SHOPS_COLLECTION_ID}/records/${id}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    )

    if (!response.ok) {
      throw new Error(`PB request failed [${response.status}]`)
    }

    const record = await response.json()
    return mapPBShop(record)
  } catch (error) {
    logSource('PB', `shop.get('${id}') failed`, error)
    throw error
  }
}

/**
 * Create shop in PocketBase
 */
export async function createPocketBaseShop(data: { name: string; image_url?: string; default_category_id?: string }) {
  logSource('PB', 'shop.create', { name: data.name })

  try {
    const payload = {
      name: data.name,
      image_url: data.image_url || '',
      default_category_id: data.default_category_id || '',
      is_archived: false,
    }

    const response = await fetch(
      `https://api-db.reiwarden.io.vn/api/collections/${SHOPS_COLLECTION_ID}/records`,
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
    return mapPBShop(record)
  } catch (error) {
    logSource('PB', 'shop.create failed', error)
    throw error
  }
}

/**
 * Update shop in PocketBase
 */
export async function updatePocketBaseShop(
  id: string,
  data: { name?: string; image_url?: string; default_category_id?: string; is_archived?: boolean }
) {
  logSource('PB', `shop.update('${id}')`, data)

  try {
    const payload: Record<string, any> = {}
    if (data.name !== undefined) payload.name = data.name
    if (data.image_url !== undefined) payload.image_url = data.image_url
    if (data.default_category_id !== undefined) payload.default_category_id = data.default_category_id
    if (data.is_archived !== undefined) payload.is_archived = data.is_archived

    const response = await fetch(
      `https://api-db.reiwarden.io.vn/api/collections/${SHOPS_COLLECTION_ID}/records/${id}`,
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
    return mapPBShop(record)
  } catch (error) {
    logSource('PB', `shop.update('${id}') failed`, error)
    throw error
  }
}
