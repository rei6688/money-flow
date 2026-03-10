#!/usr/bin/env node
/**
 * Phase 1 Test: Verify PocketBase Category & Shop Services
 * Tests API directly without needing to import from main codebase
 */

const CATEGORIES_URL = 'https://api-db.reiwarden.io.vn/api/collections/pvl_cat_001/records?perPage=500'
const SHOPS_URL = 'https://api-db.reiwarden.io.vn/api/collections/pvl_shop_001/records?perPage=500'

async function testCategoryService() {
  console.log('\n=== Testing Category Service ===\n')

  try {
    console.log('1️⃣  Fetching categories from PB...')
    const response = await fetch(CATEGORIES_URL)

    if (!response.ok) {
      throw new Error(`Failed [${response.status}]: ${await response.text()}`)
    }

    const data = await response.json()
    const records = data.items || []

    console.log(`✅ Success! Found ${records.length} categories`)
    console.log(`\n📋 Sample category:`)
    if (records.length > 0) {
      const sample = records[0]
      console.log(`   ID: ${sample.id}`)
      console.log(`   Name: ${sample.name}`)
      console.log(`   Icon: ${sample.icon || '(empty)'}`)
      console.log(`   Type: ${sample.type}`)
      console.log(`   Kind: ${sample.kind}`)
      console.log(`   Is Archived: ${sample.is_archived}`)
    }

    // Count by type
    const typeCount = records.reduce((acc: any, cat: any) => {
      acc[cat.type] = (acc[cat.type] || 0) + 1
      return acc
    }, {})

    console.log(`\n📊 Categories by type:`)
    Object.entries(typeCount).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`)
    })
  } catch (error) {
    console.error(`❌ Error:`, error)
  }
}

async function testShopService() {
  console.log('\n=== Testing Shop Service ===\n')

  try {
    console.log('1️⃣  Fetching shops from PB...')
    const response = await fetch(SHOPS_URL)

    if (!response.ok) {
      throw new Error(`Failed [${response.status}]: ${await response.text()}`)
    }

    const data = await response.json()
    const records = data.items || []

    console.log(`✅ Success! Found ${records.length} shops`)
    console.log(`\n📋 Sample shops:`)
    records.slice(0, 3).forEach((shop: any, idx: number) => {
      console.log(`   ${idx + 1}. ${shop.name}`)
      console.log(`      ID: ${shop.id}`)
      console.log(`      Image: ${shop.image_url ? 'Yes' : 'None'}`)
    })
  } catch (error) {
    console.error(`❌ Error:`, error)
  }
}

async function testSingleCategory() {
  console.log('\n=== Testing Single Category Fetch ===\n')

  try {
    console.log('1️⃣  Getting first category...')
    const response = await fetch(CATEGORIES_URL + '&perPage=1')

    if (!response.ok) {
      throw new Error(`Failed [${response.status}]`)
    }

    const data = await response.json()
    if (data.items && data.items.length > 0) {
      const id = data.items[0].id
      console.log(`   ID: ${id}`)

      console.log(`2️⃣  Fetching single category by ID...`)
      const singleResponse = await fetch(
        `https://api-db.reiwarden.io.vn/api/collections/pvl_cat_001/records/${id}`
      )

      if (!singleResponse.ok) {
        throw new Error(`Failed [${singleResponse.status}]`)
      }

      const single = await singleResponse.json()
      console.log(`✅ Single fetch success`)
      console.log(`   Name: ${single.name}`)
      console.log(`   Type: ${single.type}`)
    }
  } catch (error) {
    console.error(`❌ Error:`, error)
  }
}

// Run tests
async function main() {
  console.log('🧪 Phase 1 Test Suite: PocketBase Services')
  console.log('==========================================')

  await testCategoryService()
  await testShopService()
  await testSingleCategory()

  console.log('\n✅ All tests completed!')
  console.log('\nNext: Import these services and add fallback pattern to parent service files')
}

main()
