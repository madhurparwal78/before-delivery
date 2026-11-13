export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, message: string, options?: { fields?: Record<string, string>; headers?: Record<string, string> }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.headers = options?.headers;
  }

  body(): Record<string, unknown> {
    const payload: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields) payload.errors = this.fields;
    return payload;
  }

  static validation(fields: Record<string, string>): ApiError {
    return new ApiError(422, 'validation_failed', 'Check these fields', { fields });
  }

  static unauthenticated(): ApiError {
    return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }

  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static storeUnavailable(): ApiError {
    return new ApiError(503, 'store_unavailable', 'Could not reach the table');
  }
}
