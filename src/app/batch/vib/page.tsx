export const dynamic = 'force-dynamic'

import { getPocketBaseAccounts } from '@/services/pocketbase/account-details.service'
import { getBankMappings } from '@/services/bank.service'
import { getSheetWebhookLinks } from '@/services/webhook-link.service'
import { getCategories } from '@/services/category.service'
import { BatchPageClientV2 } from '@/components/batch/batch-page-client-v2'
import { pocketbaseList } from '@/services/pocketbase/server'

import type { Metadata } from 'next'
import { Suspense } from 'react'

export async function generateMetadata(): Promise<Metadata> {
    const accounts = await getPocketBaseAccounts()
    const matched = accounts.find((a: any) => a.name.toLowerCase().includes('vib'))
    return {
        title: 'VIB Batch',
        icons: matched?.image_url ? { icon: matched.image_url } : undefined
    }
}

/**
 * VIB Batch page
 */
export default async function VIBBatchPage(props: {
    searchParams: Promise<{ month?: string, period?: string, phase?: string }>
}) {
    const searchParams = await props.searchParams
    const month = searchParams.month
    const bankType = 'VIB'

    const { getBatchesByType, getBatchById, getBatchSettings } = await import('@/services/batch.service')
    const batches = await getBatchesByType(bankType)
    const settings = await getBatchSettings(bankType)
    const cutoffDay = settings?.cutoff_day || 15

    const phaseResult = await pocketbaseList<any>('batch_phases', {
        filter: `bank_type = "${bankType}" && is_active = true`,
        sort: 'sort_order',
        perPage: 100,
    })
    const phases = phaseResult.items || []

    const selectedPhaseId = searchParams.phase || phases[0]?.id || null
    const selectedPhase = phases.find((phase: any) => phase.id === selectedPhaseId) || null
    const period = searchParams.period || selectedPhase?.period_type || 'before'

    let activeBatch = null
    const visibleBatches = batches.filter((b: any) => !b.is_archived)

    let targetBatchId = null
    if (month) {
        // Try to find batch for the selected month AND period
        const found = batches.find((b: any) =>
            b.month_year === month
            && (
                (selectedPhaseId && b.phase_id === selectedPhaseId)
                || b.period === period
                || (!b.period && period === 'before')
            ),
        )
        if (found) {
            targetBatchId = found.id
        }
    } else if (visibleBatches.length > 0) {
        const sorted = [...visibleBatches].sort((a: any, b: any) => {
            const tagA = a.month_year || ''
            const tagB = b.month_year || ''
            return tagB.localeCompare(tagA)
        })
        targetBatchId = sorted[0].id
    }

    if (targetBatchId) {
        activeBatch = await getBatchById(targetBatchId)
    }

    const accounts = await getPocketBaseAccounts()
    const categories = await getCategories()
    const bankMappings = await getBankMappings(bankType)
    const webhookLinks = await getSheetWebhookLinks()
    const { getAccountsWithActiveInstallments } = await import('@/services/installment.service')
    const activeInstallmentAccounts = await getAccountsWithActiveInstallments()

    return (
        <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Loading VIB Batch...</div>}>
            <BatchPageClientV2
                batches={batches}
                accounts={accounts}
                categories={categories}
                bankMappings={bankMappings}
                webhookLinks={webhookLinks}
                bankType={bankType}
                activeBatch={activeBatch}
                activeInstallmentAccounts={activeInstallmentAccounts}
                cutoffDay={cutoffDay}
                globalSheetUrl={settings?.display_sheet_url}
                globalSheetName={settings?.display_sheet_name}
                phases={phases}
                selectedPhaseId={selectedPhaseId}
            />
        </Suspense>
    )
}
