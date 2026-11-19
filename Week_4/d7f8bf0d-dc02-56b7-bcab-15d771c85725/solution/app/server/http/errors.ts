import type { ApiErrorBody, Finding } from '../../shared/domain'

// Every API error is built here: one shape, one set of copy.

interface ErrorExtras {
  fields?: Record<string, string>
  current_revision?: number
  [key: string]: unknown
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extras: ErrorExtras = {},
  ) {
    super(message)
  }

  get body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extras } }
  }
}

export const sessionRequired = (): ApiError => new ApiError(401, 'session_required', 'Your sign-in has ended. Sign in to carry on.')
export const invalidCredentials = (): ApiError => new ApiError(401, 'invalid_credentials', 'That email and password do not match.')
export const forbidden = (): ApiError => new ApiError(403, 'forbidden', 'You do not have access to this.')
export const notFound = (): ApiError => new ApiError(404, 'not_found', 'That item is not in this workspace.')
export const keyRequired = (): ApiError => new ApiError(422, 'idempotency_key_required', 'This request needs a key.')
export const keyReused = (): ApiError => new ApiError(422, 'idempotency_key_reused', 'This key was already used with different details.')
export const staleRevision = (currentRevision: number): ApiError =>
  new ApiError(409, 'stale_revision', 'Someone changed this first. Review the latest and try again.', { current_revision: currentRevision })
export const valkeyUnavailable = (): ApiError =>
  new ApiError(503, 'valkey_unavailable', 'Live updates are paused. Sessions are held at their last committed tick.')
export const invalidFields = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'invalid_fields', 'Check the highlighted fields.', { fields })
export const bodyTooLarge = (): ApiError => new ApiError(413, 'body_too_large', 'That request is too large.')
export const badJson = (): ApiError => new ApiError(400, 'bad_json', 'That request could not be read.')
export const badContentType = (): ApiError => new ApiError(415, 'bad_content_type', 'Send JSON.')
export const instancesRestarting = (): ApiError =>
  new ApiError(503, 'instances_restarting', 'Gandyboard is restarting. Try again in a moment.')
export const rule = (code: string, message: string, extras: ErrorExtras = {}): ApiError => new ApiError(422, code, message, extras)
export const serverError = (): ApiError => new ApiError(500, 'server_error', 'Something went wrong. Try again.')
export const pieceRefused = (findings: Finding[]): ApiError => new ApiError(422, 'validation_failed', 'This piece breaks the club standard.', { findings })
export const versionRefused = (findings: Finding[]): ApiError => new ApiError(422, 'validation_failed', 'This version breaks the club standard.', { findings })
export const openEndTaken = (label: string, takenBy: string, currentRevision: number, pieceId: string): ApiError =>
  new ApiError(409, 'open_end_taken', `Open end ${label} was just extended by ${takenBy}. Nothing was changed.`, { current_revision: currentRevision, piece_id: pieceId })
export const routeConflict = (message: string, extras: ErrorExtras): ApiError => new ApiError(422, 'route_conflict', message, extras)
