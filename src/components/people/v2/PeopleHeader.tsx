import { ChevronLeft, ChevronDown, History, Split, Edit, Calendar, TrendingUp, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Person } from '@/types/moneyflow.types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatsPopover } from './StatsPopover'
import { CashbackStatusDisplay } from '@/components/moneyflow/cashback-status-display'
import { formatCycleTag } from '@/lib/cycle-utils'
import { isYYYYMM } from '@/lib/month-tag'

interface PeopleHeaderProps {
    person: Person
    balanceLabel: string
    activeCycle?: {
        tag: string
        remains: number
        stats: {
            lend: number
            repay: number
            originalLend: number
            cashback: number
            paidRollover: number
            receiveRollover: number
        }
    }
    stats: {
        originalLend: number
        cashback: number
        netLend: number
        repay: number
        remains: number
        paidRollover: number
        receiveRollover: number
    }
    selectedYear: string | null
    availableYears: string[]
    onYearChange: (year: string | null) => void
    activeTab: string
    onTabChange: (tab: 'timeline' | 'history' | 'split-bill') => void
    onEdit?: () => void
    cashbackStatus?: {
        earned: number
        cap?: number | null
        currentSpend: number
        minSpend?: number | null
        needToSpend: number
        remaining?: number | null
    } | null
    isSyncing?: boolean
    syncingText?: string | null
}

const numberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
})

export function PeopleHeader({
    person,
    balanceLabel,
    activeCycle,
    stats,
    selectedYear,
    availableYears,
    onYearChange,
    activeTab,
    onTabChange,
    onEdit,
    cashbackStatus,
    isSyncing = false,
    syncingText,
}: PeopleHeaderProps) {
    const formatCycleLabel = (value: string) => (isYYYYMM(value) ? formatCycleTag(value) : value)
    const isNearZero = (value: number) => Math.abs(value) < 100
    const isSpecificCycleView = Boolean(activeCycle && selectedYear !== null && !activeCycle.tag.startsWith('All'))
    const displayedBalanceRaw = isSpecificCycleView ? (activeCycle?.remains ?? 0) : stats.remains
    const displayedBalance = isNearZero(displayedBalanceRaw) ? 0 : displayedBalanceRaw
    const isSettled = Math.abs(stats.remains) < 100
    const totalProgress = Math.max(
        Math.abs(stats.netLend),
        Math.abs(stats.repay) + Math.abs(stats.remains),
        1
    )
    const repayPercent = Math.min(100, Math.round((Math.abs(stats.repay) / totalProgress) * 100))
    const remainsPercent = Math.min(100, Math.round((Math.abs(stats.remains) / totalProgress) * 100))

    // Current Cycle Summary calculations
    const currentCycleNetLend = activeCycle ? activeCycle.stats.originalLend - activeCycle.stats.cashback : 0
    const currentCycleDisplayValueRaw = activeCycle ? activeCycle.remains : 0
    const currentCycleDisplayValue = isNearZero(currentCycleDisplayValueRaw) ? 0 : currentCycleDisplayValueRaw
    const currentCycleProgress = activeCycle ? Math.max(
        Math.abs(activeCycle.stats.repay) + Math.abs(activeCycle.remains),
        1
    ) : 1
    const currentCycleRepayPercent = activeCycle ? Math.min(100, Math.round((Math.abs(activeCycle.stats.repay) / currentCycleProgress) * 100)) : 0
    const currentCycleRemainsPercent = activeCycle ? Math.min(100, Math.round((Math.abs(activeCycle.remains) / currentCycleProgress) * 100)) : 0
    const isCycleSettled = activeCycle ? Math.abs(activeCycle.remains) < 100 : false

    // Format percentage for display inside bar
    const formattedRepayPercent = repayPercent > 0 ? `${repayPercent}%` : ''
    const formattedRemainsPercent = remainsPercent > 0 ? `${remainsPercent}%` : ''

    return (
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col gap-4 sticky top-0 z-60 shadow-sm relative">
            {isSyncing && (
                <div className="absolute inset-0 bg-white/45 backdrop-blur-[1px] z-50 flex items-center justify-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white shadow-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                            {syncingText || 'Syncing...'}
                        </span>
                    </div>
                </div>
            )}
            {/* Main Header Row */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                {/* Left side info groups */}
                <div className="flex flex-col md:flex-row items-stretch gap-4 flex-1">
                    {/* 1. Left: User Info (People Section) */}
                    <div className="flex items-center gap-3 px-4 py-2 border border-slate-200 rounded-xl bg-slate-50/30 shrink-0">
                        <Link
                            href="/people"
                            className="flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors bg-white shadow-sm"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Link>

                        {person.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={person.image_url} alt={person.name} className="h-10 w-10 rounded-none border border-slate-200 object-cover bg-slate-100 shadow-sm" />
                        ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-none border border-slate-200 bg-indigo-50 text-indigo-600 text-lg font-bold shadow-sm">
                                {person.name.charAt(0).toUpperCase()}
                            </div>
                        )}

                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold text-slate-900">{person.name}</h1>
                                <span className={cn(
                                    "text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border",
                                    isSettled
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                        : "bg-blue-50 text-blue-700 border-blue-100"
                                )}>
                                    {isSettled ? 'SETTLED' : 'ACTIVE'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 2. Center: Current Cycle Section */}
                    {activeCycle && selectedYear !== null && (
                        <div className="flex items-center gap-3 px-4 py-2 border border-slate-200 rounded-xl bg-slate-50/30">
                            <StatsPopover
                                originalLend={activeCycle.stats.originalLend}
                                cashback={activeCycle.stats.cashback}
                                netLend={currentCycleNetLend}
                                repay={activeCycle.stats.repay}
                                remains={activeCycle.remains}
                                paidRollover={activeCycle.stats.paidRollover}
                                receiveRollover={activeCycle.stats.receiveRollover}
                            >
                                <button className="flex items-center justify-center h-7 w-7 rounded-md border border-slate-200 text-amber-600 bg-white hover:bg-amber-50 transition-colors shadow-sm" title="Current cycle details">
                                    <Calendar className="h-3.5 w-3.5" />
                                </button>
                            </StatsPopover>

                            <div className="flex flex-col gap-1.5 min-w-[260px]">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Current Cycle</span>
                                    <span className={cn(
                                        "text-[9px] uppercase font-bold px-2 py-0.5 rounded-full",
                                        isCycleSettled
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-amber-100 text-amber-700"
                                    )}>
                                        {formatCycleLabel(activeCycle.tag)}
                                    </span>
                                    {activeCycle.tag !== new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' }).format(new Date()) && (
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[8px] font-black text-slate-500 uppercase tracking-tighter animate-in fade-in zoom-in duration-300">
                                            <History className="h-2 w-2" />
                                            Past
                                        </div>
                                    )}
                                    <span className="text-sm font-bold text-slate-900 ml-auto tabular-nums">
                                        {numberFormatter.format(currentCycleDisplayValue)}
                                    </span>
                                </div>
                                {isCycleSettled ? (
                                    <div className="h-3.5 w-full rounded-full border border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700 flex items-center justify-center uppercase tracking-wide">
                                        Settled
                                    </div>
                                ) : (
                                    <div className="relative flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner border border-slate-200/50">
                                        <div
                                            className="bg-emerald-500 flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
                                            style={{ width: `${currentCycleRepayPercent}%` }}
                                        >
                                            {currentCycleRepayPercent > 15 && `${currentCycleRepayPercent}%`}
                                        </div>
                                        <div
                                            className="bg-rose-500 flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
                                            style={{ width: `${currentCycleRemainsPercent}%` }}
                                        >
                                            {currentCycleRemainsPercent > 15 && `${currentCycleRemainsPercent}%`}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 3. Consolidated Balance & Breakdown Section */}
                    <div className="flex items-center gap-6 px-5 py-2.5 border border-slate-200 rounded-xl bg-slate-50/30 transition-all duration-300 hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-500/5 group">
                        <div className="grid grid-cols-4 gap-x-8 gap-y-0.5 pr-8 border-r border-slate-200">
                            {/* Row 1: Labels */}
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] whitespace-nowrap">Orig. Spend</span>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] whitespace-nowrap">Cashback</span>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] whitespace-nowrap">Net Lend</span>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] whitespace-nowrap">Total Repay</span>

                            {/* Row 2: Values */}
                            <span className="text-[13px] font-black text-slate-600 tabular-nums">
                                {numberFormatter.format(stats.originalLend)}
                            </span>
                            <span className="text-[13px] font-black text-amber-600 tabular-nums">
                                -{numberFormatter.format(stats.cashback)}
                            </span>
                            <span className="text-[13px] font-black text-blue-600 tabular-nums">
                                {numberFormatter.format(stats.netLend)}
                            </span>
                            <span className="text-[13px] font-black text-emerald-600 tabular-nums">
                                -{numberFormatter.format(stats.repay)}
                            </span>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">REMAINS</span>
                                {displayedBalance === 0 ? (
                                    <span className="text-xs font-bold uppercase px-3 py-1 rounded bg-emerald-100 text-emerald-700 w-fit">Settled</span>
                                ) : (
                                    <span className="text-2xl font-black tabular-nums text-rose-600 leading-none drop-shadow-[0_2px_4px_rgba(225,29,72,0.1)] group-hover:scale-105 transition-transform">
                                        {numberFormatter.format(displayedBalance)}
                                    </span>
                                )}
                            </div>

                            <StatsPopover
                                originalLend={stats.originalLend}
                                cashback={stats.cashback}
                                netLend={stats.netLend}
                                repay={stats.repay}
                                remains={stats.remains}
                                paidRollover={stats.paidRollover}
                                receiveRollover={stats.receiveRollover}
                                tabs={activeCycle ? [
                                    {
                                        key: 'current',
                                        label: 'Current',
                                        stats: {
                                            originalLend: activeCycle.stats.originalLend,
                                            cashback: activeCycle.stats.cashback,
                                            netLend: currentCycleNetLend,
                                            repay: activeCycle.stats.repay,
                                            remains: activeCycle.remains,
                                            paidRollover: activeCycle.stats.paidRollover,
                                            receiveRollover: activeCycle.stats.receiveRollover,
                                        },
                                    },
                                    {
                                        key: 'year',
                                        label: 'Entire Year',
                                        stats: {
                                            originalLend: stats.originalLend,
                                            cashback: stats.cashback,
                                            netLend: stats.netLend,
                                            repay: stats.repay,
                                            remains: stats.remains,
                                            paidRollover: stats.paidRollover,
                                            receiveRollover: stats.receiveRollover,
                                        },
                                    },
                                ] : undefined}
                            >
                                <button className="flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 text-slate-400 bg-white hover:bg-slate-50 hover:text-slate-600 transition-all shadow-sm" title="Detailed Breakdown">
                                    <TrendingUp className="h-4 w-4" />
                                </button>
                            </StatsPopover>
                        </div>

                        {cashbackStatus && selectedYear !== null && (
                            <div className="pl-6 border-l border-slate-200">
                                <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] mb-2">Reward Progress</div>
                                <CashbackStatusDisplay
                                    earned={cashbackStatus.earned}
                                    cap={cashbackStatus.cap}
                                    currentSpend={cashbackStatus.currentSpend}
                                    minSpend={cashbackStatus.minSpend}
                                    needToSpend={cashbackStatus.needToSpend}
                                    remaining={cashbackStatus.remaining}
                                    variant="header"
                                />
                            </div>
                        )}
                    </div>

                </div>

                {/* Right: Tools & Actions */}
                <div className="flex items-center gap-2 ml-auto rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                    {/* Year Filter */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <button className="h-9 px-3 flex items-center gap-2 bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 transition-colors text-xs font-medium bg-white shadow-sm">
                                <span className="font-bold">{selectedYear || 'All Time'}</span>
                                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-32 p-1" align="end">
                            <button
                                onClick={() => onYearChange(null)}
                                className={cn(
                                    "w-full text-left px-3 py-2 rounded-sm text-xs",
                                    !selectedYear ? "bg-slate-100 font-bold" : "hover:bg-slate-50"
                                )}
                            >
                                All Time
                            </button>
                            {availableYears.map(year => (
                                <button
                                    key={year}
                                    onClick={() => onYearChange(year)}
                                    className={cn(
                                        "w-full text-left px-3 py-2 rounded-sm text-xs",
                                        selectedYear === year ? "bg-indigo-50 text-indigo-700 font-bold" : "hover:bg-slate-50"
                                    )}
                                >
                                    {year}
                                </button>
                            ))}
                        </PopoverContent>
                    </Popover>

                    <div className="h-8 w-px bg-slate-200 mx-0.5" />

                    {/* Action Buttons */}
                    <button
                        onClick={() => onTabChange(activeTab === 'history' ? 'timeline' : 'history')}
                        className={cn(
                            "h-9 px-3 flex items-center gap-1.5 border rounded-md text-xs font-medium transition-colors shadow-sm",
                            activeTab === 'history'
                                ? "bg-slate-800 text-white border-slate-800"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        )}
                    >
                        <History className="h-3.5 w-3.5" />
                        History
                    </button>

                    <button
                        onClick={() => onTabChange('split-bill')}
                        className={cn(
                            "h-9 px-3 flex items-center gap-1.5 border rounded-md text-xs font-medium transition-colors shadow-sm",
                            activeTab === 'split-bill'
                                ? "bg-slate-800 text-white border-slate-800"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        )}
                    >
                        <Split className="h-3.5 w-3.5" />
                        Split
                    </button>

                    <button
                        onClick={onEdit}
                        className="h-9 px-3 flex items-center gap-1.5 border border-slate-200 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors bg-white whitespace-nowrap shadow-sm"
                    >
                        <Edit className="h-3.5 w-3.5" />
                        Edit
                    </button>
                </div>
            </div>
        </div>
    )
}
