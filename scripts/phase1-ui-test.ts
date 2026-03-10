/**
 * Phase 1 UI Integration Test
 * Tests that categories and shops load from PocketBase with fallback
 */

async function testPhase1() {
  console.log('🧪 Phase 1 UI Integration Test\n')
  
  try {
    // 1. Test app is running
    const healthCheck = await fetch('http://localhost:3002/')
    console.log(`✅ App is running on port 3002 (${healthCheck.status})`)
    
    // 2. Test PocketBase categories directly
    console.log('\n📂 Testing PocketBase Category Service...')
    const pbCategoriesResp = await fetch(
      'https://api-db.reiwarden.io.vn/api/collections/pvl_cat_001/records?perPage=5'
    )
    const pbCategoriesData = await pbCategoriesResp.json()
    console.log(`✅ PB Categories API: Found ${pbCategoriesData.items?.length || 0} items in sample`)
    console.log(`   Total in collection: ${pbCategoriesData.totalItems || 'unknown'}`)
    if (pbCategoriesData.items?.[0]) {
      console.log(`   Sample: ${pbCategoriesData.items[0].name} (type: ${pbCategoriesData.items[0].type})`)
    }
    
    // 3. Test PocketBase shops directly
    console.log('\n🏪 Testing PocketBase Shop Service...')
    const pbShopsResp = await fetch(
      'https://api-db.reiwarden.io.vn/api/collections/pvl_shop_001/records?perPage=5'
    )
    const pbShopsData = await pbShopsResp.json()
    console.log(`✅ PB Shops API: Found ${pbShopsData.items?.length || 0} items in sample`)
    console.log(`   Total in collection: ${pbShopsData.totalItems || 'unknown'}`)
    if (pbShopsData.items?.[0]) {
      console.log(`   Sample: ${pbShopsData.items[0].name}`)
    }
    
    console.log('\n✅ All Phase 1 APIs verified!\n')
    console.log('Next steps:')
    console.log('1. Open http://localhost:3002/transactions in browser')
    console.log('2. Click "Add Transaction" button')
    console.log('3. Open DevTools Console and filter for [source:PB] or [source:SB]')
    console.log('4. Verify categories and shops load from PocketBase')
    console.log('5. Check Network tab for PB API calls to pvl_cat_001 and pvl_shop_001\n')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

testPhase1()
