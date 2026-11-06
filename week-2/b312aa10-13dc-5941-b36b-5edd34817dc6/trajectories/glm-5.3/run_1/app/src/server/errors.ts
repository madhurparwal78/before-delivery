export type ErrorCode =
  | 'bad_request'
  | 'idempotency_key_required'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'cross_origin'
  | 'not_found'
  | 'read_only'
  | 'block_taken'
  | 'invalid_transition'
  | 'document_superseded'
  | 'hold_expired'
  | 'idempotency_key_reused'
  | 'month_closed'
  | 'billing_pending'
  | 'billing_mismatch'
  | 'rate_version_exists'
  | 'link_expired'
  | 'link_revoked'
  | 'stale_version'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unsupported_file_type'
  | 'validation_failed'
  | 'rate_limited'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'internal';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  idempotency_key_required: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  not_found: 404,
  read_only: 405,
  block_taken: 409,
  invalid_transition: 409,
  document_superseded: 409,
  hold_expired: 409,
  idempotency_key_reused: 409,
  month_closed: 409,
  billing_pending: 409,
  billing_mismatch: 409,
  rate_version_exists: 409,
  link_expired: 410,
  link_revoked: 410,
  stale_version: 412,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unsupported_file_type: 415,
  validation_failed: 422,
  rate_limited: 429,
  billing_unavailable: 503,
  storage_unavailable: 503,
  internal: 500,
};

export interface MonthNameable {
  monthName?: string;
}

export const statusWord = (status: string): string =>
  ({
    held: 'Held',
    confirmed: 'Confirmed',
    checked_in: 'Checked in',
    completed: 'Completed',
    no_show: 'No-show',
    cancelled_free: 'Cancelled',
    cancelled_late: 'Late cancel',
    expired: 'Expired',
  })[status] ?? 'Confirmed';

export const documentStatusWord = (status: string): string =>
  ({
    submitted: 'Submitted',
    approved: 'Approved',
    expiring: 'Expiring',
    expired: 'Expired',
    superseded: 'Superseded',
  })[status] ?? 'Submitted';

/**
 * The published copy for each error code. Placeholders are filled by callers
 * that pass a `fill` function; this is the one place the copy lives.
 */
export function errorCopy(code: ErrorCode, fill: (name: string) => string = (n) => ''): string {
  switch (code) {
    case 'bad_request':
      return 'The request body is not valid JSON.';
    case 'idempotency_key_required':
      return 'Send an Idempotency-Key header of 8 to 128 letters, digits, hyphens or underscores.';
    case 'unauthenticated':
      return 'Sign in to continue.';
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'forbidden':
      return 'Your role cannot do that.';
    case 'cross_origin':
      return 'Requests from other sites are refused.';
    case 'not_found':
      return 'That was not found.';
    case 'read_only':
      return 'Inspector links are read-only.';
    case 'block_taken':
      return `${fill('station')} ${fill('start')} block was taken.`;
    case 'invalid_transition':
      return `That action is not available for a ${fill('statusWord')} block.`;
    case 'document_superseded':
      return `A newer ${fill('documentType')} from ${fill('business')} is waiting. Approve that one instead.`;
    case 'hold_expired':
      return `Your hold on ${fill('blockLabel')} expired.`;
    case 'idempotency_key_reused':
      return 'This request was already used for something else. Reload and try again.';
    case 'month_closed':
      return `${fill('monthName')} is closed.`;
    case 'billing_pending':
      return 'Some charges are still waiting for billing. Try again once they are recorded.';
    case 'billing_mismatch':
      return `Kill Bill's draft for ${fill('business')} does not match Lineboard. The month stays open.`;
    case 'rate_version_exists':
      return `A rate change for ${fill('station')} already starts ${fill('effective')}.`;
    case 'link_expired':
      return 'This link has expired.';
    case 'link_revoked':
      return 'This link is no longer active.';
    case 'stale_version':
      return {
        move: 'This block changed since you picked it up. The board now shows the latest version.',
        kitchen: 'Kitchen rules changed since you opened Settings. The latest rules are shown.',
        document: 'This document changed since you opened Documents. The latest version is shown.',
      }[fill('action') as 'move' | 'kitchen' | 'document'] ??
        'This block changed since you picked it up. The board now shows the latest version.';
    case 'payload_too_large':
      return 'This file is too large.';
    case 'unsupported_media_type':
      return 'Send JSON with Content-Type application/json.';
    case 'unsupported_file_type':
      return 'Upload a PDF, PNG or JPEG file.';
    case 'validation_failed':
      return 'Check the highlighted fields.';
    case 'rate_limited':
      return `Too many sign-in attempts. Try again in ${fill('minutes')} ${fill('minutes') === '1' ? 'minute' : 'minutes'}.`;
    case 'billing_unavailable':
      return 'Billing is unavailable. The month stays open; try again when billing is back.';
    case 'storage_unavailable':
      return fill('storageKind') === 'download'
        ? 'Document storage is unavailable. Try again shortly.'
        : 'Document storage is unavailable. Your file was not saved; try again shortly.';
    case 'internal':
      return 'Lineboard hit an unexpected problem. Try again.';
  }
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}, fill?: (name: string) => string, message?: string) {
    super(message ?? errorCopy(code, fill));
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.extra = extra;
  }
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m - 1]} ${y}`;
}
