import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function check() {
  const { data: insts, error } = await supabase
    .from('installments')
    .select('id, name, original_transaction_id')
  
  if (error) { console.error(error); return; }
  
  console.log('Installments count:', insts.length)
  for (const inst of insts) {
    if (inst.original_transaction_id) {
       const { count } = await supabase
         .from('transactions')
         .select('*', { count: 'exact', head: true })
         .eq('id', inst.original_transaction_id)
       
       if (count === 0) {
         console.warn(`[WARN] Installment ${inst.name} (${inst.id}) references missing txn: ${inst.original_transaction_id}`)
       }
    }
  }
}

check()
