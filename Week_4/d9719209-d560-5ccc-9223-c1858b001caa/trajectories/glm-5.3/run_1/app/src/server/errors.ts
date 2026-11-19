/* Error codes, statuses, the single shared error body shape, and precedence.
   Every error response in the API is built here; no endpoint invents a format. */
import type { ServerResponse } from 'node:http';

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

const STATUSES: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  TOTP_REQUIRED: 401,
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

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    retryAfter?: number;
    fields?: Record<string, string>;
    current?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfter?: number;
  readonly current?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, opts?: { fields?: Record<string, string>; retryAfter?: number; current?: Record<string, unknown>; status?: number }) {
    super(message);
    this.code = code;
    this.status = opts?.status ?? STATUSES[code];
    this.fields = opts?.fields;
    this.retryAfter = opts?.retryAfter;
    this.current = opts?.current;
  }

  body(): ErrorBody {
    const err: ErrorBody['error'] = { code: this.code, message: this.message };
    if (this.retryAfter !== undefined) err.retryAfter = this.retryAfter;
    if (this.fields !== undefined) err.fields = this.fields;
    if (this.current !== undefined) err.current = this.current;
    return { error: err };
  }
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError('VALIDATION', 'Check the fields', { fields });
}

export const messages = {
  chooseReason: 'Choose a reason',
  addPublicNoteForOther: 'Add a public note for Other',
  anotherModeratorActedFirst: 'Another moderator acted first',
  invalidCursor: 'This cursor is not valid',
  invalidSort: 'This sort is not valid',
  idempotencyRequired: 'Idempotency-Key header is required',
  idempotencyConflict: 'This key was already used for a different request',
  notFound: 'Not found',
  unauthenticated: 'Sign in to continue',
  suspended: 'This account is suspended',
  totpRequired: 'Enter the 6-digit code from your authenticator app',
  codeNoMatch: "That code didn't match",
  emailUnverified: 'Verify your email to vote',
  voteSlowDown: 'Slow down — try again in ',
  voteNoSave: "Vote didn't save",
  signToVote: 'Sign in to vote',
  removePost: 'Post removed',
} as const;

export function notFound(): ApiError {
  return new ApiError('NOT_FOUND', messages.notFound);
}

export function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export function errorJson(res: ServerResponse, err: ApiError, extraHeaders?: Record<string, string>): void {
  const headers: Record<string, string> = { ...extraHeaders };
  if (err.retryAfter !== undefined) headers['Retry-After'] = String(err.retryAfter);
  json(res, err.status, err.body(), headers);
}
