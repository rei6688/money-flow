import { NextResponse } from 'next/server'

import { getPendingRefunds } from '@/services/transaction.service'
import { pocketbaseGetById } from '@/services/pocketbase/server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveSupabaseAccountId(accountId?: string | null): Promise<string | undefined> {
  if (!accountId) return undefined
  if (UUID_REGEX.test(accountId)) return accountId

  try {
    const account = await pocketbaseGetById<Record<string, unknown>>('accounts', accountId)
    const slug = typeof account?.slug === 'string' ? account.slug : ''
    if (UUID_REGEX.test(slug)) return slug
  } catch {
    // Ignore PB lookup failures and return undefined so query stays safe.
  }

  return undefined
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('accountId')
    const supabaseAccountId = await resolveSupabaseAccountId(accountId)
    const items = await getPendingRefunds(supabaseAccountId)
    const total = items.reduce((sum, item) => sum + Math.abs(item.amount || 0), 0)
    return NextResponse.json({ total, items })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to load pending refunds' }, { status: 500 })
  }
}
