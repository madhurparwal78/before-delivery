import type { RuleCode, ShapeRuleCode } from '../shared/domain';

export type ErrorCode =
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'cross_origin'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rules_broken'
  | 'hit_changed'
  | 'email_taken'
  | 'bad_credentials'
  | 'accounts_unavailable'
  | 'inbox_unavailable'
  | 'squad_exists'
  | 'no_squad'
  | 'gameweek_locked'
  | 'gameweek_not_open'
  | 'gameweek_not_locked'
  | 'gameweek_not_live'
  | 'gameweek_not_live_yet'
  | 'gameweek_illegal_transition'
  | 'gameweek_concurrent'
  | 'chip_already_this_gameweek'
  | 'chip_used'
  | 'free_hit_back_to_back'
  | 'chip_after_transfers'
  | 'chip_locked_in'
  | 'idempotency_key_reused'
  | 'league_not_found'
  | 'already_member'
  | 'run_date_used'
  | 'prices_frozen'
  | 'event_id_conflict'
  | 'receipt_pending'
  | 'storage_unavailable';

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  rules?: { code: string; message: string }[];
  hit_points?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, error: ErrorCode, message: string, extra?: Omit<ApiErrorBody, 'error' | 'message'>) {
    super(message);
    this.status = status;
    this.body = { error, message, ...extra };
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', 'Some fields need a second look.', { fields });
}

export function rulesBrokenError(rules: { code: RuleCode | ShapeRuleCode; message: string }[]): ApiError {
  return new ApiError(422, 'rules_broken', 'The squad breaks some rules.', { rules });
}

export function shapeRulesBrokenError(rules: { code: RuleCode | ShapeRuleCode; message: string }[]): ApiError {
  return new ApiError(422, 'rules_broken', 'The lineup breaks some rules.', { rules });
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Nothing lives at this address.');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to do that.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'You cannot do that from this account.');
}

export function crossOrigin(): ApiError {
  return new ApiError(403, 'cross_origin', 'Requests from other origins are not allowed.');
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'That request is too large.');
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'Send the request as JSON.');
}
