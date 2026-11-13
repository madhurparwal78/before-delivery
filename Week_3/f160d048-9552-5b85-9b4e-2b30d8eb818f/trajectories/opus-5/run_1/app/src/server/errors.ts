export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'not_verified'
  | 'rate_limited'
  | 'already_claimed'
  | 'already_decided'
  | 'not_claimed'
  | 'claim_expired'
  | 'in_review'
  | 'duplicate_review'
  | 'duplicate_application'
  | 'idempotency_mismatch'
  | 'job_closed'
  | 'already_replied'
  | 'invalid_transition'
  | 'edit_window_closed'
  | 'payload_too_large'
  | 'validation_failed'
  | 'contains_email'
  | 'contains_phone'
  | 'resume_not_pdf'
  | 'resume_too_large'
  | 'mark_not_png'
  | 'mark_too_large'
  | 'code_invalid'
  | 'code_expired'
  | 'token_invalid'
  | 'search_unavailable'
  | 'storage_unavailable';

const CATALOGUE: Readonly<Record<ErrorCode, { status: number; message: string }>> = {
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: 'Email or password is not right.' },
  not_found: { status: 404, message: 'We could not find that.' },
  forbidden: { status: 403, message: 'Your account cannot do that.' },
  not_verified: { status: 403, message: 'Verify your employer team first.' },
  rate_limited: { status: 429, message: 'Too many tries. Wait a minute and try again.' },
  already_claimed: { status: 409, message: 'Already claimed by <moderator display name>.' },
  already_decided: { status: 409, message: 'Already decided.' },
  not_claimed: { status: 409, message: 'Claim this post before deciding.' },
  claim_expired: { status: 409, message: 'Your claim on this post expired. Claim it again to decide.' },
  in_review: { status: 409, message: 'A moderator is reviewing this post. Try again shortly.' },
  duplicate_review: { status: 409, message: 'You have already reviewed this employer this year.' },
  duplicate_application: { status: 409, message: 'You have already applied for this job.' },
  idempotency_mismatch: { status: 409, message: 'This application was already sent with different answers.' },
  job_closed: { status: 409, message: 'This job is no longer taking applications.' },
  already_replied: { status: 409, message: 'Your team has already replied to this review.' },
  invalid_transition: { status: 409, message: 'That stage move is not allowed.' },
  edit_window_closed: { status: 409, message: 'This post can no longer be edited.' },
  payload_too_large: { status: 413, message: 'That request is too large.' },
  validation_failed: { status: 422, message: 'Check the highlighted fields.' },
  contains_email: { status: 422, message: 'Remove the email address before posting. Posts stay anonymous.' },
  contains_phone: { status: 422, message: 'Remove the phone number before posting. Posts stay anonymous.' },
  resume_not_pdf: { status: 422, message: 'Upload a PDF file.' },
  resume_too_large: { status: 422, message: 'The resume must be 5 MB or smaller.' },
  mark_not_png: { status: 422, message: 'Upload a PNG image.' },
  mark_too_large: { status: 422, message: 'The mark must be 1 MB or smaller.' },
  code_invalid: { status: 422, message: 'That code is not right. Check the email and try again.' },
  code_expired: { status: 422, message: 'That code has expired. Ask for a new one.' },
  token_invalid: { status: 422, message: 'This link has expired or was already used.' },
  search_unavailable: {
    status: 503,
    message: 'Search is unavailable right now. The job is saved as a draft; list it again in a moment.',
  },
  storage_unavailable: {
    status: 503,
    message: 'We could not store your resume right now. Your answers are kept; try again in a moment.',
  },
};

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  field?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ErrorCode,
    options: { message?: string; fields?: Record<string, string>; field?: string; retryAfterSeconds?: number } = {},
  ) {
    const entry = CATALOGUE[code];
    const message = options.message ?? entry.message;
    super(message);
    this.name = 'ApiError';
    this.status = entry.status;
    this.retryAfterSeconds = code === 'rate_limited' ? (options.retryAfterSeconds ?? 60) : null;
    const body: ApiErrorBody = { error: code, message };
    if (options.fields) body.fields = options.fields;
    if (options.field) body.field = options.field;
    this.body = body;
  }
}

export function alreadyClaimed(moderatorName: string): ApiError {
  return new ApiError('already_claimed', { message: `Already claimed by ${moderatorName}.` });
}

export function alreadyDecided(decision: 'approved' | 'rejected', moderatorName: string): ApiError {
  return new ApiError('already_decided', { message: `Already ${decision} by ${moderatorName}.` });
}
