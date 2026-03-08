/**
 * PocketBase ID Mapping Utilities
 * Handles UUID ↔ PocketBase ID conversions
 */

/**
 * Convert Supabase UUID to PocketBase ID format
 * For now, assumes they're compatible or same format
 * Can be extended if PB uses different ID scheme
 */
export function toPocketBaseId(supabaseId: string): string {
  // If PB uses hashed IDs instead of UUIDs, implement conversion here
  // For now, return as-is
  return supabaseId
}

/**
 * Reverse lookup: Get Supabase UUID from PocketBase record
 * Searches metadata.source_id if present
 */
export function fromPocketBaseId(pbRecord: any): string {
  // If PB record has source_id in metadata, use it
  if (pbRecord?.metadata?.source_id) {
    return pbRecord.metadata.source_id
  }
  // Otherwise assume PB ID is the UUID
  return pbRecord?.id || pbRecord
}

/**
 * Ensure PB record has source_id metadata
 * Used during dual-write to maintain bidirectional mapping
 */
export function injectSourceId(pbData: any, supabaseId: string): any {
  return {
    ...pbData,
    metadata: {
      ...pbData?.metadata,
      source_id: supabaseId
    }
  }
}
