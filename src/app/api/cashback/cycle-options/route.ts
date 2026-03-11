import { NextRequest, NextResponse } from 'next/server'
import { getPocketBaseAccountCycleOptions } from '@/services/pocketbase/account-details.service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get('accountId')
    if (!accountId) {
      return NextResponse.json({ options: [] })
    }

    const options = await getPocketBaseAccountCycleOptions(accountId, 48)
    const normalized = options.map((opt) => ({
      tag: opt.tag,
      label: opt.label,
      cycleType: opt.cycleType ?? null,
      statementDay: opt.statementDay ?? null,
      cycleId: opt.cycleId ?? null,
      stats: opt.stats
        ? {
            spent_amount: opt.stats.spent_amount,
            real_awarded: opt.stats.real_awarded,
            virtual_profit: opt.stats.virtual_profit,
          }
        : undefined,
    }))

    return NextResponse.json({ options: normalized })
  } catch (error) {
    console.error('[api/cashback/cycle-options] failed', error)
    return NextResponse.json({ options: [] })
  }
}
