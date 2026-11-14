import { M } from "../shared/messages.js";
import type { ErrorItem } from "../shared/types.js";

const STATUS = {
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
  VALIDATION_FAILED: 422,
  SIGN_IN_FAILED: 422,
  CHANGE_INVALID: 422,
  DUPLICATE_KEY: 422,
  FORMULA_INVALID: 422,
  FORMULA_PROBLEMS: 422,
  ANSWER_INVALID: 422,
  ANSWERS_INVALID: 422,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  FILE_TYPE: 422,
  FILE_TOO_LARGE: 422,
  SEED_INVALID: 422,
  UPLOAD_FAILED: 503,
  EXPORT_FAILED: 503,
} as const;

export type ErrorCode = keyof typeof STATUS;

const DEFAULT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  BODY_TOO_LARGE: M.bodyTooLarge,
  SIGN_IN_REQUIRED: M.signInRequired,
  NOT_FOUND: M.notFound,
  LINK_EXPIRED: M.linkExpired,
  ALREADY_SENT: M.alreadySent,
  RATE_LIMITED: M.rateLimited,
  DRAFT_MOVED: M.draftMoved,
  ALREADY_SUBMITTED: M.alreadySent,
  IDEMPOTENCY_CONFLICT: M.idempotencyConflict,
  FORM_OPEN: M.formOpen,
  FORM_DRAFT: M.formDraft,
  VALIDATION_FAILED: M.validationFailed,
  SIGN_IN_FAILED: M.signInFailed,
  ANSWER_INVALID: M.answerInvalid,
  DUPLICATE_KEY: M.duplicateKey,
  IDEMPOTENCY_KEY_REQUIRED: M.idempotencyKeyRequired,
  EXPORT_FAILED: M.exportFailed,
};

/** The one API error: every refusal is thrown as this and written in the one error shape. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly items?: ErrorItem[],
  ) {
    super(message ?? DEFAULT_MESSAGE[code] ?? code);
    this.status = STATUS[code];
  }

  body(): { error: { code: string; message: string; items?: ErrorItem[] } } {
    return { error: { code: this.code, message: this.message, ...(this.items ? { items: this.items } : {}) } };
  }
}

export const notFound = (): ApiError => new ApiError("NOT_FOUND");

export function validationFailed(items: ErrorItem[]): ApiError {
  return new ApiError("VALIDATION_FAILED", M.validationFailed, items);
}
