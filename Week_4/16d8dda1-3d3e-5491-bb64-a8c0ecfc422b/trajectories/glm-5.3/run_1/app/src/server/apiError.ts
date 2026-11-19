import { pool } from './db.js'

// One consistent error shape and the published order of checks: 401, 404,
// 403, 409, 413, 415, 422, 503 (the API error order).

export class ApiError extends Error {
  constructor(
    public status: number,
    public text: string
  ) {
    super(text)
  }
}

export const NOT_SIGNED_IN = new ApiError(401, 'Sign in first.')
export const NOT_FOUND = new ApiError(404, 'Not found.')
export const ROLE_REFUSAL = new ApiError(403, 'Only the teacher can do that.')
export const CROSS_SITE = new ApiError(403, 'Cross-site requests are refused.')
export const TOO_LARGE = new ApiError(413, 'That request is too large.')
export const SEND_JSON = new ApiError(415, 'Send JSON.')
export const JSON_BAD = new ApiError(400, 'Send JSON.')

export function stateConflict(state: string): ApiError {
  return new ApiError(409, `That can't be done while the session is ${state}.`)
}

export async function nextId(prefix: string): Promise<string> {
  const { id } = await import('./ids.js')
  return id(prefix)
}

export async function one<T>(query: Promise<{ rows: T[] }>): Promise<T | null> {
  const answer = await query
  return answer.rows[0] ?? null
}

export { pool }
