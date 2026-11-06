// The error-precedence ladder: every API error leaves through one shape, and the
// ladder order is decided here.
export type ErrorCode =
  | 'not_found' | 'method_not_allowed' | 'cross_origin' | 'rate_limited'
  | 'unauthenticated' | 'session_ended' | 'access_removed'
  | 'drop_withdrawn' | 'link_revoked' | 'link_expired' | 'link_replaced' | 'link_used'
  | 'invalid_credentials' | 'forbidden' | 'too_large' | 'unsupported_media_type'
  | 'invalid_json' | 'idempotency_key_required'
  | 'idempotency_key_reused' | 'hold_expired' | 'hold_claimed' | 'sold_out'
  | 'waitlist_pending' | 'market_not_live' | 'already_claimed'
  | 'drop_locked' | 'drop_not_draft' | 'drop_not_public' | 'drop_withdrawn_already'
  | 'allocation_split' | 'allocation_exists' | 'drop_has_confirmed'
  | 'allocation_confirmed' | 'allocation_not_split' | 'allocation_empty'
  | 'price_missing' | 'contact_missing' | 'last_producer' | 'stockist_active'
  | 'preview_revoked' | 'drop_closed'
  | 'stale_version' | 'validation_failed'
  | 'billing_unavailable' | 'storage_unavailable';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  not_found: 404, method_not_allowed: 405, cross_origin: 403, rate_limited: 429,
  unauthenticated: 401, session_ended: 401, access_removed: 401,
  drop_withdrawn: 410, link_revoked: 410, link_expired: 410, link_replaced: 410, link_used: 410,
  invalid_credentials: 401, forbidden: 403, too_large: 413, unsupported_media_type: 415,
  invalid_json: 400, idempotency_key_required: 400,
  idempotency_key_reused: 409, hold_expired: 409, hold_claimed: 409, sold_out: 409,
  waitlist_pending: 409, market_not_live: 409, already_claimed: 409,
  drop_locked: 409, drop_not_draft: 409, drop_not_public: 409, drop_withdrawn_already: 409,
  allocation_split: 409, allocation_exists: 409, drop_has_confirmed: 409,
  allocation_confirmed: 409, allocation_not_split: 409, allocation_empty: 409,
  price_missing: 409, contact_missing: 409, last_producer: 409, stockist_active: 409,
  preview_revoked: 409, drop_closed: 409,
  stale_version: 412, validation_failed: 422,
  billing_unavailable: 503, storage_unavailable: 503
};

import { MESSAGES } from './copy.js';

export const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  not_found: 'Not found.',
  method_not_allowed: 'Method not allowed.',
  cross_origin: MESSAGES.crossOrigin,
  rate_limited: 'Too many requests.',
  unauthenticated: MESSAGES.unauthenticated,
  session_ended: MESSAGES.sessionEnded,
  access_removed: MESSAGES.accessRemoved,
  drop_withdrawn: 'This drop was withdrawn.',
  link_revoked: 'This preview link was revoked by the press team.',
  link_expired: 'This preview link has expired.',
  link_replaced: 'This preview link was replaced by a newer one. Check your inbox.',
  link_used: 'This link was already used.',
  invalid_credentials: "That email and password don't match.",
  forbidden: MESSAGES.forbidden,
  too_large: 'Too large.',
  unsupported_media_type: 'Unsupported media type.',
  invalid_json: 'The request body is not valid JSON.',
  idempotency_key_required: 'An Idempotency-Key header is required.',
  idempotency_key_reused: 'This idempotency key was used with a different request.',
  hold_expired: 'This hold ended. The piece has gone back to the drop.',
  hold_claimed: 'This piece is already claimed.',
  sold_out: 'Sorry — the last piece went to another shopper.',
  waitlist_pending: 'Pieces are being offered to the waitlist first. Check back shortly.',
  market_not_live: "This drop isn't live yet.",
  already_claimed: 'You already have a piece from this drop.',
  drop_locked: "This drop is live, sold out or withdrawn, so its time can't change.",
  drop_not_draft: 'This drop is already scheduled.',
  drop_not_public: 'This drop has not been published.',
  drop_withdrawn_already: 'This drop was already withdrawn.',
  allocation_split: 'The edition was already split, so requests are closed.',
  allocation_exists: 'This stockist already has an allocation for this drop.',
  drop_has_confirmed: 'An allocation of this drop is confirmed, so the edition can\u2019t be split again.',
  allocation_confirmed: 'This allocation is already confirmed.',
  allocation_not_split: 'This allocation has not been split yet.',
  allocation_empty: 'Allocate at least one piece before confirming.',
  price_missing: 'No wholesale price is in force for a line.',
  contact_missing: 'Add a contact email before confirming.',
  last_producer: 'A workspace needs at least one launch producer.',
  stockist_active: 'This stockist is not archived.',
  preview_revoked: 'This preview is revoked. Send a new preview instead.',
  drop_closed: 'This drop is sold out.',
  stale_version: 'Someone else saved a newer version.',
  validation_failed: 'Validation failed.',
  billing_unavailable: 'Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly.',
  storage_unavailable: 'Image storage is unavailable right now. Nothing was uploaded. Try again shortly.'
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  fields?: Record<string, string>;
  savedBy?: string;
  savedAt?: string;
  current?: unknown;
  claimedAt?: string;
  retryAfterSeconds?: number;
  extra?: Record<string, string>;

  constructor(code: ErrorCode, opts: {
    fields?: Record<string, string>;
    savedBy?: string; savedAt?: string; current?: unknown;
    claimedAt?: string; retryAfterSeconds?: number;
  } = {}) {
    super(MESSAGE_BY_CODE[code]);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = opts.fields;
    this.savedBy = opts.savedBy;
    this.savedAt = opts.savedAt;
    this.current = opts.current;
    this.claimedAt = opts.claimedAt;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = {
    error: { code: err.code, message: err.message }
  };
  if (err.fields && Object.keys(err.fields).length > 0) {
    (body.error as Record<string, unknown>).fields = err.fields;
  }
  if (err.savedBy !== undefined) {
    (body.error as Record<string, unknown>).savedBy = err.savedBy;
    (body.error as Record<string, unknown>).savedAt = err.savedAt;
    (body.error as Record<string, unknown>).current = err.current;
  }
  if (err.claimedAt !== undefined) {
    (body.error as Record<string, unknown>).claimedAt = err.claimedAt;
  }
  if (err.retryAfterSeconds !== undefined) {
    (body.error as Record<string, unknown>).retryAfterSeconds = err.retryAfterSeconds;
  }
  return body;
}

export function jsonBodyBytes(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj));
}

// Bodies for not_found are the same bytes everywhere.
export const NOT_FOUND_BODY = jsonBodyBytes({ error: { code: 'not_found', message: MESSAGE_BY_CODE.not_found } });
