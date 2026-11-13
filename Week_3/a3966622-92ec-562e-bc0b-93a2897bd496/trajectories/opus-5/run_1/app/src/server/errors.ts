/** Every API error is produced in the one published error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue');
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Not found');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'Not permitted for this role');
}

export function conflict(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(409, code, message, extra);
}

export function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', 'Validation failed', { errors });
}

export function versionRequired(): ApiError {
  return new ApiError(428, 'version_required', 'If-Match carrying the move version is required');
}

export function staleVersion(current: unknown): ApiError {
  return new ApiError(412, 'stale_version', 'The move changed since that version', { current });
}
