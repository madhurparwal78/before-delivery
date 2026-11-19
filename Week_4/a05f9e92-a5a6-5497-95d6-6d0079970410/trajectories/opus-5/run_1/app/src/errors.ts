/**
 * The one published error body and the one way to build it.
 *
 *   {"error":{"code":"<code>","message":"<text>","fields":{"<field>":"<text>"}}}
 */

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'operator_only'
  | 'denied'
  | 'field_denied'
  | 'bad_credentials'
  | 'cross_origin'
  | 'too_large'
  | 'rate_limited'
  | 'field_conflict'
  | 'validation'
  | 'unknown_field'
  | 'filter_too_complex'
  | 'expression_error'
  | 'illegal_transition'
  | 'role_not_allowed'
  | 'field_required'
  | 'reopen_window_passed'
  | 'open_incidents'
  | 'fix_not_done'
  | 'freeze'
  | 'overlap'
  | 'aborted'
  | 'rule_depth'
  | 'child_failed'
  | 'cycle'
  | 'proposal_closed'
  | 'not_a_voter'
  | 'already_voted'
  | 'vote_closed'
  | 'step_not_open'
  | 'already_decided'
  | 'already_paging'
  | 'not_paged'
  | 'already_acknowledged'
  | 'idempotency_conflict'
  | 'empty_cart'
  | 'bad_type'
  | 'over_quota'
  | 'storage_unavailable'
  | 'not_stored'
  | 'not_failed'
  | 'not_complete'
  | 'already_committed'
  | 'set_already_open'
  | 'not_exported'
  | 'choice_required'
  | 'not_committed'
  | 'later_set'
  | 'nothing_to_retry'
  | 'subflow_cycle'
  | 'rule_not_found';

export interface ApiErrorExtras {
  readonly [member: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extras?: ApiErrorExtras,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): { error: Record<string, unknown> } {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.extras) Object.assign(error, this.extras);
    return { error };
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'No such record.');

export const forbidden = (): ApiError => new ApiError(403, 'forbidden', 'Your role cannot do this.');

export const operatorOnly = (): ApiError => new ApiError(403, 'operator_only', 'Only the operator can do this.');

export const validation = (message: string, fields?: Record<string, string>): ApiError =>
  new ApiError(422, 'validation', message, fields);

export const conflict = (code: ErrorCode, message: string, extras?: ApiErrorExtras): ApiError =>
  new ApiError(409, code, message, undefined, extras);

export const unprocessable = (code: ErrorCode, message: string, fields?: Record<string, string>): ApiError =>
  new ApiError(422, code, message, fields);

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');

export const unknownField = (path: string): ApiError =>
  new ApiError(422, 'unknown_field', `Unknown field "${path}".`);

export const filterTooComplex = (): ApiError =>
  new ApiError(422, 'filter_too_complex', 'This filter cannot be shown in the builder.');

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'Requests must come from Switchyard itself.');

export const tooLargeBody = (limit: number): ApiError =>
  new ApiError(413, 'too_large', `Request bodies can be at most ${limit.toLocaleString('en-US')} bytes.`);

export const rateLimited = (seconds: number): ApiError =>
  new ApiError(
    429,
    'rate_limited',
    `Too many requests. Try again in ${seconds} seconds.`,
    undefined,
    undefined,
    { 'Retry-After': String(seconds) },
  );
