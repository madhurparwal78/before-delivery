import type { ApiErrorBody, Plan } from '../shared/plan.js';

export type ErrorCode =
  | 'invalid_json'
  | 'idempotency_key_required'
  | 'signed_out'
  | 'cross_origin'
  | 'not_found'
  | 'no_plan'
  | 'link_unknown'
  | 'method_not_allowed'
  | 'idempotency_conflict'
  | 'version_conflict'
  | 'link_used'
  | 'link_expired'
  | 'too_large'
  | 'unsupported_media_type'
  | 'invalid'
  | 'version_required'
  | 'rate_limited'
  | 'internal'
  | 'unavailable';

interface ErrorDefinition {
  readonly status: number;
  readonly message: string;
}

/** The single published catalogue of API errors. */
const ERRORS: Record<ErrorCode, ErrorDefinition> = {
  invalid_json: { status: 400, message: 'The request body is not valid JSON.' },
  idempotency_key_required: { status: 400, message: 'Send an Idempotency-Key header of 8 to 64 characters.' },
  signed_out: { status: 401, message: 'Sign in to manage your hour.' },
  cross_origin: { status: 403, message: 'This request did not come from Stillhour.' },
  not_found: { status: 404, message: 'Nothing is here.' },
  no_plan: { status: 404, message: 'There is no confirmed hour for this address.' },
  link_unknown: { status: 404, message: 'We do not recognise this link.' },
  method_not_allowed: { status: 405, message: 'This method is not allowed here.' },
  idempotency_conflict: { status: 409, message: 'This Idempotency-Key was already used with a different hour.' },
  version_conflict: { status: 409, message: 'This hour changed since you loaded it.' },
  link_used: { status: 410, message: 'This link has already been used.' },
  link_expired: { status: 410, message: 'This link has expired.' },
  too_large: { status: 413, message: 'The request is larger than 16,384 bytes.' },
  unsupported_media_type: { status: 415, message: 'Send the request body as JSON.' },
  invalid: { status: 422, message: 'Some details need another look.' },
  version_required: { status: 428, message: 'Send the version you are editing in an If-Match header.' },
  rate_limited: { status: 429, message: 'Too many requests for this address. Try again later.' },
  internal: { status: 500, message: 'Something went wrong on our side. Please try again.' },
  unavailable: {
    status: 503,
    message: 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.',
  },
};

export interface ApiErrorDetails {
  fields?: Record<string, string>;
  current?: Plan;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly current?: Plan;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, details: ApiErrorDetails = {}) {
    const definition = ERRORS[code];
    super(definition.message);
    this.name = 'ApiError';
    this.code = code;
    this.status = definition.status;
    this.fields = details.fields;
    this.current = details.current;
    this.headers = details.headers;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: { code: this.code, message: this.message } };
    if (this.fields) body.error.fields = this.fields;
    if (this.current) body.error.current = this.current;
    return body;
  }
}
