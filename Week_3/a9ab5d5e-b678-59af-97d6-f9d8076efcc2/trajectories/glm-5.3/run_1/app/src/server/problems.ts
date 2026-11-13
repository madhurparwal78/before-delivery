/** One error builder, one shape, every error path. RFC 9457. */

export class Problem extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, title: string, opts?: {
    errors?: Record<string, string>;
    extra?: Record<string, unknown>;
    headers?: Record<string, string>;
  }) {
    super(title);
    this.status = status;
    this.code = code;
    this.errors = opts?.errors;
    this.extra = opts?.extra;
    this.headers = opts?.headers;
  }

  /** The problem details body as a plain object. */
  body(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      type: `urn:twohouse:problem:${this.code}`,
      title: this.message,
      status: this.status,
      code: this.code,
    };
    if (this.errors && Object.keys(this.errors).length > 0) out.errors = this.errors;
    if (this.extra) Object.assign(out, this.extra);
    return out;
  }
}

const TITLES: Record<string, string> = {
  payload_too_large: 'Request body is too large.',
  unsupported_media_type: 'Unsupported media type.',
  malformed_json: 'The request body is not valid JSON.',
  read_only: 'This route is read-only.',
  origin_mismatch: 'Requests must come from this app.',
  unauthenticated: 'Sign in to continue.',
  validation_failed: 'The request is not valid.',
  not_found: "We couldn't find that page.",
  planning_parent_only: 'Only the planning parent can do that.',
  not_your_request: 'This is not your request.',
  not_your_answer: 'This request is not yours to answer.',
  idempotency_key_reused: 'This key was used with a different request.',
  precondition_required: 'Send the current version to make this change.',
  request_lapsed: 'This request lapsed.',
  precondition_failed: 'This changed while you were looking.',
  invalid_transition: "This request can't move that way.",
  no_adopted_plan: 'Adopt a plan first.',
  other_parent_not_joined: 'The other parent has not joined yet.',
  already_joined: 'The other parent has already joined.',
  email_taken: 'That email is already used.',
  invalid_credentials: "That email and password don't match.",
  too_many_attempts: 'Too many tries.',
  swap_overlaps: 'Those nights are already in another request.',
  swap_nights_changed: 'Those nights changed when the plan was amended.',
  swap_run_too_long: 'That swap would keep the child too long.',
  costs_logged_after_effective_date: 'Costs are already sent on or after that date.',
  record_in_progress: 'A record for that year is already being made.',
  record_not_stored: 'The record is not stored yet.',
  receipt_limit: 'A cost can hold five receipts.',
  storage_unavailable: "Couldn't reach storage.",
  renderer_unavailable: "Couldn't reach the PDF service.",
  database_unavailable: "Couldn't reach the household data.",
  internal_error: 'Something went wrong.',
};

export function problem(status: number, code: keyof typeof TITLES | string, opts?: {
  errors?: Record<string, string>;
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Problem {
  const title = TITLES[code] ?? 'Something went wrong.';
  return new Problem(status, code, title, opts);
}

export function validationProblem(errors: Record<string, string>): Problem {
  return problem(422, 'validation_failed', { errors });
}

export function notFound(): Problem {
  return problem(404, 'not_found');
}

export function internalError(): Problem {
  return problem(500, 'internal_error');
}
