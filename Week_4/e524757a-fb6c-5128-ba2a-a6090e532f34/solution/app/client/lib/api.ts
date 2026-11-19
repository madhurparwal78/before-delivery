/** Same-origin JSON calls. A refusal arrives as an `ApiFailure` carrying the server's code and exact message. */

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly headers: Headers) {
    super(message)
  }
}

/** The request never got an answer. */
export class NetworkFailure extends Error {}

const NETWORK_MESSAGE = "Couldn't reach the islands. Try again."

export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined || body instanceof FormData ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch {
    throw new NetworkFailure(NETWORK_MESSAGE)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new ApiFailure(response.status, data.error, data.message, response.headers)
  return data as T
}

export const get = <T>(path: string): Promise<T> => call<T>('GET', path)
export const post = <T>(path: string, body: unknown = {}, headers?: Record<string, string>): Promise<T> => call<T>('POST', path, body, headers)
export const put = <T>(path: string, body: unknown = {}, headers?: Record<string, string>): Promise<T> => call<T>('PUT', path, body, headers)
export const del = <T>(path: string): Promise<T> => call<T>('DELETE', path)

/** The message to show for any failure of a call: the server's catalogue copy, or the network line. */
export function failureMessage(error: unknown): string {
  if (error instanceof ApiFailure || error instanceof NetworkFailure) return error.message
  throw error
}
