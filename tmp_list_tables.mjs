import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function listTables() {
  const { data, error } = await supabase.rpc('get_tables'); // If they have an RPC
  if (error) {
     // Try direct query via from().select() on information_schema (doesn't work Usually)
     console.log("RPC get_tables failed. Trying direct query...");
     const { data: tabs, error: e2 } = await (supabase as any).from('information_schema.tables').select('table_name').eq('table_schema', 'public')
     console.log(tabs || e2)
  } else {
     console.log(data)
  }
}

listTables()
