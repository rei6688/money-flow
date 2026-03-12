
import { pocketbaseList } from './src/services/pocketbase/server.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  try {
    await pocketbaseList('cashback_cycles', { perPage: 1 });
    console.log('CASHBACK_CYCLES_EXISTS');
  } catch (err) {
    console.log('CASHBACK_CYCLES_MISSING');
  }
}
check();
