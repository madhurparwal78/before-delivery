export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'TOTP_REQUIRED'
  | 'EMAIL_UNVERIFIED'
  | 'FORBIDDEN'
  | 'NOT_ELIGIBLE'
  | 'NOT_APPROVED'
  | 'SUSPENDED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'ARCHIVED'
  | 'REMOVED'
  | 'SLOT_TAKEN'
  | 'NAME_TAKEN'
  | 'RESERVED'
  | 'IMAGES_NOT_READY'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE';

export type FieldErrors = Record<string, string>;

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  TOTP_REQUIRED: 403,
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
};

export interface ApiErrorOptions {
  status?: number;
  retryAfter?: number;
  fields?: FieldErrors;
  current?: unknown;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfter?: number;
  readonly fields?: FieldErrors;
  readonly current?: unknown;

  constructor(code: ErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.retryAfter = options.retryAfter;
    this.fields = options.fields;
    this.current = options.current;
  }

  body(): { error: Record<string, unknown> } {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.code === 'RATE_LIMITED' && this.retryAfter !== undefined) error.retryAfter = this.retryAfter;
    if (this.fields) error.fields = this.fields;
    if (this.current !== undefined) error.current = this.current;
    return { error };
  }
}

export const errors = {
  unauthenticated: (message = 'Sign in to continue') => new ApiError('UNAUTHENTICATED', message),
  forbidden: (message = 'You cannot do that') => new ApiError('FORBIDDEN', message),
  notFound: (message = 'Not found') => new ApiError('NOT_FOUND', message),
  suspended: () => new ApiError('SUSPENDED', 'This account is suspended'),
  emailUnverified: (message: string) => new ApiError('EMAIL_UNVERIFIED', message),
  totpRequired: (message: string, status?: number) =>
    new ApiError('TOTP_REQUIRED', message, status === undefined ? {} : { status }),
  notEligible: (message: string) => new ApiError('NOT_ELIGIBLE', message),
  notApproved: (message: string) => new ApiError('NOT_APPROVED', message),
  validation: (message: string, fields?: FieldErrors, status = 422) =>
    new ApiError('VALIDATION', message, { fields, status }),
  conflict: (message: string, current?: unknown) =>
    new ApiError('CONFLICT', message, current === undefined ? {} : { current }),
  rateLimited: (message: string, retryAfter: number) => new ApiError('RATE_LIMITED', message, { retryAfter }),
  storageUnavailable: () =>
    new ApiError('STORAGE_UNAVAILABLE', 'Image uploads are unavailable right now. Your draft is kept.'),
  serviceUnavailable: (message = 'A service this request needs is unavailable') =>
    new ApiError('SERVICE_UNAVAILABLE', message),
};
