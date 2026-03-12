
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true });

const PB_URL = 'https://api-db.reiwarden.io.vn';
const PB_EMAIL = (process.env.POCKETBASE_DB_EMAIL || 'namnt05@gmail.com').trim();
const PB_PASSWORD = (process.env.POCKETBASE_DB_PASSWORD || '').trim();

async function getCollection() {
    const authRes = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD })
    });
    const { token } = await authRes.json();
    const headers = { 'Authorization': token };

    const res = await fetch(`${PB_URL}/api/collections/transactions`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}

getCollection().catch(console.error);
