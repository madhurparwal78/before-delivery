import type { ApiError, ErrorItem } from '../shared/types.ts';
import {
  M02, M19, M20, M21, M32, M33, M34, M37, M43_44, M62, M64, M65, M66, M67, M68, M69, M70, M71, M72, M73, M85, M86, type ErrorCode,
} from '../shared/messages.ts';

// The one error shape and its HTTP status for every code (brief: API).
const STATUS: Record<ErrorCode, number> = {
  BODY_TOO_LARGE: 413,
  SIGN_IN_REQUIRED: 401,
  NOT_FOUND: 404,
  LINK_EXPIRED: 404,
  ALREADY_SENT: 404,
  RATE_LIMITED: 429,
  FORM_CLOSED: 409,
  DRAFT_MOVED: 409,
  ALREADY_SUBMITTED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FORM_OPEN: 409,
  FORM_DRAFT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  VALIDATION_FAILED: 422,
  SIGN_IN_FAILED: 422,
  ANSWER_INVALID: 422,
  ANSWERS_INVALID: 422,
  CHANGE_INVALID: 422,
  DUPLICATE_KEY: 422,
  FORMULA_INVALID: 422,
  FORMULA_PROBLEMS: 422,
  SEED_INVALID: 422,
  FILE_TYPE: 422,
  FILE_TOO_LARGE: 422,
  UPLOAD_FAILED: 503,
  EXPORT_FAILED: 503,
  INTERNAL_ERROR: 500,
};

export class Failure extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly items?: ErrorItem[]) {
    super(message);
    this.status = STATUS[code];
  }
  toBody(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.items ? { items: this.items } : {}) } };
  }
}

export const internalError = (): Failure => new Failure('INTERNAL_ERROR', 'Something went wrong.');
export const notFound = (): Failure => new Failure('NOT_FOUND', M65);
export const signInRequired = (): Failure => new Failure('SIGN_IN_REQUIRED', M67);
export const rateLimited = (): Failure => new Failure('RATE_LIMITED', M66);
export const bodyTooLarge = (): Failure => new Failure('BODY_TOO_LARGE', M71);
export const answerInvalid = (key: string): Failure => new Failure('ANSWER_INVALID', M70, [{ key, message: M70 }]);
export const draftMoved = (): Failure => new Failure('DRAFT_MOVED', M21);
export const alreadySubmitted = (): Failure => new Failure('ALREADY_SUBMITTED', M20);
export const linkExpired = (): Failure => new Failure('LINK_EXPIRED', M19);
export const alreadySent = (): Failure => new Failure('ALREADY_SENT', M20);
export const idempotencyConflict = (): Failure => new Failure('IDEMPOTENCY_CONFLICT', M69);
export const idempotencyKeyRequired = (): Failure => new Failure('IDEMPOTENCY_KEY_REQUIRED', M86);
export const formOpen = (): Failure => new Failure('FORM_OPEN', M72);
export const formDraft = (): Failure => new Failure('FORM_DRAFT', M73);
export const duplicateKey = (): Failure => new Failure('DUPLICATE_KEY', M37);
export const exportFailed = (): Failure => new Failure('EXPORT_FAILED', M62);
export const changeDropped = (): Failure => new Failure('NOT_FOUND', M85);
export const signInFailed = (): Failure => new Failure('SIGN_IN_FAILED', M64);
export const changeInvalid = (message: string): Failure => new Failure('CHANGE_INVALID', message);
export const formulaInvalid = (key: string, message: string): Failure => new Failure('FORMULA_INVALID', message, [{ key, message }]);
export const formulaProblems = (problems: ErrorItem[]): Failure => new Failure('FORMULA_PROBLEMS', M43_44(problems.length), problems);
export const answersInvalid = (errors: ErrorItem[]): Failure => new Failure('ANSWERS_INVALID', M02(errors.length), errors);
export const formClosed = (text: string): Failure => new Failure('FORM_CLOSED', text);
export const fileType = (label: string, types: string): Failure => new Failure('FILE_TYPE', M32(label, types));
export const fileTooLarge = (label: string, megabytes: string): Failure => new Failure('FILE_TOO_LARGE', M33(label, megabytes));
export const uploadFailed = (name: string): Failure => new Failure('UPLOAD_FAILED', M34(name));
export const seedInvalid = (message: string): Failure => new Failure('SEED_INVALID', message);
export const validationFailed = (items: ErrorItem[]): Failure => new Failure('VALIDATION_FAILED', M68, items);
