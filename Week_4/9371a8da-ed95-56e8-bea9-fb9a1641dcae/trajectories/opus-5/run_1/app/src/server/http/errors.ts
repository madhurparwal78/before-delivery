export type FieldErrors = Record<string, string>;

export interface ApiErrorExtras {
  errors?: FieldErrors;
  current?: unknown;
  suggestion?: unknown;
  readiness?: unknown;
  retryAfterSeconds?: number;
  status?: string;
  projectId?: string;
}

/** The one error shape of the whole API. */
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly extras: ApiErrorExtras;
  readonly headers: Record<string, string>;

  constructor(
    httpStatus: number,
    code: string,
    extras: ApiErrorExtras = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.httpStatus = httpStatus;
    this.code = code;
    this.extras = extras;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    for (const [key, value] of Object.entries(this.extras)) {
      if (value !== undefined) body[key] = value;
    }
    return body;
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const methodNotAllowed = (): ApiError => new ApiError(405, 'method_not_allowed');
export const invalid = (errors: FieldErrors): ApiError => new ApiError(422, 'invalid', { errors });
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');
export const internal = (): ApiError => new ApiError(500, 'internal');
export const conflict = (code: string, extras: ApiErrorExtras = {}): ApiError =>
  new ApiError(409, code, extras);
