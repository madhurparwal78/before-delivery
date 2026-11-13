import { STORAGE_DOWN } from '../shared/copy.ts'
import type { ApiErrorBody } from '../shared/types.ts'
import { config } from './config.ts'

const STATUS = {
  too_large: 413,
  no_player: 401,
  rate_limited: 429,
  not_found: 404,
  link_off: 410,
  link_replaced: 410,
  not_host: 403,
  watching: 403,
  game_full: 409,
  game_solved: 409,
  square_locked: 409,
  link_already_off: 409,
  op_id_reused: 409,
  race_started: 409,
  race_not_started: 409,
  invalid: 422,
  invalid_puzzle: 422,
  storage_unavailable: 503,
} as const

type ErrorCode = keyof typeof STATUS

const MESSAGE: Record<ErrorCode, string> = {
  too_large: 'The request body is too large.',
  no_player: 'Choose a display name first.',
  rate_limited: 'Slow down a little.',
  not_found: 'This game does not exist or is not shared with you.',
  link_off: 'This game link was turned off.',
  link_replaced: 'This game link was replaced. Ask the host for the new one.',
  not_host: 'Only the host can do that.',
  watching: 'You are watching this race.',
  game_full: 'Game is full.',
  game_solved: 'This puzzle is already solved.',
  square_locked: 'That square is locked.',
  link_already_off: 'This game link is already turned off.',
  op_id_reused: 'That operation id was already used for a different write.',
  race_started: 'The race has already started.',
  race_not_started: 'The race has not started.',
  invalid: 'The request is not valid.',
  invalid_puzzle: 'This puzzle has problems.',
  storage_unavailable: STORAGE_DOWN,
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly fields?: Record<string, string>
  readonly lines?: string[]

  constructor(code: ErrorCode, detail: { message?: string; fields?: Record<string, string>; lines?: string[] } = {}) {
    super(detail.message ?? MESSAGE[code])
    this.code = code
    this.fields = detail.fields
    this.lines = detail.lines
  }

  get status(): number {
    return STATUS[this.code]
  }
}

export const uploadTooLarge = (): ApiError => new ApiError('too_large', { message: `This file is larger than ${config.uploadMaxBytes} bytes.` })

export const invalid = (fields: Record<string, string>): ApiError => new ApiError('invalid', { fields })

/** The one error shape, for HTTP bodies and live `error` messages alike. */
export function errorBody(error: ApiError): ApiErrorBody {
  return { error: error.code, message: error.message, ...(error.fields && { fields: error.fields }), ...(error.lines && { lines: error.lines }) }
}
