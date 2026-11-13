// Every API failure is turned into the one error body here, in one place.

import type { ApiErrorBody, Author } from '../shared/protocol.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Partial<Omit<ApiErrorBody, 'error' | 'message'>> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Storage is unavailable.', { cause })
  }
}

export class DatabaseUnavailable extends Error {
  constructor(cause?: unknown) {
    super('The score database is unavailable.', { cause })
  }
}

export const unauthorized = () => new ApiError(401, 'unauthorized', 'Open your seat link again.')
export const notFound = () => new ApiError(404, 'not_found', 'Not found.')
export const forbidden = (message = 'Your role cannot do this.') => new ApiError(403, 'forbidden', message)
export const ownStavesOnly = () => forbidden('You can edit only your own staves.')
export const validation = (errors: Record<string, string>) =>
  new ApiError(422, 'validation', 'Check the highlighted fields.', { errors })
export const staffHeld = (holder: Author, names: string[], staffIds: string[]) =>
  new ApiError(423, 'staff_held', `${holder.name} is holding ${names.join(', ')}.`, { heldBy: holder, staffIds })
export const holdRequired = () => new ApiError(409, 'hold_required', 'Hold this staff before changing it.')
export const notConnected = () => new ApiError(409, 'not_connected', 'Open the live session before holding staves.')
export const rateLimited = (seconds: number) =>
  new ApiError(429, 'rate_limited', 'Too many edits at once. Waiting to send the rest.', { retryAfterSeconds: seconds }, { 'Retry-After': String(seconds) })

export function toResponse(error: unknown): { status: number; body: ApiErrorBody; headers: Record<string, string> } {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: error.code, message: error.message, ...error.extra }, headers: error.headers }
  }
  if (error instanceof StorageUnavailable) {
    return { status: 503, body: { error: 'storage_unavailable', message: 'Storage is unavailable. Nothing was saved.' }, headers: {} }
  }
  if (error instanceof DatabaseUnavailable) {
    return { status: 503, body: { error: 'database_unavailable', message: 'The score database is unavailable. Try again shortly.' }, headers: {} }
  }
  console.error(error)
  return { status: 500, body: { error: 'internal', message: 'Something went wrong on our side.' }, headers: {} }
}
