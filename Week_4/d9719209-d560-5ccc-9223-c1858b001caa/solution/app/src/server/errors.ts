export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  EMAIL_UNVERIFIED: 403,
  FORBIDDEN: 403,
  NOT_ELIGIBLE: 403,
  NOT_APPROVED: 403,
  SUSPENDED: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  LOCKED: 409,
  ARCHIVED: 409,
  REMOVED: 409,
  SLOT_TAKEN: 409,
  NAME_TAKEN: 409,
  RESERVED: 409,
  IMAGES_NOT_READY: 409,
  CONFLICT: 409,
  VALIDATION: 422,
  STORAGE_UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS | 'TOTP_REQUIRED';

export interface ErrorDetail {
  retryAfter?: number;
  fields?: Record<string, string>;
  current?: Record<string, unknown>;
  status?: number;
}

/** The one error type every handler throws; the HTTP layer renders it with the shared body shape. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: ErrorDetail;

  constructor(code: ErrorCode, message: string, detail: ErrorDetail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.status = detail.status ?? (code === 'TOTP_REQUIRED' ? 403 : ERROR_STATUS[code]);
  }
}

export function errorBody(error: AppError): { error: Record<string, unknown> } {
  const { retryAfter, fields, current } = error.detail;
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      ...(fields ? { fields } : {}),
      ...(current ? { current } : {}),
    },
  };
}

export const notFound = (what = 'Not found'): AppError => new AppError('NOT_FOUND', what);
export const forbidden = (message = 'You do not have access to this'): AppError => new AppError('FORBIDDEN', message);
export const unauthenticated = (message = 'Sign in to continue'): AppError => new AppError('UNAUTHENTICATED', message);
export const conflict = (message: string, current?: Record<string, unknown>): AppError =>
  new AppError('CONFLICT', message, current ? { current } : {});
export const validation = (fields: Record<string, string>, message = 'Check the highlighted fields'): AppError =>
  new AppError('VALIDATION', message, { fields });
