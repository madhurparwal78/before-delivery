import type { PlanCode } from './domain/plans.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'session_ended'
  | 'payment_required'
  | 'plan_limit'
  | 'forbidden'
  | 'cross_origin'
  | 'not_found'
  | 'illegal_transition'
  | 'phase_locked'
  | 'deadline_passed'
  | 'workshop_closed'
  | 'workshop_not_open'
  | 'room_full'
  | 'budget_exhausted'
  | 'no_dot_to_return'
  | 'op_conflict'
  | 'no_join_link'
  | 'not_closed'
  | 'recap_not_ready'
  | 'plan_unchanged'
  | 'nothing_due'
  | 'link_revoked'
  | 'link_expired'
  | 'too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'storage_unavailable'
  | 'billing_unavailable';

const CATALOGUE: Readonly<Record<ErrorCode, { status: number; message: string }>> = {
  unauthenticated: { status: 401, message: 'Sign in to continue' },
  invalid_credentials: { status: 401, message: 'Email or password is incorrect' },
  session_ended: { status: 401, message: 'This join link is no longer active' },
  payment_required: { status: 402, message: 'Your workspace is read-only until the overdue payment is settled' },
  plan_limit: { status: 402, message: 'Your plan allows' },
  forbidden: { status: 403, message: "You don't have permission to do that" },
  cross_origin: { status: 403, message: 'Cross-origin requests are not accepted' },
  not_found: { status: 404, message: 'Not found' },
  illegal_transition: { status: 409, message: "The workshop can't move" },
  phase_locked: { status: 409, message: "That isn't available while the workshop is" },
  deadline_passed: { status: 409, message: 'Time is up for this round' },
  workshop_closed: { status: 409, message: 'This workshop has ended' },
  workshop_not_open: { status: 409, message: "This workshop hasn't opened yet" },
  room_full: { status: 409, message: 'This room is full' },
  budget_exhausted: { status: 409, message: 'You have no dots left' },
  no_dot_to_return: { status: 409, message: 'You have no dot on that cluster' },
  op_conflict: { status: 409, message: 'That operation id was already used for a different change' },
  no_join_link: { status: 409, message: 'Create a join link first' },
  not_closed: { status: 409, message: "The workshop isn't closed yet" },
  recap_not_ready: { status: 409, message: "The recap files aren't stored yet" },
  plan_unchanged: { status: 409, message: "You're already on that plan" },
  nothing_due: { status: 409, message: "There's nothing to pay" },
  link_revoked: { status: 410, message: 'This join link has been turned off' },
  link_expired: { status: 410, message: 'This join link has expired' },
  too_large: { status: 413, message: 'That request is too large' },
  unsupported_media_type: { status: 415, message: "That content type isn't accepted" },
  validation: { status: 422, message: 'Check the highlighted fields' },
  rate_limited: { status: 429, message: 'Too many requests — try again shortly' },
  quota_exceeded: { status: 429, message: "You've reached today's invite limit" },
  storage_unavailable: { status: 503, message: 'File storage is unavailable' },
  billing_unavailable: { status: 503, message: 'Billing is unavailable' },
};

export type FieldErrors = Readonly<Record<string, string>>;

export interface EntitlementDetail {
  readonly limit: number;
  readonly used: number;
  readonly plan: PlanCode;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldErrors;
    limit?: number;
    used?: number;
    plan?: PlanCode;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;
  readonly detail?: EntitlementDetail;
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    options: { message?: string; fields?: FieldErrors; detail?: EntitlementDetail; headers?: Record<string, string> } = {},
  ) {
    const entry = CATALOGUE[code];
    super(options.message ?? entry.message);
    this.name = 'AppError';
    this.code = code;
    this.status = entry.status;
    if (options.fields) this.fields = options.fields;
    if (options.detail) this.detail = options.detail;
    this.headers = options.headers ?? {};
  }

  body(): ErrorBody {
    const error: ErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.detail) {
      error.limit = this.detail.limit;
      error.used = this.detail.used;
      error.plan = this.detail.plan;
    }
    return { error };
  }
}

export const FIELD_MESSAGES = {
  unknownKey: "This field can't be set",
  clientOpId: 'Send an operation id of 8 to 64 letters, digits, - or _',
  titleLength: 'Enter a title of 1 to 120 characters',
  titleControl: "Titles can't contain line breaks or control characters",
  template: 'Choose a template',
  scheduleMalformed: 'Enter a date and time as YYYY-MM-DDTHH:MM',
  scheduleGap: (zone: string): string => `That time doesn't exist in ${zone} because the clocks go forward`,
  endNotAfterStart: 'The end must be after the start',
  sponsorEmail: 'Enter an email address',
  fee: 'Enter an amount in euros with up to two decimals',
  emailEntry: 'Every entry must be an email address',
  emailBatchSize: 'Send between 1 and 30 addresses at a time',
  imageSide: 'Images must be at most 8,000 pixels on each side',
  imageId: 'Upload the image again',
  query: 'Type between 1 and 100 characters',
  cursor: "That cursor isn't valid",
  freeAnnual: 'Free has no annual term',
  generic: 'Check this value',
} as const;
