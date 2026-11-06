export type Person = { id: string; name: string; email: string; org_role: 'admin' | 'steward' | 'member' }

export type Contribution = {
  sensor_id: string; kind: 'tower' | 'satellite'; area_m2: number
  qualifying_half_hours: number; half_hours: number
  co2_tco2e: string; ch4_tco2e: string; net_tco2e: string
}

export type Summary = {
  sealed_net_tco2e: string; buffer_tco2e: string
  intact_count: number; broken_count: number; superseded_count: number
}

export type Preview = {
  start: string; end: string; sensor_ids: string[]
  coverage_pct: string; floor_pct: string
  net_tco2e: string; co2_tco2e: string; ch4_tco2e: string
  buffer_pct: string; buffer_tco2e: string; credited_tco2e: string
  readings_count: number; fingerprint: string
  contributions: Contribution[]
  sealable: boolean
  blocked_reason: 'below_coverage_floor' | 'overlaps_sealed' | 'already_sealed' | 'role' | null
  blocking_figure_id: string | null
}

export type Figure = {
  id: string; project: string; start: string; end: string; sensor_ids: string[]
  status: 'sealed' | 'broken' | 'superseded'
  supersedes: string | null; superseded_by: string | null
  coverage_pct: string; floor_pct: string
  net_tco2e: string; co2_tco2e: string; ch4_tco2e: string
  buffer_pct: string; buffer_tco2e: string; credited_tco2e: string
  readings_count: number; fingerprint: string
  sealed_at: string; sealed_by: string; checked_at: string
  contributions: Contribution[]
  evidence: { readings_key: string; derivation_key: string }
  rederived?: { fingerprint: string; coverage_pct: string; net_tco2e: string; matches: boolean }
}

export type Sensor = { id: string; kind: 'tower' | 'satellite'; polygon: [number, number][] }

export type ProjectDetail = {
  slug: string; name: string; kind: string; code: string
  floor_pct: string; buffer_pct: string; lead_person_id: string
  boundary: [number, number][]; boundary_area_m2: number
  sensors: Sensor[]
  record_start: string | null; record_end: string | null
  role: 'viewer' | 'analyst' | 'sealer'
  summary: Summary
}

export type ProjectListEntry = {
  slug: string; name: string; kind: string
  floor_pct: string; buffer_pct: string
  role: 'viewer' | 'analyst' | 'sealer'
  summary: Summary
}

export type LedgerEntry = {
  id: string; figure_id: string
  kind: 'issuance' | 'buffer' | 'reversal'
  tco2e: string; reverses: string | null; recorded_at: string
}

export type LinkRow = {
  id: string; token: string; url: string
  status: 'live' | 'expired' | 'revoked'
  issued_at: string; expires_at: string; revoked_at: string | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code)
  }
}

export class NetworkError extends Error {}

export async function api<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      credentials: 'same-origin',
    })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    if (!res.ok) {
      throw new ApiError(res.status, String(data.error ?? 'unknown'), data)
    }
    return data as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new NetworkError(String(err))
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function apiWithHeaders<T>(
  method: string, path: string, body?: unknown, headers?: Record<string, string>, timeoutMs?: number,
): Promise<{ data: T; headers: Record<string, string> }> {
  const ctrl = new AbortController()
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      credentials: 'same-origin',
    })
    const text = await res.text()
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    const hdrs: Record<string, string> = {}
    res.headers.forEach((v, k) => { hdrs[k] = v })
    if (!res.ok) throw new ApiError(res.status, String(data.error ?? 'unknown'), data)
    return { data: data as T, headers: hdrs }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new NetworkError(String(err))
  } finally {
    if (timer) clearTimeout(timer)
  }
}
