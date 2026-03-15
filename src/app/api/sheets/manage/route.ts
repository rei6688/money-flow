import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isYYYYMM, normalizeMonthTag } from '@/lib/month-tag'
import { createCycleSheet, syncCycleTransactions, createTestSheet } from '@/services/sheet.service'
import type { ManageCycleSheetRequest, ManageCycleSheetResponse } from '@/types/sheet.types'

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function makeRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `sheet-${Date.now()}`
  }
}

function errorResponse(
  requestId: string,
  stage: NonNullable<ManageCycleSheetResponse['stage']>,
  error: string,
  status: number,
  debugMessage?: string,
) {
  return NextResponse.json(
    {
      error,
      requestId,
      stage,
      debugMessage,
    } satisfies Partial<ManageCycleSheetResponse>,
    { status },
  )
}

export async function POST(request: Request) {
  const requestId = makeRequestId()
  try {
    const payload = (await request.json()) as ManageCycleSheetRequest
    const personId = payload?.personId?.trim()
    const action = payload?.action || 'sync'

    console.info('[ManageSheet API] request:start', { requestId, action, hasPersonId: Boolean(personId) })

    if (!personId) {
      console.warn('[ManageSheet API] validation failed: missing personId', { requestId })
      return errorResponse(requestId, 'validate_payload', 'Missing personId', 400)
    }

    // Handle Test Create Action
    if (action === 'test_create') {
      const result = await createTestSheet(personId)
      if (!result.success) {
        console.warn('[ManageSheet API] test_create failed', { requestId, personId, message: result.message })
        return errorResponse(
          requestId,
          'test_create',
          result.message ?? 'Test create failed',
          400,
          result.message ?? 'createTestSheet returned success=false',
        )
      }
      return NextResponse.json({
        status: 'test_created',
        sheetUrl: result.sheetUrl,
        sheetId: result.sheetId,
        requestId,
        stage: 'test_create',
      })
    }

    // Default Sync Action
    const rawCycle = payload?.cycleTag?.trim()
    if (!rawCycle) {
      console.warn('[ManageSheet API] validation failed: missing cycleTag', { requestId, personId })
      return errorResponse(requestId, 'validate_payload', 'Missing cycleTag', 400)
    }

    const normalizedCycle = normalizeMonthTag(rawCycle)
    if (!normalizedCycle || !isYYYYMM(normalizedCycle)) {
      console.warn('[ManageSheet API] validation failed: invalid cycleTag', { requestId, personId, rawCycle, normalizedCycle })
      return errorResponse(requestId, 'validate_payload', 'Invalid cycleTag format', 400)
    }

    console.info('[ManageSheet API] request', { requestId, personId, cycleTag: normalizedCycle })

    const supabase = createClient()
    type CycleSheetRow = { id: string; sheet_id?: string | null; sheet_url?: string | null }
    let existing: CycleSheetRow | null = null
    let tableAvailable = isUuidLike(personId)

    if (!tableAvailable) {
      console.info('[ManageSheet API] skip person_cycle_sheets lookup: personId is not UUID, using direct create/sync path', { requestId, personId })
    }

    if (tableAvailable) {
      const existingResult = await (supabase as any)
        .from('person_cycle_sheets')
        .select('id, sheet_id, sheet_url')
        .eq('person_id', personId)
        .eq('cycle_tag', normalizedCycle)
        .maybeSingle()

      if (existingResult.error) {
        tableAvailable = false
        console.warn('[ManageSheet API] person_cycle_sheets lookup failed:', {
          requestId,
          personId,
          cycleTag: normalizedCycle,
          error: existingResult.error,
        })
      } else {
        existing = existingResult.data as CycleSheetRow | null
      }
    }

    let status: ManageCycleSheetResponse['status'] = 'synced'
    const existingRowId = existing?.id ?? null
    const hasSheetInfo = Boolean(existing?.sheet_id || existing?.sheet_url)
    let sheetUrl =
      existing?.sheet_url ??
      (existing?.sheet_id ? `https://docs.google.com/spreadsheets/d/${existing.sheet_id}` : null)
    let sheetId = existing?.sheet_id ?? null
    console.info('[ManageSheet API] existing', { requestId, found: !!existing, sheetId, sheetUrl, hasSheetInfo })

    if (!hasSheetInfo) {
      const createResult = await createCycleSheet(personId, normalizedCycle)
      console.info('[ManageSheet API] create result', { requestId, success: createResult.success, message: createResult.message, sheetId: createResult.sheetId })
      if (!createResult.success) {
        return errorResponse(
          requestId,
          'create_sheet',
          createResult.message ?? 'Create failed',
          400,
          createResult.message ?? 'createCycleSheet returned success=false',
        )
      }

      status = 'created'
      sheetUrl = createResult.sheetUrl ?? sheetUrl ?? null
      sheetId = createResult.sheetId ?? sheetId ?? null

      if (tableAvailable) {
        const payload = {
          person_id: personId,
          cycle_tag: normalizedCycle,
          sheet_id: sheetId,
          sheet_url: sheetUrl,
        }
        if (existingRowId) {
          await (supabase as any)
            .from('person_cycle_sheets')
            .update(payload)
            .eq('id', existingRowId)
        } else {
          await (supabase as any)
            .from('person_cycle_sheets')
            .insert(payload)
        }
      }

      if (sheetUrl) {
        try {
          await (supabase as any)
            .from('profiles')
            .update({ google_sheet_url: sheetUrl })
            .eq('id', personId)
        } catch (profileError) {
          console.warn('[ManageSheet API] unable to update profile sheet url', { requestId, personId, profileError })
        }
      }
    } else if (tableAvailable && existingRowId) {
      await (supabase as any)
        .from('person_cycle_sheets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingRowId)
    }

    const syncResult = await syncCycleTransactions(personId, normalizedCycle, sheetId)
    console.info('[ManageSheet API] sync result', { requestId, success: syncResult.success, message: syncResult.message, syncedCount: (syncResult as any).syncedCount })
    if (!syncResult.success) {
      return errorResponse(
        requestId,
        'sync_transactions',
        syncResult.message ?? 'Sync failed',
        400,
        syncResult.message ?? 'syncCycleTransactions returned success=false',
      )
    }

    return NextResponse.json({
      status,
      sheetUrl,
      sheetId,
      requestId,
      stage: 'sync_transactions',
      syncedCount: (syncResult as any).syncedCount,
      manualPreserved: (syncResult as any).manualPreserved,
      totalRows: (syncResult as any).totalRows
    })
  } catch (error: any) {
    console.error('[ManageSheet API] unexpected failure', {
      requestId,
      error: error?.message,
      stack: error?.stack,
    })
    return errorResponse(
      requestId,
      'unexpected',
      error?.message ?? 'Unexpected error',
      500,
      error?.message ?? 'Unhandled exception in manage sheet API',
    )
  }
}
