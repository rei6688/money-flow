import { NextResponse } from 'next/server'
import { getCategoriesWithSource } from '@/services/category.service'
import { getShopsWithSource } from '@/services/shop.service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [categories, shops] = await Promise.all([
      getCategoriesWithSource(),
      getShopsWithSource(),
    ])

    return NextResponse.json({
      ok: true,
      categories: {
        source: categories.source,
        count: categories.data.length,
      },
      shops: {
        source: shops.source,
        count: shops.data.length,
      },
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
