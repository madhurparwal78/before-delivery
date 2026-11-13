export type ProblemCode =
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'malformed_json'
  | 'read_only'
  | 'origin_mismatch'
  | 'unauthenticated'
  | 'validation_failed'
  | 'not_found'
  | 'planning_parent_only'
  | 'not_your_request'
  | 'not_your_answer'
  | 'idempotency_key_reused'
  | 'precondition_required'
  | 'request_lapsed'
  | 'precondition_failed'
  | 'invalid_transition'
  | 'no_adopted_plan'
  | 'other_parent_not_joined'
  | 'swap_overlaps'
  | 'swap_run_too_long'
  | 'swap_nights_changed'
  | 'costs_logged_after_effective_date'
  | 'email_taken'
  | 'too_many_attempts'
  | 'invalid_credentials'
  | 'already_joined'
  | 'record_in_progress'
  | 'record_not_stored'
  | 'receipt_limit'
  | 'storage_unavailable'
  | 'database_unavailable'
  | 'internal_error';

const problems: Record<ProblemCode, { status: number; title: string }> = {
  payload_too_large: { status: 413, title: 'That request body is too large.' },
  unsupported_media_type: { status: 415, title: 'That media type is not accepted.' },
  malformed_json: { status: 400, title: 'That request body is not valid JSON.' },
  read_only: { status: 405, title: 'This link answers reads only.' },
  origin_mismatch: { status: 403, title: 'That request came from another origin.' },
  unauthenticated: { status: 401, title: 'Sign in to continue.' },
  validation_failed: { status: 422, title: 'Some values need changing.' },
  not_found: { status: 404, title: 'We could not find that.' },
  planning_parent_only: { status: 403, title: 'Only the planning parent can do that.' },
  not_your_request: { status: 403, title: 'That request belongs to the other parent.' },
  not_your_answer: { status: 403, title: 'That answer belongs to the other parent.' },
  idempotency_key_reused: { status: 409, title: 'That idempotency key was used with another body.' },
  precondition_required: { status: 428, title: 'This change needs an If-Match version.' },
  request_lapsed: { status: 409, title: 'That request has lapsed.' },
  precondition_failed: { status: 412, title: 'That version is out of date.' },
  invalid_transition: { status: 409, title: 'That change is not allowed from this state.' },
  no_adopted_plan: { status: 409, title: 'This household has no adopted plan.' },
  other_parent_not_joined: { status: 409, title: 'The other parent has not joined yet.' },
  swap_overlaps: { status: 409, title: 'Those nights are already in another request.' },
  swap_run_too_long: { status: 409, title: 'That swap breaks the run limit.' },
  swap_nights_changed: { status: 409, title: 'Those nights changed when the plan was amended.' },
  costs_logged_after_effective_date: { status: 409, title: 'Costs are already sent on or after that date.' },
  email_taken: { status: 409, title: 'That email address is already in use.' },
  too_many_attempts: { status: 429, title: 'Too many sign-in tries.' },
  invalid_credentials: { status: 401, title: "That email and password don't match." },
  already_joined: { status: 409, title: 'The other parent has already joined.' },
  record_in_progress: { status: 409, title: 'A record for that year is already being made.' },
  record_not_stored: { status: 409, title: 'That year record is not stored yet.' },
  receipt_limit: { status: 409, title: 'That cost already holds five receipts.' },
  storage_unavailable: { status: 503, title: 'Could not reach storage.' },
  database_unavailable: { status: 503, title: 'Could not reach the household data.' },
  internal_error: { status: 500, title: 'Something went wrong.' },
};

export interface ProblemExtras {
  errors?: Record<string, string>;
  conflictingRequestId?: string;
  recordId?: string;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  public readonly code: ProblemCode;
  public readonly status: number;
  public readonly extras: ProblemExtras;

  constructor(code: ProblemCode, extras: ProblemExtras = {}) {
    const problem = problems[code];
    super(problem.title);
    this.code = code;
    this.status = problem.status;
    this.extras = extras;
  }

  body(): Record<string, unknown> {
    const problem = problems[this.code];
    const out: Record<string, unknown> = {
      type: `urn:twohouse:problem:${this.code}`,
      title: problem.title,
      status: problem.status,
      code: this.code,
    };
    if (this.extras.errors) out.errors = this.extras.errors;
    if (this.extras.conflictingRequestId) out.conflictingRequestId = this.extras.conflictingRequestId;
    if (this.extras.recordId) out.recordId = this.extras.recordId;
    return out;
  }

  headers(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.code === 'read_only') out.Allow = 'GET, HEAD';
    if (this.extras.retryAfterSeconds !== undefined) out['Retry-After'] = String(this.extras.retryAfterSeconds);
    return out;
  }
}

export function fail(code: ProblemCode, extras: ProblemExtras = {}): never {
  throw new ApiError(code, extras);
}

export function failField(path: string, message: string): never {
  throw new ApiError('validation_failed', { errors: { [path]: message } });
}
