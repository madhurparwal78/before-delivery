import { copy } from './copy.js';

export type ErrorFields = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: ErrorFields;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fields?: ErrorFields; headers?: Record<string, string> },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.headers = options?.headers;
  }

  body(): { error: { code: string; message: string; fields?: ErrorFields } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const notFound = (): AppError => new AppError(404, 'notFound', copy.notFound);

export const methodNotAllowed = (allow: string): AppError =>
  new AppError(405, 'methodNotAllowed', copy.notFound, { headers: { Allow: allow } });

export const bodyTooLarge = (): AppError => new AppError(413, 'bodyTooLarge', 'That file is too large.');

export const rateLimited = (message: string, retryAfterSeconds: number): AppError =>
  new AppError(429, 'rateLimited', message, { headers: { 'Retry-After': String(retryAfterSeconds) } });

export const foreignOrigin = (): AppError =>
  new AppError(403, 'foreignOrigin', 'That request came from another site.');

export const notSignedIn = (): AppError => new AppError(401, 'notSignedIn', copy.sessionEnded);

export const sessionEnded = (): AppError => new AppError(401, 'sessionEnded', copy.sessionEnded);

export const unsupportedMediaType = (): AppError =>
  new AppError(415, 'unsupportedMediaType', 'That content type is not accepted here.');

export const malformedJson = (): AppError => new AppError(400, 'malformedJson', 'That request body is not JSON.');

export const invalidFields = (fields: ErrorFields, message?: string): AppError =>
  new AppError(422, 'invalidFields', message ?? Object.values(fields)[0] ?? 'Check what you typed.', { fields });

export const invalid = (message: string, fields?: ErrorFields): AppError =>
  new AppError(422, 'invalidFields', message, fields ? { fields } : undefined);

export const conflict = (code: string, message: string): AppError => new AppError(409, code, message);

export const gone = (code: string, message: string): AppError => new AppError(410, code, message);

export const staleEdit = (message: string): AppError => new AppError(412, 'staleEdit', message);

export const providerUnavailable = (message: string, code = 'providerUnavailable'): AppError =>
  new AppError(503, code, message);

export const JSON_BODY_LIMIT = 100_000;
export const STATEMENT_FILE_LIMIT = 2_000_000;
export const PASSENGER_FILE_LIMIT = 1_000_000;
export const CUSTOMER_SHEET_LIMIT = 2_000_000;
export const PAPER_FILE_LIMIT = 5_000_000;
export const PAPER_MULTIPART_LIMIT = 5_100_000;
export const MAX_QUERY_LENGTH = 200;
export const MAX_JSON_DEPTH = 16;
