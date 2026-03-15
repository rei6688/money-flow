export type ManageCycleSheetRequest = {
  personId: string
  cycleTag?: string
  action?: 'sync' | 'test_create'
}

export type ManageCycleSheetResponse = {
  status: 'created' | 'synced' | 'test_created'
  sheetUrl?: string | null
  sheetId?: string | null
  error?: string
  requestId?: string
  stage?:
    | 'validate_payload'
    | 'test_create'
    | 'lookup_existing'
    | 'create_sheet'
    | 'persist_sheet'
    | 'sync_transactions'
    | 'unexpected'
  debugMessage?: string
  syncedCount?: number
  manualPreserved?: number
  totalRows?: number
}
