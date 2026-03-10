#!/usr/bin/env node
/**
 * Phase 1 Probe: PocketBase Collections via Public API
 * Try different endpoints and auth methods
 */

import * as https from 'https'
import * as http from 'http'

const PB_URL = 'https://api-db.reiwarden.io.vn'

// Try fetching collections with different approaches
async function tryFetch(
  path: string,
  headers?: Record<string, string>
): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const url = new URL(PB_URL + path)
    const protocol = url.protocol === 'https:' ? https : http

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: headers || {},
    }

    const req = protocol.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          resolve({ status: res.statusCode || 0, data: parsed })
        } catch {
          resolve({ status: res.statusCode || 0, data: { raw: data } })
        }
      })
    })

    req.on('error', (err) => {
      console.error(`  Request error: ${err.message}`)
      resolve({ status: 0, data: { error: err.message } })
    })

    req.end()
  })
}

async function main() {
  console.log('🔍 Testing PocketBase API endpoints...\n')

  // Try 1: Public collections endpoint (no auth)
  console.log('1️⃣  Trying: GET /api/collections (public)')
  let result = await tryFetch('/api/collections')
  if (result.status < 400) {
    console.log(`   ✅ Status ${result.status} - Success!`)
    if (result.data.items) {
      console.log(`   📦 Found ${result.data.items.length} collections`)
      console.log(`   Collections: ${result.data.items.map((c: any) => c.name).join(', ')}`)
    }
  } else {
    console.log(`   ❌ Status ${result.status}`)
  }

  // Try 2: With different auth headers
  console.log('\n2️⃣  Trying: GET /api/collections with bearer token attempt')
  result = await tryFetch('/api/collections?perPage=500', {
    'User-Agent': 'Money-Flow-Migration',
  })
  if (result.status < 400) {
    console.log(`   ✅ Status ${result.status}`)
  } else {
    console.log(`   ❌ Status ${result.status}`)
  }

  // Try 3: Records endpoint for specific collections
  console.log('\n3️⃣  Trying: GET /api/collections/categories/records (specific collection)')
  result = await tryFetch('/api/collections/categories/records?perPage=10')
  if (result.status === 200 || result.status === 204) {
    console.log(`   ✅ Status ${result.status}`)
    if (result.data.items) {
      console.log(`   📋 Found ${result.data.items.length} records`)
    }
  } else {
    console.log(`   ❌ Status ${result.status}`)
  }

  console.log('\n')
  console.log('PocketBase Admin UI URL (for manual checking):')
  console.log('  https://api-db.reiwarden.io.vn/_/')
  console.log('\nCollections location in admin panel:')
  console.log('  Settings > Collections > [collection-name]')
}

main()
