import type { Locale } from './locales.js';
import { t } from './locales.js';

export type ErrorCode =
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'body_too_large'
  | 'unknown_parameter'
  | 'idempotency_key_required'
  | 'idempotency_key_invalid'
  | 'idempotency_key_reused'
  | 'cross_origin'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'forbidden'
  | 'not_in_plan'
  | 'password_required'
  | 'wrong_password'
  | 'illegal_transition'
  | 'not_ready'
  | 'not_deletable'
  | 'quota_reached'
  | 'read_only'
  | 'visibility_conflict'
  | 'not_failed'
  | 'already_in_collection'
  | 'plan_unchanged'
  | 'edition_sold_out'
  | 'edition_unavailable'
  | 'edition_locked'
  | 'upgrade_not_possible'
  | 'nothing_to_refund'
  | 'licence_refunded'
  | 'derivatives_rebuilding'
  | 'file_too_large'
  | 'content_mismatch'
  | 'unsupported_type'
  | 'type_not_in_plan'
  | 'validation_failed'
  | 'storage_unavailable'
  | 'search_unavailable'
  | 'billing_unavailable';

export type FieldErrors = Record<string, string>;

/** The single error shape for every API error. Message is always the English copy. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: FieldErrors;
  readonly extraHeaders?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    params?: Record<string, string | number>,
    fields?: FieldErrors,
    extraHeaders?: Record<string, string>,
  ) {
    super(t('en', code, params));
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extraHeaders = extraHeaders;
  }

  localisedMessage(locale: Locale, params?: Record<string, string | number>): string {
    return t(locale, this.code, params);
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
