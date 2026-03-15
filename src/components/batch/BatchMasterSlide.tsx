'use client'

import { useState, useEffect } from 'react'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BatchMasterManager } from '@/components/batch/BatchMasterManager'
import { Sparkles, Settings, Plus, XCircle, Loader2, Edit2, Check } from 'lucide-react'
import { listAllBatchPhasesAction, createBatchPhaseAction, deleteBatchPhaseAction, updateBatchPhaseAction } from '@/actions/batch-phases.actions'
import { Select } from '@/components/ui/select'
import { DayOfMonthPicker } from '@/components/ui/day-of-month-picker'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface BatchMasterSlideProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    bankType: 'MBB' | 'VIB'
    accounts: any[]
    bankMappings: any[]
}

export function BatchMasterSlide({
    open,
    onOpenChange,
    bankType,
    accounts,
    bankMappings
}: BatchMasterSlideProps) {
    const [phases, setPhases] = useState<any[]>([])
    const [loadingPhases, setLoadingPhases] = useState(true)
    const [adding, setAdding] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [savingPhaseId, setSavingPhaseId] = useState<string | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; label: string; itemCount: number } | null>(null)
    const [editingPhase, setEditingPhase] = useState<any | null>(null)
    const [newLabel, setNewLabel] = useState('')
    const [newPeriodType, setNewPeriodType] = useState<string | undefined>('before')
    const [newCutoffDay, setNewCutoffDay] = useState<number | null>(15)

    useEffect(() => {
        if (open) {
            loadPhases()
        }
    }, [open, bankType])

    async function loadPhases() {
        setLoadingPhases(true)
        const result = await listAllBatchPhasesAction(bankType)
        if (result.success) setPhases((result as any).data || [])
        setLoadingPhases(false)
    }

    async function handleAddPhase() {
        if (!newLabel.trim()) { toast.error('Nhập tên phase'); return }
        if (!newPeriodType) { toast.error('Chọn loại Before / After'); return }
        if (!newCutoffDay) { toast.error('Chọn ngày cutoff'); return }
        setAdding(true)
        const result = await createBatchPhaseAction({
            bankType,
            label: newLabel.trim(),
            periodType: newPeriodType as 'before' | 'after',
            cutoffDay: newCutoffDay
        })
        if (result.success) {
            toast.success(`Phase "${newLabel.trim()}" đã tạo`)
            setNewLabel('')
            setNewPeriodType('before')
            setNewCutoffDay(15)
            await loadPhases()
        } else {
            toast.error('Tạo phase thất bại')
        }
        setAdding(false)
    }

    function handleStartEditPhase(phase: any) {
        setEditingPhase(phase)
        setNewLabel(phase.label || '')
        setNewPeriodType((phase.period_type || 'before') as 'before' | 'after')
        setNewCutoffDay(Number(phase.cutoff_day || 15))
    }

    function resetPhaseEditor() {
        setEditingPhase(null)
        setNewLabel('')
        setNewPeriodType('before')
        setNewCutoffDay(15)
    }

    async function handleSavePhaseEdit() {
        if (!editingPhase?.id) return
        if (!newLabel.trim()) { toast.error('Nhập tên phase'); return }
        if (!newPeriodType) { toast.error('Chọn loại Before / After'); return }
        if (!newCutoffDay) { toast.error('Chọn ngày cutoff'); return }

        setSavingPhaseId(editingPhase.id)
        const result = await updateBatchPhaseAction(editingPhase.id, {
            label: newLabel.trim(),
            periodType: newPeriodType as 'before' | 'after',
            cutoffDay: newCutoffDay,
        })

        if (result.success) {
            toast.success(`Phase "${newLabel.trim()}" đã cập nhật`)
            await loadPhases()
            resetPhaseEditor()
        } else {
            toast.error('Cập nhật phase thất bại')
        }
        setSavingPhaseId(null)
    }

    function handleDeleteClick(id: string, label: string, itemCount: number) {
        if (itemCount > 0) {
            toast.error(`Không thể xóa phase "${label}" vì còn ${itemCount} items. Xóa items trước trong Master list.`)
            return
        }
        setDeleteConfirm({ id, label, itemCount })
    }

    async function confirmDelete() {
        if (!deleteConfirm) return
        
        const { id, label } = deleteConfirm
        setDeletingId(id)
        setDeleteConfirm(null)
        
        const result = await deleteBatchPhaseAction(id, { revalidate: false })
        if (result.success) {
            toast.success(`Đã xoá "${label}"`)
            await loadPhases()
        } else {
            toast.error('Xoá thất bại')
        }
        setDeletingId(null)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-4xl overflow-y-auto bg-slate-50 p-0">
                <SheetHeader className="p-6 pb-4 border-b bg-white top-0 sticky z-10 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <SheetTitle className="flex items-center gap-2 text-xl font-bold">
                                <Sparkles className="w-5 h-5 text-indigo-600" />
                                Master Template Checklist - {bankType}
                            </SheetTitle>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                Global Recurring Payment Targets & Phase Management
                            </p>
                        </div>
                        <div className="h-8 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest gap-1.5 transition-colors bg-indigo-50 text-indigo-600 border border-indigo-100 inline-flex items-center">
                            <Settings className="h-3.5 w-3.5" />
                            Phase Setup Enabled
                        </div>
                    </div>
                </SheetHeader>

                <div className="p-6 space-y-6">
                    {/* Phase Setup Section */}
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in slide-in-from-top-2 duration-200">
                            <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100">
                                <h3 className="font-black text-sm text-slate-900 flex items-center gap-2">
                                    <Settings className="h-4 w-4 text-indigo-500" />
                                    Phase Setup — {bankType}
                                </h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                    Items tự phân vào phase dựa trên due date
                                </p>
                            </div>

                            <div className="p-4 space-y-4">
                                {loadingPhases ? (
                                    <div className="flex items-center justify-center py-4">
                                        <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                                    </div>
                                ) : phases.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {phases.map((p: any) => (
                                            <div key={p.id} className={cn(
                                                "inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl border",
                                                p.is_active ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-50"
                                            )}>
                                                <span className={cn(
                                                    "h-2 w-2 rounded-full shrink-0",
                                                    p.period_type === 'before' ? "bg-blue-500" : "bg-orange-500"
                                                )} />
                                                <span className="font-black text-xs text-slate-800">{p.label}</span>
                                                <span className="text-[9px] font-bold text-slate-400">Day {p.cutoff_day}</span>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                onClick={() => handleStartEditPhase(p)}
                                                                disabled={savingPhaseId === p.id}
                                                                className={cn(
                                                                    "h-5 w-5 rounded-md flex items-center justify-center transition-colors",
                                                                    savingPhaseId === p.id
                                                                        ? "text-slate-300 cursor-not-allowed"
                                                                        : "text-slate-300 hover:text-indigo-600 hover:bg-indigo-50"
                                                                )}
                                                            >
                                                                {savingPhaseId === p.id ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : (
                                                                    <Edit2 className="h-3 w-3" />
                                                                )}
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="text-xs">Edit phase</TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <button
                                                                onClick={() => handleDeleteClick(p.id, p.label, 0)}
                                                                disabled={deletingId === p.id}
                                                                className={cn(
                                                                    "h-5 w-5 rounded-md flex items-center justify-center transition-colors",
                                                                    deletingId === p.id
                                                                        ? "text-slate-300 cursor-not-allowed"
                                                                        : "text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                                                                )}
                                                            >
                                                                {deletingId === p.id ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : (
                                                                    <XCircle className="h-3 w-3" />
                                                                )}
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="text-xs">
                                                            {deletingId === p.id ? 'Đang xóa...' : 'Xóa phase'}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-400 font-medium text-center py-2">
                                        Chưa có phase nào. Thêm phase đầu tiên để bắt đầu chia range.
                                    </p>
                                )}

                                {/* Add New Phase Form */}
                                <div className="flex items-end gap-2 flex-wrap">
                                    <div className="flex-1 min-w-[140px]">
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                                            Tên Phase
                                        </label>
                                        <Input
                                            value={newLabel}
                                            onChange={e => setNewLabel(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleAddPhase()}
                                            placeholder="VD: After 20"
                                            className="h-9 rounded-xl text-sm font-medium"
                                        />
                                    </div>
                                    <div className="w-[110px] shrink-0">
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                                            Loại
                                        </label>
                                        <Select
                                            value={newPeriodType}
                                            onValueChange={(val) => val && setNewPeriodType(val)}
                                            items={[
                                                { value: 'before', label: 'Before' },
                                                { value: 'after', label: 'After' }
                                            ]}
                                            placeholder="Chọn..."
                                            className="h-9 rounded-xl text-xs font-bold"
                                        />
                                    </div>
                                    <div className="w-[100px] shrink-0">
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                                            Ngày Cutoff
                                        </label>
                                        <DayOfMonthPicker
                                            value={newCutoffDay}
                                            onChange={(day) => setNewCutoffDay(day)}
                                            className="h-9 rounded-xl text-xs font-bold"
                                        />
                                    </div>
                                    <Button
                                        onClick={editingPhase ? handleSavePhaseEdit : handleAddPhase}
                                        disabled={adding || !!savingPhaseId || !newLabel.trim()}
                                        className="h-9 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shrink-0"
                                    >
                                        {(adding || !!savingPhaseId)
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : editingPhase
                                                ? <Check className="h-3.5 w-3.5" />
                                                : <Plus className="h-3.5 w-3.5" />}
                                        {editingPhase ? 'Save' : 'Add'}
                                    </Button>
                                    {editingPhase && (
                                        <Button
                                            variant="outline"
                                            onClick={resetPhaseEditor}
                                            disabled={!!savingPhaseId}
                                            className="h-9 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest"
                                        >
                                            Cancel
                                        </Button>
                                    )}
                                </div>
                            </div>
                    </div>

                    {/* Master Items List */}
                    <BatchMasterManager
                        bankType={bankType}
                        accounts={accounts}
                        bankMappings={bankMappings}
                        phasesOverride={phases}
                    />
                </div>
            </SheetContent>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
                <AlertDialogContent className="sm:max-w-[425px]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-rose-600">
                            <XCircle className="h-5 w-5" />
                            Xóa Phase "{deleteConfirm?.label}"?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-sm text-slate-600">
                            Hành động này sẽ đánh dấu phase là không hoạt động. Phase sẽ không hiển thị trong danh sách nữa.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Hủy</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
                        >
                            Xóa
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    )
}
