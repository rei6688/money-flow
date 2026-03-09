#!/usr/bin/env node
/**
 * Phase 1 Probe: Test PocketBase Auth & Pull Collections Schema
 * 
 * Usage:
 * POCKETBASE_DB_EMAIL="..." POCKETBASE_DB_PASSWORD="..." npx tsx scripts/phase1-probe-collections.ts
 */

import * as https from 'https'

const POCKETBASE_URL = 'https://api-db.reiwarden.io.vn'
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD

if (!PB_EMAIL || !PB_PASSWORD) {
  console.error('❌ Missing PB credentials in .env')
  console.error('   Set: POCKETBASE_DB_EMAIL, POCKETBASE_DB_PASSWORD')
  process.exit(1)
}

console.log(`🔐 Authenticating as: ${PB_EMAIL}`)

/**
 * Authenticate with PocketBase
 */
async function authenticateWithPB(): Promise<string> {
  return new Promise((resolve, reject) => {
    const authPayload = JSON.stringify({
      identity: PB_EMAIL,
      password: PB_PASSWORD,
    })

    const options = {
      hostname: 'api-db.reiwarden.io.vn',
      port: 443,
      path: '/api/admins/auth-with-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': authPayload.length,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          try {
            const result = JSON.parse(data)
            if (result.token) {
              console.log(`✅ Auth success! Token: ${result.token.substring(0, 20)}...`)
              resolve(result.token)
            } else {
              reject(new Error('No token in response'))
            }
          } catch (err) {
            reject(new Error(`Failed to parse auth response: ${data}`))
          }
        } else {
          console.error(`❌ Auth failed (${res.statusCode}):`, data)
          reject(new Error(`Auth failed: ${res.statusCode}`))
        }
      })
    })

    req.on('error', reject)
    req.write(authPayload)
    req.end()
  })
}

/**
 * Fetch collections list
 */
async function fetchCollections(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api-db.reiwarden.io.vn',
      port: 443,
      path: '/api/collections?perPage=500',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data)
            resolve(result)
          } catch (err) {
            reject(new Error(`Failed to parse collections: ${data}`))
          }
        } else {
          console.error(`❌ Fetch failed (${res.statusCode}):`, data)
          reject(new Error(`Fetch failed: ${res.statusCode}`))
        }
      })
    })

    req.on('error', reject)
    req.end()
  })
}

/**
 * Main flow
 */
async function main() {
  try {
    // Step 1: Authenticate
    const token = await authenticateWithPB()

    // Step 2: Fetch collections
    console.log('\n📋 Fetching collections...')
    const collectionsData = await fetchCollections(token)

    if (collectionsData.items && collectionsData.items.length > 0) {
      console.log(`\n✅ Found ${collectionsData.items.length} collections:\n`)

      // Filter out system collections
      const userCollections = collectionsData.items.filter((c: any) => !c.system)

      for (const collection of userCollections) {
        console.log(`\n📦 ${collection.name}`)
        console.log(`   ID: ${collection.id}`)
        console.log(`   Type: ${collection.type}`)
        console.log(`   Fields: ${collection.schema?.length || 0}`)

        if (collection.schema) {
          console.log('   Schema:')
          for (const field of collection.schema) {
            const req = field.required ? ' [required]' : ''
            const options = field.options ? ` ${JSON.stringify(field.options).substring(0, 60)}...` : ''
            console.log(`     - ${field.name}: ${field.type}${req}${options}`)
          }
        }
      }

      // Generate markdown schema doc
      console.log('\n\n📝 Generating schema documentation...')
      const schemaMarkdown = generateSchemaMarkdown(userCollections)
      console.log('\n' + schemaMarkdown)

      // Save to file
      const fs = require('fs')
      const path = require('path')
      const outputPath = path.join(process.cwd(), 'docs/collections/PB_COLLECTIONS_SCHEMA.md')

      // Ensure directory exists
      const dir = path.dirname(outputPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(outputPath, schemaMarkdown)
      console.log(`\n✅ Schema saved to: ${outputPath}`)
    } else {
      console.error('❌ No collections found')
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

/**
 * Generate markdown schema documentation
 */
function generateSchemaMarkdown(collections: any[]): string {
  let md = `# PocketBase Collections Schema
Generated: ${new Date().toISOString()}
Auth: Admin API

## Collections Overview

\`\`\`
Count: ${collections.length}
\`\`\`

## Detailed Schemas

`

  for (const collection of collections) {
    md += `\n### \`${collection.name}\`\n`
    md += `**ID**: \`${collection.id}\`  \n`
    md += `**Type**: ${collection.type}  \n`

    if (collection.schema && collection.schema.length > 0) {
      md += `\n| Field | Type | Required | Options |\n`
      md += `|-------|------|----------|----------|\n`

      for (const field of collection.schema) {
        const req = field.required ? '✓' : ''
        const opts = field.options
          ? JSON.stringify(field.options).substring(0, 80)
          : ''
        md += `| \`${field.name}\` | \`${field.type}\` | ${req} | ${opts} |\n`
      }
    }

    // Add RLS rules if present
    if (
      collection.listRule ||
      collection.viewRule ||
      collection.createRule ||
      collection.updateRule ||
      collection.deleteRule
    ) {
      md += `\n**Access Rules:**\n`
      if (collection.listRule) md += `- **List**: \`${collection.listRule}\`\n`
      if (collection.viewRule) md += `- **View**: \`${collection.viewRule}\`\n`
      if (collection.createRule) md += `- **Create**: \`${collection.createRule}\`\n`
      if (collection.updateRule) md += `- **Update**: \`${collection.updateRule}\`\n`
      if (collection.deleteRule) md += `- **Delete**: \`${collection.deleteRule}\`\n`
    }
  }

  md += `

## Usage in Code

Reference this document when implementing service layer:
- Map Supabase field names → PocketBase field names
- Identify FK relationships (expansion fields)
- Note enum values and constraints
- Document any JSON columns (metadata, config, etc.)

Example:
\`\`\`typescript
// Supabase: SELECT * FROM categories
// PocketBase: expand=[] (no expansion needed)

// Supabase: SELECT * FROM categories WHERE type = 'expense'
// PocketBase: filter='type="expense"' (different syntax)
\`\`\`
`

  return md
}

// Run
main()
