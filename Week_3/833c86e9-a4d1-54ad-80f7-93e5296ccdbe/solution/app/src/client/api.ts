/** Counts client requests in flight on <body data-pending>; page-level loads can hold it too. */
let inflight = 0
const holds = new Set<symbol>()

function publish(): void {
  document.body.dataset.pending = String(inflight + holds.size)
}

/** Marks the page as busy until the returned function is called (route loads, boot). */
export function holdPending(): () => void {
  const id = Symbol('pending')
  holds.add(id)
  publish()
  return () => {
    holds.delete(id)
    publish()
  }
}

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: Record<string, any>) {
    super(`${status} ${JSON.stringify(body)}`)
  }
}

interface RequestOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  raw?: BodyInit
  contentType?: string
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  inflight += 1
  publish()
  try {
    const headers: Record<string, string> = { ...options.headers }
    let payload: BodyInit | undefined
    if (options.raw !== undefined) {
      payload = options.raw
      headers['content-type'] = options.contentType ?? 'application/octet-stream'
    } else if (body !== undefined) {
      payload = JSON.stringify(body)
      headers['content-type'] = 'application/json'
    }
    const response = await fetch(path, { method, headers, body: payload, signal: options.signal, credentials: 'same-origin' })
    const text = await response.text()
    const parsed = text ? JSON.parse(text) : {}
    if (!response.ok) throw new ApiFailure(response.status, parsed)
    return parsed as T
  } finally {
    inflight -= 1
    publish()
  }
}

export const get = <T = unknown>(path: string, options?: RequestOptions): Promise<T> => api<T>('GET', path, undefined, options)
export const post = <T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> => api<T>('POST', path, body ?? {}, options)

export const newKey = (): string => crypto.randomUUID()

export function query(values: Record<string, string | number | undefined | null>): string {
  const pairs = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')
}
