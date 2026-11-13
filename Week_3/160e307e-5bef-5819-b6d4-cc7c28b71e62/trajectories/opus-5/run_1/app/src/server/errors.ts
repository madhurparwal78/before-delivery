/** Every API error uses the one published `{"error":"<CODE>"}` shape plus named extras. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export const notFound = (code = 'NOT_FOUND'): ApiError => new ApiError(404, code);
export const forbidden = (code: string): ApiError => new ApiError(403, code);
export const conflict = (code: string): ApiError => new ApiError(409, code);
export const gone = (code: string): ApiError => new ApiError(410, code);
export const unprocessable = (code: string, extra?: Record<string, unknown>): ApiError =>
  new ApiError(422, code, extra);
export const rateLimited = (): ApiError => new ApiError(429, 'RATE_LIMITED');
