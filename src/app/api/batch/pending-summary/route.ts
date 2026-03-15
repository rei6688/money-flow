import { NextResponse } from 'next/server'
import { getPendingBatchItemsSummary } from '@/services/batch.service'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const summary = await getPendingBatchItemsSummary()
        return NextResponse.json(summary)
    } catch (error: any) {
        console.error('Error fetching pending summary:', error)
        return NextResponse.json({ error: error.message || 'Failed to fetch pending summary' }, { status: 500 })
    }
}
