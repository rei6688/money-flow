'use client'

import { useState, useEffect, useTransition } from 'react'
import { BatchList } from '@/components/batch/batch-list-simple'
import { BatchDetail } from '@/components/batch/batch-detail'
import { BatchSettingsSlide } from '@/components/batch/batch-settings-slide'
import { BatchMasterChecklist } from '@/components/batch/BatchMasterChecklist'
import { BatchMasterSlide } from '@/components/batch/BatchMasterSlide'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { Settings, Sparkles, Database, Loader2, RefreshCw, ExternalLink } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { bulkInitializeFromMasterAction } from '@/actions/batch-speed.actions'
import { Combobox } from '@/components/ui/combobox'

interface BatchPageClientV2Props {
    batches: any[]
    accounts: any[]
    categories?: any[]
    bankMappings: any[]
    webhookLinks: any[]
    bankType: string
    activeBatch?: any
    activeInstallmentAccounts?: string[]
    cutoffDay?: number
    globalSheetUrl?: string | null
    globalSheetName?: string | null
    phases?: any[]
    selectedPhaseId?: string | null
}

export function BatchPageClientV2({
    batches,
    accounts,
    categories = [],
    bankMappings,
    webhookLinks,
    bankType,
    activeBatch,
    activeInstallmentAccounts,
    cutoffDay = 15,
    globalSheetUrl,
    globalSheetName,
    phases = [],
    selectedPhaseId = null,
}: BatchPageClientV2Props) {
    const router = useRouter()
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [templateOpen, setTemplateOpen] = useState(false)

    const [isPending, startTransition] = useTransition()
    const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')
    const [isSyncingMaster, setIsSyncingMaster] = useState(false)
    const [loadingMonth, setLoadingMonth] = useState<string | null>(null)
    const [checklistRefreshNonce, setChecklistRefreshNonce] = useState(0)

    const searchParams = useSearchParams()
    const selectedMonthParam = searchParams.get('month')
    const selectedPeriodParam = searchParams.get('period') || 'before'
    const selectedPhaseParam = searchParams.get('phase') || selectedPhaseId || null

    const effectivePhases = phases.length > 0 ? phases : [
        { id: 'before', label: 'Phase 1', period_type: 'before', cutoff_day: cutoffDay, sort_order: 0, is_active: true },
        { id: 'after', label: 'Phase 2', period_type: 'after', cutoff_day: cutoffDay, sort_order: 1, is_active: true },
    ]
    const currentPhase =
        effectivePhases.find((phase: any) => phase.id === selectedPhaseParam)
        || effectivePhases.find((phase: any) => phase.period_type === selectedPeriodParam)
        || effectivePhases[0]
    const currentPhaseId = currentPhase?.id || null

    // Current active month is derived from activeBatch or search param
    const currentMonth = activeBatch ? activeBatch.month_year : selectedMonthParam || null
    const currentPeriod = currentPhase?.period_type || (activeBatch ? (activeBatch.period || 'before') : selectedPeriodParam)

    const [optimisticMonth, setOptimisticMonth] = useState<string | null>(currentMonth)
    const [selectedYear, setSelectedYear] = useState(() =>
        currentMonth ? currentMonth.split('-')[0] : String(new Date().getFullYear())
    )

    useEffect(() => {
        setOptimisticMonth(currentMonth)
        if (currentMonth) setSelectedYear(currentMonth.split('-')[0])
    }, [currentMonth])

    useEffect(() => {
        if (!isPending) {
            setLoadingMonth(null)
            setOptimisticMonth(currentMonth)
        }
    }, [isPending, currentMonth])

    const visibleBatches = batches.filter(b => b.is_archived)

    const getPhaseRangeLabel = (phase: any) => {
        const cutoff = Number(phase?.cutoff_day || cutoffDay)
        if ((phase?.period_type || 'before') === 'before') {
            return `Day <= ${cutoff}`
        }
        return `Day > ${cutoff}`
    }

    async function handleStartBatch() {
        if (!selectedMonthParam) {
            toast.error('Please select a month first')
            return
        }

        // Implicitly create batch for the selected month
        const date = new Date(selectedMonthParam + '-01')
        const monthBaseName = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        const monthName = `${monthBaseName} (${currentPhase?.label || (currentPeriod === 'before' ? `Before ${cutoffDay}` : `After ${cutoffDay}`)})`

        try {
            const { createFreshBatchAction, setBatchPeriodAction, setBatchPhaseAction } = await import('@/actions/batch-create.actions')
            const result = await createFreshBatchAction({
                monthYear: selectedMonthParam,
                monthName,
                bankType: bankType as 'MBB' | 'VIB'
            })

            if (result.success) {
                await setBatchPeriodAction(result.data.id, currentPeriod as 'before' | 'after')
                if (currentPhaseId) {
                    await setBatchPhaseAction(result.data.id, currentPhaseId)
                }

                toast.success(`Started batch for ${monthName}`)
                router.refresh()
            } else {
                toast.error(result.error || 'Failed to start batch')
            }
        } catch (error) {
            console.error(error)
            toast.error('Failed to create batch')
        }
    }

    function closeTransientPortals() {
        const activeElement = document.activeElement as HTMLElement | null
        activeElement?.blur()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }

    function handleMonthSelect(month: string) {
        if (month === currentMonth) return;
        setLoadingMonth(month)
        setOptimisticMonth(month)
        closeTransientPortals()
        startTransition(() => {
            const queryPhase = currentPhaseId ? `&phase=${currentPhaseId}` : ''
            router.push(`/batch/${bankType.toLowerCase()}?month=${month}&period=${currentPeriod}${queryPhase}`)
        })
    }

    function handlePeriodSelect(period: string, phaseId?: string | null) {
        if (currentMonth) {
            closeTransientPortals()
            startTransition(() => {
                const queryPhase = phaseId ? `&phase=${phaseId}` : ''
                router.push(`/batch/${bankType.toLowerCase()}?month=${currentMonth}&period=${period}${queryPhase}`)
            })
        }
    }

    async function handleSyncCurrentPhase() {
        if (!currentMonth) {
            toast.error('Select a month first')
            return
        }
        setIsSyncingMaster(true)
        try {
            const result = await bulkInitializeFromMasterAction({
                monthYear: currentMonth,
                period: currentPeriod as 'before' | 'after',
                bankType: bankType as 'MBB' | 'VIB',
                phaseId: currentPhaseId || undefined,
            })
            if (result.success) {
                toast.success(`Synced ${result.initializedCount ?? 0} items`)
                setChecklistRefreshNonce((prev) => prev + 1)
                router.refresh()
            } else {
                toast.error('Sync failed')
            }
        } catch (e: any) {
            toast.error(e.message || 'Sync failed')
        } finally {
            setIsSyncingMaster(false)
        }
    }

    const calendarYear = new Date().getFullYear()
    const calendarMonth = new Date().getMonth() + 1
    const yearSelectorItems = [calendarYear, calendarYear - 1, calendarYear - 2].map(y => ({
        value: String(y), label: String(y)
    }))
    const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthSelectorItems = MONTH_NAMES_FULL.map((name, i) => {
        const monthNum = i + 1
        const mStr = `${selectedYear}-${String(monthNum).padStart(2, '0')}`
        const monthStats = batches.filter(b => b.month_year === mStr)
        const mTotal = monthStats.reduce((acc, b) => acc + (b.total_items || 0), 0)
        const mConfirmed = monthStats.reduce((acc, b) => acc + (b.confirmed_items || 0), 0)
        const isCurrent = String(calendarYear) === selectedYear && calendarMonth === monthNum
        const isActive = optimisticMonth === mStr
        return {
            value: mStr,
            label: name,
            searchValue: `${monthNum} ${name} ${MONTH_NAMES_SHORT[i]}`,
            description: mTotal > 0 ? `${mConfirmed}/${mTotal} confirmed` : undefined,
            icon: (
                <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0",
                    isActive ? "bg-slate-900 text-white" :
                    isCurrent ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
                )}>
                    {loadingMonth === mStr ? <Loader2 className="h-3 w-3 animate-spin" /> : monthNum}
                </div>
            )
        }
    })
    const phaseSelectorItems = effectivePhases.map((phase: any, index: number) => ({
        value: phase.id,
        label: phase.label || `Phase ${index + 1}`,
        description:
            phase.period_type === 'before'
                ? `Day 1 - ${phase.cutoff_day}`
                : `Day ${Number(phase.cutoff_day || cutoffDay) + 1} - End`,
    }))

    return (
        <div className="h-full flex flex-col bg-slate-50/50">
            {/* Premium Header - Non-sticky as requested */}
            <div className="bg-white border-b border-slate-200 z-50 shadow-sm">
                <div className="w-full px-6 py-3">
                    <div className="flex items-center justify-between gap-4">
                        {/* LEFT: LOGO, BANK TYPE & PROGRESS */}
                        <div className="flex items-center gap-6 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "p-2 rounded-xl shadow-sm border",
                                    bankType === 'MBB' ? "bg-blue-50 border-blue-100 text-blue-600" : "bg-purple-50 border-purple-100 text-purple-600"
                                )}>
                                    <Database className="h-5 w-5" />
                                </div>
                                <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none uppercase">
                                    {bankType} Batch
                                </h1>
                            </div>

                            <div className="h-8 w-px bg-slate-100 mx-2 hidden md:block" />

                            <div className="bg-indigo-50/50 px-3 py-1.5 rounded-xl border border-indigo-100/50 flex items-center gap-3">
                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest leading-none">Total Progress</span>
                                <span className="text-sm font-black text-indigo-700 leading-none">
                                    {batches.reduce((acc, b) => acc + (b.confirmed_items || 0), 0)}/{batches.reduce((acc, b) => acc + (b.total_items || 0), 0)}
                                </span>
                            </div>
                        </div>

                        {/* RIGHT: MONTH TABS & ACTIONS */}
                        <div className="flex items-center gap-4 flex-1 justify-end min-w-0">
                            <div className="flex items-center gap-2 py-1 pr-4 border-r border-slate-100">
                                <Button
                                    onClick={handleSyncCurrentPhase}
                                    disabled={isSyncingMaster || isPending}
                                    variant="outline"
                                    className="h-10 px-3 rounded-xl border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 font-black text-[9px] uppercase tracking-widest gap-2 shrink-0"
                                >
                                    {isSyncingMaster ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-slate-400" />}
                                    <span>Sync Master</span>
                                </Button>
                                <div className="w-[130px] shrink-0">
                                    <Combobox
                                        value={selectedYear}
                                        onValueChange={(v) => v && setSelectedYear(v)}
                                        items={yearSelectorItems}
                                        placeholder="Year"
                                        inputPlaceholder="Year..."
                                        triggerClassName="h-10 border-slate-200 rounded-xl text-xs font-black"
                                    />
                                </div>
                                <div className="w-[210px] shrink-0">
                                    <Combobox
                                        value={optimisticMonth || undefined}
                                        onValueChange={(v) => v && handleMonthSelect(v)}
                                        items={monthSelectorItems}
                                        placeholder="Select month"
                                        inputPlaceholder="Search month..."
                                        triggerClassName="h-10 border-slate-200 rounded-xl text-xs font-black"
                                    />
                                </div>
                                <div className="w-[220px] shrink-0">
                                    <Combobox
                                        value={currentPhaseId || undefined}
                                        onValueChange={(phaseId) => {
                                            const nextPhase = effectivePhases.find((phase: any) => phase.id === phaseId)
                                            if (!nextPhase) return
                                            handlePeriodSelect(nextPhase.period_type || 'before', nextPhase.id)
                                        }}
                                        items={phaseSelectorItems}
                                        placeholder="Select phase"
                                        inputPlaceholder="Search phase..."
                                        triggerClassName="h-10 border-slate-200 rounded-xl text-xs font-black"
                                    />
                                </div>
                                <div className="h-10 px-3 rounded-xl border border-indigo-100 bg-indigo-50/60 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-indigo-700 shrink-0">
                                    <span>Range</span>
                                    <span className="text-indigo-500">{getPhaseRangeLabel(currentPhase)}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {globalSheetUrl && (
                                    <a
                                        href={globalSheetUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="h-10 px-3 flex items-center gap-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-all font-black text-[9px] uppercase tracking-widest shadow-sm shrink-0"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        <span>Sheet</span>
                                    </a>
                                )}
                                <Button
                                    onClick={() => setTemplateOpen(true)}
                                    variant="outline"
                                    className="h-10 px-3 rounded-xl border-slate-200 hover:bg-slate-50 font-black text-[9px] uppercase tracking-widest gap-2 text-indigo-600 bg-indigo-50/10 border-indigo-100 shrink-0"
                                >
                                    <Sparkles className="h-4 w-4" />
                                    <span>Masters</span>
                                </Button>
                                <Button
                                    onClick={() => setSettingsOpen(true)}
                                    variant="outline"
                                    className="h-10 px-3 rounded-xl border-slate-200 hover:bg-slate-50 font-black text-[9px] uppercase tracking-widest gap-2 shrink-0"
                                >
                                    <Settings className="h-4 w-4 text-slate-400" />
                                    <span>Config</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto bg-slate-50">
                {activeTab === 'active' ? (
                    <div className="mx-auto px-6 py-6 max-w-[1600px] w-full">
                        <div className="relative space-y-6">
                            {isPending && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-50/80 py-32 text-slate-400">
                                    <Loader2 className="h-8 w-8 animate-spin mb-4" />
                                    <p className="font-medium text-sm">Loading data for {optimisticMonth}...</p>
                                </div>
                            )}
                            <div className={isPending ? 'pointer-events-none opacity-40' : undefined}>
                                <BatchMasterChecklist
                                    bankType={bankType as 'MBB' | 'VIB'}
                                    accounts={accounts}
                                    bankMappings={bankMappings}
                                    monthYear={currentMonth || ''}
                                    initialPhaseId={currentPhaseId}
                                    refreshNonce={checklistRefreshNonce}
                                    onPhaseChange={(phaseId) => {
                                        const nextPhase = effectivePhases.find((phase: any) => phase.id === phaseId)
                                        if (!nextPhase || !currentMonth) return
                                        handlePeriodSelect(nextPhase.period_type || 'before', phaseId)
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    // Archive View - List
                    <div className="container mx-auto px-4 py-6">
                        <div className="bg-white rounded-lg border border-slate-200 p-4">
                            <h2 className="text-lg font-semibold text-slate-900 mb-4">Archived Batches</h2>
                            <BatchList
                                batches={visibleBatches}
                                mode="done"
                                accounts={accounts}
                                webhookLinks={webhookLinks}
                            />
                        </div>
                    </div>
                )}
            </div>

            <BatchSettingsSlide
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
            />

            <BatchMasterSlide
                open={templateOpen}
                onOpenChange={setTemplateOpen}
                bankType={bankType as any}
                accounts={accounts}
                categories={categories}
                bankMappings={bankMappings}
            />
        </div >
    )
}
