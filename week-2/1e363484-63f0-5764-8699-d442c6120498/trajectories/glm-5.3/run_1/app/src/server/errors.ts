/**
 * One error shape and the single precedence order for the whole API.
 * Transport errors are detected in the body-parsing layer; everything else
 * flows through `fail`, which preserves this module as the only place that
 * knows the shape.
 */

export type FieldErrors = Record<string, string>

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code)
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated')
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found')
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden')
}

export function crossOrigin(): ApiError {
  return new ApiError(403, 'cross_origin')
}

export function invalidJson(): ApiError {
  return new ApiError(400, 'invalid_json')
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type')
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large')
}

export function validation(errors: FieldErrors): ApiError {
  return new ApiError(422, 'validation_failed', { errors })
}

export function conflict(code: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, code, extra)
}

export function dependency(code: string): ApiError {
  return new ApiError(503, code)
}

/** Collect field errors in first-seen order and produce the single 422. */
export class Validator {
  private errors: FieldErrors = {}
  private seen = new Set<string>()

  add(field: string, message: string): void {
    if (this.seen.has(field)) return
    this.seen.add(field)
    this.errors[field] = message
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0
  }

  throwIfInvalid(): void {
    if (!this.ok) throw validation(this.errors)
  }
}
