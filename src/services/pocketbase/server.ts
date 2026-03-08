/**
 * PocketBase server utilities for migrations and backfill operations.
 * Minimal stub implementation for Phase 1.
 */

const PB_URL = 'https://api-db.reiwarden.io.vn'

/**
 * Make a request to PocketBase API.
 * Used primarily for backfill/migration operations.
 */
export async function pocketbaseRequest(
  endpoint: string,
  options?: RequestInit,
): Promise<any> {
  const url = `${PB_URL}${endpoint}`
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PB request failed [${response.status}]: ${text}`)
  }

  return await response.json()
}

/**
 * Convert Supabase UUIDv4 IDs to PocketBase-compatible IDs.
 * PocketBase uses base32 IDs (15 chars), so we generate deterministic IDs from UUIDs.
 */
export function toPocketBaseId(supabaseId: string): string {
  // For now, return a hash-based ID
  // In production, use deterministic mapping based on original UUID
  if (!supabaseId) return generatePocketBaseId()
  
  // Use first 15 chars of a deterministic hash of the UUID
  const hash = Array.from(supabaseId)
    .reduce((acc, ch) => ((acc << 5) - acc) + ch.charCodeAt(0), 0)
    .toString(36)
    .slice(0, 15)
    .padEnd(15, '0')
  
  return hash
}

/**
 * Generate a random PocketBase-compatible ID (15-char base32).
 */
export function generatePocketBaseId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}
