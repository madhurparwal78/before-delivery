import type {
  ApiErrorBody, Item, ImportRun, ListSummary, PackSheet, Profile, Share, SyncOp, SyncResult, TripList,
} from '../shared/api-types'

/** The server answered with a refusal. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
  }
}

/** The request never got an answer (offline, dropped connection, server unreachable). */
export class NetworkError extends Error {}

/** A decimal exactly as the hiker typed it; it travels as a JSON number without passing through a float. */
class Decimal {
  constructor(readonly text: string) {}
}

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/

/** A weight field's `{value, unit}`; text that is not a plain decimal is sent as null so the server names the field. */
export function weightInput(text: string, unit: string): { value: Decimal | null; unit: string } {
  return { value: PLAIN_DECIMAL.test(text.trim()) ? new Decimal(text.trim()) : null, unit }
}

function serialise(value: unknown): string {
  if (value instanceof Decimal) return value.text
  if (Array.isArray(value)) return `[${value.map(serialise).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${serialise(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

interface RequestOptions {
  method?: string
  body?: unknown
  form?: FormData
  headers?: Record<string, string>
  /** A 401 is handed back to the caller instead of taking the hiker to sign-in. */
  hold401?: boolean
}

let onUnauthenticated: () => void = () => undefined

/** Registers what happens when an API call without its own 401 handling finds the session ended. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers }
  let body: BodyInit | undefined
  if (options.form) body = options.form
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = serialise(options.body)
  }
  let response: Response
  try {
    response = await fetch(path, { method: options.method ?? 'GET', headers, body, credentials: 'same-origin' })
  } catch {
    throw new NetworkError('Could not reach Skinout.')
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const parsed: unknown = text ? JSON.parse(text) : undefined
  if (response.ok) return parsed as T
  const { error } = parsed as ApiErrorBody
  const refusal = new ApiError(response.status, error.code, error.message, error.fields)
  if (response.status === 401 && !options.hold401 && path !== '/api/session') onUnauthenticated()
  throw refusal
}

const json = (method: string, body?: unknown, headers?: Record<string, string>): RequestOptions => ({ method, body, headers })

export const api = {
  signIn: (passphrase: string) => request<void>('/api/session', { ...json('POST', { passphrase }), hold401: true }),
  signOut: () => request<void>('/api/session', { method: 'DELETE' }),
  profile: () => request<{ profile: Profile }>('/api/profile').then((r) => r.profile),
  saveProfile: (body: unknown) => request<{ profile: Profile }>('/api/profile', json('PATCH', body)).then((r) => r.profile),
  closet: () => request<{ items: Item[] }>('/api/closet').then((r) => r.items),
  addItem: (body: unknown) => request<{ item: Item }>('/api/closet', json('POST', body)).then((r) => r.item),
  editItem: (id: string, version: number, body: unknown) =>
    request<{ item: Item }>(`/api/closet/${id}`, json('PATCH', body, { 'If-Match': `"${version}"` })).then((r) => r.item),
  retire: (id: string, key: string, body: unknown) =>
    request<{ item: Item; affectedLines: number }>(`/api/closet/${id}/retire`, json('POST', body, { 'Idempotency-Key': key })),
  deleteItem: (id: string) => request<void>(`/api/closet/${id}`, { method: 'DELETE' }),
  addPhoto: (id: string, file: File) => {
    const form = new FormData()
    form.set('photo', file)
    return request<{ photo: { id: string } }>(`/api/closet/${id}/photo`, { method: 'POST', form })
  },
  lists: () => request<{ lists: ListSummary[] }>('/api/lists').then((r) => r.lists),
  createList: (name: string) => request<{ list: TripList }>('/api/lists', json('POST', { name })).then((r) => r.list),
  list: (id: string) => request<{ list: TripList }>(`/api/lists/${id}`).then((r) => r.list),
  addLine: (listId: string, itemId: string) =>
    request<{ list: TripList }>(`/api/lists/${listId}/lines`, { ...json('POST', { itemId }), hold401: true }).then((r) => r.list),
  editLine: (listId: string, lineId: string, body: unknown) =>
    request<{ list: TripList }>(`/api/lists/${listId}/lines/${lineId}`, { ...json('PATCH', body), hold401: true }).then((r) => r.list),
  removeLine: (listId: string, lineId: string) =>
    request<{ list: TripList }>(`/api/lists/${listId}/lines/${lineId}`, { method: 'DELETE', hold401: true }).then((r) => r.list),
  changeState: (listId: string, to: string) =>
    request<{ list: TripList }>(`/api/lists/${listId}/state`, { ...json('POST', { to }), hold401: true }).then((r) => r.list),
  sync: (ops: SyncOp[]) => request<{ results: SyncResult[]; lists: ListSummary[] }>('/api/sync', { ...json('POST', { ops }), hold401: true }),
  share: (listId: string) => request<{ share: Share | null }>(`/api/lists/${listId}/share`).then((r) => r.share),
  createShare: (listId: string, expiresOn: string | null) =>
    request<{ share: Share }>(`/api/lists/${listId}/share`, json('POST', expiresOn ? { expiresOn } : {})).then((r) => r.share),
  revokeShare: (listId: string) => request<void>(`/api/lists/${listId}/share`, { method: 'DELETE' }),
  sheets: (listId: string) => request<{ sheets: PackSheet[] }>(`/api/lists/${listId}/pack-sheets`).then((r) => r.sheets),
  printSheet: (listId: string) => request<{ sheet: PackSheet }>(`/api/lists/${listId}/pack-sheets`, json('POST', {})).then((r) => r.sheet),
  imports: () => request<{ imports: ImportRun[] }>('/api/imports').then((r) => r.imports),
  previewImport: (file: File) => {
    const form = new FormData()
    form.set('file', file)
    return request<{ import: ImportRun }>('/api/imports', { method: 'POST', form }).then((r) => r.import)
  },
  commitImport: (id: string) => request<{ import: ImportRun }>(`/api/imports/${id}/commit`, json('POST', {})).then((r) => r.import),
}
