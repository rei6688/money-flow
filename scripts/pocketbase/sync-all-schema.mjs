
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });

const PB_URL = 'https://api-db.reiwarden.io.vn';
const PB_EMAIL = (process.env.POCKETBASE_DB_EMAIL || 'namnt05@gmail.com').trim();
const PB_PASSWORD = (process.env.POCKETBASE_DB_PASSWORD || '').trim();

async function syncAllSchema() {
    console.log('🚀 Starting Full Schema Sync to PocketBase...');

    // 1. Auth
    const authRes = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD })
    });

    if (!authRes.ok) {
        throw new Error(`Auth failed: ${await authRes.text()}`);
    }
    const { token } = await authRes.json();
    const headers = { 'Authorization': token, 'Content-Type': 'application/json' };

    // 2. Load schema.json
    const schemaPath = path.resolve(__dirname, 'schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

    // 3. Update individually
    for (const collection of schema) {
        console.log(`- Syncing collection: ${collection.name} (${collection.id})`);
        
        // Try to update existing first
        const updateRes = await fetch(`${PB_URL}/api/collections/${collection.id || collection.name}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(collection)
        });

        if (updateRes.status === 404) {
            // Create if missing
            console.log(`  * Creating new collection: ${collection.name}`);
            const createRes = await fetch(`${PB_URL}/api/collections`, {
                method: 'POST',
                headers,
                body: JSON.stringify(collection)
            });
            if (!createRes.ok) {
                console.error(`  ❌ Failed to create ${collection.name}:`, await createRes.text());
            } else {
                console.log(`  ✅ Created ${collection.name}`);
            }
        } else if (!updateRes.ok) {
            // Handle error (sometimes PATCH needs valid transition)
            const errText = await updateRes.text();
             if (errText.includes('Must be unique')) {
                console.log(`  ℹ️ Collection ${collection.name} already matches or has conflict, skipping update.`);
             } else {
                console.error(`  ❌ Failed to update ${collection.name}:`, errText);
             }
        } else {
            console.log(`  ✅ Updated ${collection.name}`);
        }
    }

    console.log('🎉 Full Schema Sync completed!');
}

syncAllSchema().catch(console.error);
