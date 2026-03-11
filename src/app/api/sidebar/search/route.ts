import { NextResponse } from 'next/server'
import {
  getPocketBaseAccounts,
} from '@/services/pocketbase/account-details.service'
import { getPocketBasePeople } from '@/services/pocketbase/people.service'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()

    const [accounts, people, shopsRes, categoriesRes] = await Promise.all([
      getPocketBaseAccounts(),
      getPocketBasePeople(),
      supabase.from('shops').select('id,name,image_url').order('name', { ascending: true }),
      supabase.from('categories').select('id,name,image_url').order('name', { ascending: true }),
    ])

    const shops = ((shopsRes.data || []) as unknown) as Array<{ id: string; name: string; image_url?: string | null }>
    const categories = ((categoriesRes.data || []) as unknown) as Array<{ id: string; name: string; image_url?: string | null }>

    return NextResponse.json({
      accounts: accounts.map((item) => ({ id: item.id, name: item.name, image_url: item.image_url ?? null })),
      people: people.map((item) => ({
        id: item.id,
        route_id: item.pocketbase_id || item.id,
        name: item.name,
        image_url: item.image_url ?? null,
      })),
      shops: shops.map((item) => ({ id: item.id, name: item.name, image_url: item.image_url ?? null })),
      categories: categories.map((item) => ({ id: item.id, name: item.name, image_url: item.image_url ?? null })),
    })
  } catch (error) {
    console.error('[api/sidebar/search] failed', error)
    return NextResponse.json(
      { accounts: [], people: [], shops: [], categories: [] },
      { status: 200 }
    )
  }
}
