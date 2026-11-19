import type { ApiErrorBody } from '../../shared/domain'

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly body: ApiErrorBody['error'] | null = null,
  ) {
    super(message)
  }
}

export function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

// A 401 on any read or write opens `Sign in again`; every pending request waits on the one shared sign-in and is then
// sent once more with its original key and body.
let reauth: () => Promise<void> = () => Promise.resolve()
let waiting: Promise<void> | null = null

export function onSessionEnded(handler: () => Promise<void>): void {
  reauth = handler
}

export function ensureSignedIn(): Promise<void> {
  waiting ??= reauth().finally(() => {
    waiting = null
  })
  return waiting
}

async function parse(answer: Response): Promise<unknown> {
  if (answer.status === 204) return undefined
  const text = await answer.text()
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Requests in flight, so the live streams can wait until the page has settled before they hold a connection open.
let inFlight = 0
const QUIET_MS = 1000
const QUIET_CEILING_MS = 6000
const QUIET_STEP_MS = 100

// Quiet is a whole window with no request open and no resource finishing, fonts and scripts as well as API reads. It
// counts steps rather than reading a clock, so a device clock that jumps cannot end the window early.
export async function whenQuiet(): Promise<void> {
  if (document.readyState !== 'complete') await new Promise<void>(resolve => window.addEventListener('load', () => resolve(), { once: true }))
  let finished = -1
  let calm = 0
  for (let waited = 0; calm < QUIET_MS && waited < QUIET_CEILING_MS; waited += QUIET_STEP_MS) {
    await new Promise<void>(resolve => setTimeout(resolve, QUIET_STEP_MS))
    const now = performance.getEntriesByType('resource').length
    calm = now === finished && inFlight === 0 && document.fonts.status === 'loaded' ? calm + QUIET_STEP_MS : 0
    finished = now
  }
}

async function send<T>(method: string, path: string, body: unknown, key: string | null): Promise<T> {
  inFlight += 1
  try {
    return await sendOnce<T>(method, path, body, key)
  } finally {
    inFlight -= 1
  }
}

async function sendOnce<T>(method: string, path: string, body: unknown, key: string | null): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (key !== null) headers['Idempotency-Key'] = key
  let answer: Response
  try {
    answer = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' })
  } catch {
    throw new ApiFailure(0, 'network', 'The connection dropped. Try again.')
  }
  const parsed = await parse(answer)
  if (answer.ok) return parsed as T
  const error = (parsed as ApiErrorBody | undefined)?.error
  if (answer.status === 401 && error?.code === 'session_required' && !path.startsWith('/api/auth/')) {
    await ensureSignedIn()
    return send<T>(method, path, body, key)
  }
  throw new ApiFailure(answer.status, error?.code ?? 'server_error', error?.message ?? 'Something went wrong. Try again.', error?.fields ?? {}, error ?? null)
}

export const apiGet = <T>(path: string): Promise<T> => send<T>('GET', path, undefined, null)

// Writes carry one key per gesture; pass the same key to repeat the same gesture.
export const apiWrite = <T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, key: string = newKey()): Promise<T> =>
  send<T>(method, path, body, key)

// Writes the brief marks "no key": sign-in, walkthrough, check layout, route preview.
export const apiPlain = <T>(method: 'POST', path: string, body: unknown): Promise<T> => send<T>(method, path, body, null)
