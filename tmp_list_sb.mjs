import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function list() {
  const tables = ['people', 'accounts', 'transactions', 'installments', 'subscriptions', 'batches', 'batch_items']
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
    if (error) {
       console.log(`${t}: ERROR ${error.message}`)
    } else {
       console.log(`${t}: ${count} rows`)
    }
  }
}

list()
