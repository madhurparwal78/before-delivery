import type { ApiError } from '../shared/api.ts'

export class ApiFail extends Error {
  constructor(readonly status: number, readonly body: ApiError) {
    super(body.message ?? body.error)
  }
}

/** A request that never got an answer (network down or aborted). */
const NOT_SAVED = 'That change was not saved. Try again.'

export function newId(): string {
  return crypto.randomUUID()
}

export async function call<T>(method: string, path: string, body?: unknown, op?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(op ? { 'X-Op-Id': op } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiFail(0, { error: 'network', message: NOT_SAVED })
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({ error: 'server_error' }))
  if (!response.ok) throw new ApiFail(response.status, payload as ApiError)
  return payload as T
}

/** The sentence to show for a failed save: the server's own copy, or the generic one for network and server errors. */
export function failureText(error: unknown): string {
  if (error instanceof ApiFail && error.status >= 400 && error.status < 500 && error.body.message) return error.body.message
  return NOT_SAVED
}
