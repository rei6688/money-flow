import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });

const PB_URL = 'https://api-db.reiwarden.io.vn';
const PB_EMAIL = process.env.POCKETBASE_DB_EMAIL;
const PB_PASSWORD = process.env.POCKETBASE_DB_PASSWORD;

async function sync() {
    console.log('Logging in to PocketBase...');
    const authRes = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
    });

    if (!authRes.ok) {
        throw new Error('Login failed: ' + await authRes.text());
    }

    const { token } = await authRes.json();
    const headers = { 'Content-Type': 'application/json', 'Authorization': token };

    console.log('Reading schema.json...');
    const schemaRaw = fs.readFileSync(path.resolve(__dirname, 'schema.json'), 'utf8');
    const sections = JSON.parse(schemaRaw);
    const historyColl = sections.find(c => c.name === 'transaction_history');

    if (!historyColl) {
        throw new Error('Transaction History collection not found in schema.json');
    }

    console.log('Checking if Transaction History collection exists...');
    const checkRes = await fetch(`${PB_URL}/api/collections/transaction_history`, { headers });
    
    // Transform fields to internal PB format
    const transformedFields = historyColl.fields.map(f => {
        const transformed = { ...f };
        // PB expect fields to NOT have an ID during creation if we want them auto-generated, but we have IDs in schema.json
        // PocketBase uses 'id' for fields.
        if (f.options && typeof f.options === 'object') {
            Object.assign(transformed, f.options);
        }
        return transformed;
    });

    const payload = {
        name: historyColl.name,
        type: 'base',
        fields: transformedFields,
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
    };

    if (checkRes.ok) {
        console.log('Updating Transaction History collection schema...');
        const updateRes = await fetch(`${PB_URL}/api/collections/transaction_history`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload)
        });
        if (updateRes.ok) {
            console.log('✅ Transaction History collection schema updated successfully!');
        } else {
            console.error('❌ Failed to update collection:', await updateRes.text());
        }
    } else {
        console.log('Creating Transaction History collection...');
        // Need to set the ID of the collection too
        payload.id = historyColl.id;
        const createRes = await fetch(`${PB_URL}/api/collections`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (createRes.ok) {
            console.log('✅ Transaction History collection created successfully!');
        } else {
            console.error('❌ Failed to create collection:', await createRes.text());
        }
    }
}

sync().catch(console.error);
