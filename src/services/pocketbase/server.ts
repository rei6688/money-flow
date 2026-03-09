const PB_URL = 'https://api-db.reiwarden.io.vn'

let cachedPocketBaseToken: string | null = null

async function getPocketBaseAuthHeaders(): Promise<Record<string, string>> {
  const explicitToken =
    process.env.POCKETBASE_ADMIN_TOKEN ||
    process.env.POCKETBASE_SERVICE_TOKEN ||
    process.env.POCKETBASE_TOKEN ||
    process.env.PB_ADMIN_TOKEN ||
    process.env.PB_SERVICE_TOKEN ||
    ''

  if (explicitToken) {
    return { Authorization: `Bearer ${explicitToken}` }
  }

  if (cachedPocketBaseToken) {
    return { Authorization: `Bearer ${cachedPocketBaseToken}` }
  }

  const identity = process.env.POCKETBASE_DB_EMAIL || ''
  const password = process.env.POCKETBASE_DB_PASSWORD || ''

  if (!identity || !password) {
    return {}
  }

  const authEndpoints = [
    '/api/admins/auth-with-password',
    '/api/collections/_superusers/auth-with-password',
  ]

  for (const endpoint of authEndpoints) {
    try {
      const response = await fetch(`${PB_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, password }),
      })

      if (!response.ok) continue

      const payload = await response.json() as { token?: string }
      if (payload?.token) {
        cachedPocketBaseToken = payload.token
        return { Authorization: `Bearer ${payload.token}` }
      }
    } catch {
      // try next endpoint
    }
  }

  return {}
}

type PocketBaseRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

type PocketBaseListResponse<T> = {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: T[]
}

function toQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return ''
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value))
    }
  }
  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

function normalizeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string' || body instanceof URLSearchParams || body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body as BodyInit
  }
  return JSON.stringify(body)
}

export async function pocketbaseRequest<T = any>(
  endpoint: string,
  options?: PocketBaseRequestOptions,
): Promise<T> {
  const url = `${PB_URL}${endpoint}`
  const authHeaders = await getPocketBaseAuthHeaders()

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options?.headers ?? {}),
    },
    body: normalizeBody(options?.body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PB request failed [${response.status}]: ${text}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function pocketbaseList<T = any>(
  collection: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<PocketBaseListResponse<T>> {
  const query = toQueryString(params)
  return pocketbaseRequest<PocketBaseListResponse<T>>(`/api/collections/${collection}/records${query}`)
}

export async function pocketbaseGetById<T = any>(collection: string, id: string): Promise<T> {
  return pocketbaseRequest<T>(`/api/collections/${collection}/records/${id}`)
}

export function toPocketBaseId(supabaseId: string, _collection?: string): string {
  if (!supabaseId) return generatePocketBaseId()

  const hash = Array.from(supabaseId)
    .reduce((acc, ch) => ((acc << 5) - acc) + ch.charCodeAt(0), 0)
    .toString(36)
    .replace('-', 'n')
    .slice(0, 15)
    .padEnd(15, '0')

  return hash
}

export function generatePocketBaseId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}
