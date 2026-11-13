// The single published error shape and the single precedence order.
export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  field?: string;
  retryAfter?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    extra?: { fields?: Record<string, string>; field?: string; retryAfter?: number },
  ) {
    super(message);
    this.code = code;
    this.status = status;
    if (extra?.fields) this.fields = extra.fields;
    if (extra?.field) this.field = extra.field;
    if (extra?.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
  }
}

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'Email or password is not right.',
  not_found: 'We could not find that.',
  forbidden: 'Your account cannot do that.',
  not_verified: 'Verify your employer team first.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  payload_too_large: 'That request is too large.',
  duplicate_review: 'You have already reviewed this employer this year.',
  duplicate_application: 'You have already applied for this job.',
  idempotency_mismatch: 'This application was already sent with different answers.',
  job_closed: 'This job is no longer taking applications.',
  already_replied: 'Your team has already replied to this review.',
  invalid_transition: 'That stage move is not allowed.',
  edit_window_closed: 'This post can no longer be edited.',
  in_review: 'A moderator is reviewing this post. Try again shortly.',
  validation_failed: 'Check the highlighted fields.',
  contains_email: 'Remove the email address before posting. Posts stay anonymous.',
  contains_phone: 'Remove the phone number before posting. Posts stay anonymous.',
  resume_not_pdf: 'Upload a PDF file.',
  resume_too_large: 'The resume must be 5 MB or smaller.',
  mark_not_png: 'Upload a PNG image.',
  mark_too_large: 'The mark must be 1 MB or smaller.',
  code_invalid: 'That code is not right. Check the email and try again.',
  code_expired: 'That code has expired. Ask for a new one.',
  token_invalid: 'This link has expired or was already used.',
  search_unavailable:
    'Search is unavailable right now. The job is saved as a draft; list it again in a moment.',
  storage_unavailable:
    'We could not store your resume right now. Your answers are kept; try again in a moment.',
};

// Builder for the copy that names a moderator.
export const errors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', MESSAGES.unauthenticated),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', MESSAGES.invalid_credentials),
  notFound: () => new ApiError(404, 'not_found', MESSAGES.not_found),
  forbidden: () => new ApiError(403, 'forbidden', MESSAGES.forbidden),
  notVerified: () => new ApiError(403, 'not_verified', MESSAGES.not_verified),
  rateLimited: (retryAfter: number) =>
    new ApiError(429, 'rate_limited', MESSAGES.rate_limited, { retryAfter }),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', MESSAGES.payload_too_large),
  alreadyClaimed: (name: string) => new ApiError(409, 'already_claimed', `Already claimed by ${name}.`),
  alreadyDecided: (name: string, decision: 'approved' | 'rejected') =>
    new ApiError(409, 'already_decided', `Already ${decision} by ${name}.`),
  notClaimed: () => new ApiError(409, 'not_claimed', 'Claim this post before deciding.'),
  claimExpired: () =>
    new ApiError(409, 'claim_expired', 'Your claim on this post expired. Claim it again to decide.'),
  inReview: () => new ApiError(409, 'in_review', MESSAGES.in_review),
  duplicateReview: () => new ApiError(409, 'duplicate_review', MESSAGES.duplicate_review),
  duplicateApplication: () => new ApiError(409, 'duplicate_application', MESSAGES.duplicate_application),
  idempotencyMismatch: () => new ApiError(409, 'idempotency_mismatch', MESSAGES.idempotency_mismatch),
  jobClosed: () => new ApiError(409, 'job_closed', MESSAGES.job_closed),
  alreadyReplied: () => new ApiError(409, 'already_replied', MESSAGES.already_replied),
  invalidTransition: () => new ApiError(409, 'invalid_transition', MESSAGES.invalid_transition),
  editWindowClosed: () => new ApiError(409, 'edit_window_closed', MESSAGES.edit_window_closed),
  validation: (fields: Record<string, string>) =>
    new ApiError(422, 'validation_failed', MESSAGES.validation_failed, { fields }),
  containsEmail: (field: string) =>
    new ApiError(422, 'contains_email', MESSAGES.contains_email, { field }),
  containsPhone: (field: string) =>
    new ApiError(422, 'contains_phone', MESSAGES.contains_phone, { field }),
  resumeNotPdf: () => new ApiError(422, 'resume_not_pdf', MESSAGES.resume_not_pdf),
  resumeTooLarge: () => new ApiError(422, 'resume_too_large', MESSAGES.resume_too_large),
  markNotPng: () => new ApiError(422, 'mark_not_png', MESSAGES.mark_not_png),
  markTooLarge: () => new ApiError(422, 'mark_too_large', MESSAGES.mark_too_large),
  codeInvalid: () => new ApiError(422, 'code_invalid', MESSAGES.code_invalid),
  codeExpired: () => new ApiError(422, 'code_expired', MESSAGES.code_expired),
  tokenInvalid: () => new ApiError(422, 'token_invalid', MESSAGES.token_invalid),
  searchUnavailable: () => new ApiError(503, 'search_unavailable', MESSAGES.search_unavailable),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable', MESSAGES.storage_unavailable),
};

export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields) body.fields = err.fields;
  if (err.field) body.field = err.field;
  return body;
}
