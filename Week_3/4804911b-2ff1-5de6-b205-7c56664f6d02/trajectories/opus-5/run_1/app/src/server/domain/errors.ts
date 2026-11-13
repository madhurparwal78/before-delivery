/** Every API error is produced here, in the one published shape. */
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

export function validationError(fields: Record<string, string>, message?: string): ApiError {
  const first = Object.values(fields)[0] ?? 'This value is not allowed.';
  return new ApiError(422, 'validation', message ?? first, { fields });
}

export function notFound(message = 'That is not in the programme.'): ApiError {
  return new ApiError(404, 'not_found', message);
}
