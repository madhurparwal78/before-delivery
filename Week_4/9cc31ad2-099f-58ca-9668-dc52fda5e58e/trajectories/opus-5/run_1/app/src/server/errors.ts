export interface ErrorBody {
  error: { code: string; message: string };
  fields?: Record<string, string>;
}

/** The single error shape every API error is produced through. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: { code: this.code, message: this.message } };
    if (this.fields) body.fields = this.fields;
    return body;
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
export const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'Not found.');
export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'The request could not be accepted.', fields);
export const insufficientCoins = (): ApiError =>
  new ApiError(402, 'INSUFFICIENT_COINS', 'Not enough coins.');
export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);
export const forbidden = (code: string, message: string): ApiError =>
  new ApiError(403, code, message);
export const gone = (code: string, message: string): ApiError => new ApiError(410, code, message);
export const unavailable = (code: string, message: string): ApiError =>
  new ApiError(503, code, message);
