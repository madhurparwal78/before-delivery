import type { ApiErrorBody } from '../shared/domain.ts'

/** An answer from the server that is not a success, in the published error shape. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message)
  }

  /** True for a failure of transport or a 5xx answer, which the editor retries. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500
  }
}

const NETWORK: ApiErrorBody = { error: 'network', message: 'The studio could not be reached.' }

async function failure(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null
  return new ApiFailure(response.status, body ?? { error: 'unknown', message: 'Something went wrong.' })
}

/** JSON in, JSON out, same origin; non-success answers throw an ApiFailure. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiFailure(0, NETWORK)
  }
  if (!response.ok) throw await failure(response)
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

/** Raw bytes in (the DDL import), JSON out. */
export async function apiBytes<T>(method: string, path: string, body: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { method, headers: { 'Content-Type': 'application/sql' }, body, credentials: 'same-origin' })
  } catch {
    throw new ApiFailure(0, NETWORK)
  }
  if (!response.ok) throw await failure(response)
  return (await response.json()) as T
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiFailure && error.status === 422 ? (error.body.fields ?? {}) : {}
}
