// The browser's side of the API: JSON requests with the seat token kept for this tab.

import type { ApiErrorBody } from '../shared/protocol.js'

const SEAT_KEY = 'fairline.seat'

export const seatToken = (): string | null => sessionStorage.getItem(SEAT_KEY)
export const keepSeatToken = (token: string): void => sessionStorage.setItem(SEAT_KEY, token)

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody, readonly retryAfter: number | null) {
    super(body.message)
  }

  /** The most specific message the API gave: the first field error, else the summary. */
  get detail(): string {
    return Object.values(this.body.errors ?? {})[0] ?? this.body.message
  }
}

/** The request never reached the server (offline, reset). */
export class NetworkFailure extends Error {}

export async function api<T>(method: string, path: string, body?: unknown, options: { token?: string | null; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const token = options.token === undefined ? seatToken() : options.token
  const headers: Record<string, string> = { ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(path, { method, headers, body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
  } catch (error) {
    throw new NetworkFailure(String(error))
  }
  if (response.status === 204) return undefined as T
  const parsed: unknown = await response.json().catch(() => ({ error: 'unknown', message: 'The server sent an unreadable reply.' }))
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody, Number(response.headers.get('Retry-After')) || null)
  return parsed as T
}

export async function downloadPdf(path: string): Promise<void> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${seatToken() ?? ''}` } })
  if (!response.ok) throw new ApiFailure(response.status, (await response.json()) as ApiErrorBody, null)
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1]
  const name = encoded ? decodeURIComponent(encoded) : 'part.pdf'
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
