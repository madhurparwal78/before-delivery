const MESSAGES: Record<string, string> = {
  payload_too_large: 'That request was too large to accept.',
  unsupported_media_type: 'Send this request as JSON.',
  not_signed_in: 'Sign in to open this record.',
  not_found: 'We could not find that record.',
  forbidden: 'That record is not yours to open.',
  crew_only: 'Only the crew member can write their own hours.',
  cross_origin: 'That request came from another site, so it was refused.',
  email_taken: 'That email already has an account.',
  bad_credentials: 'That email and passcode do not match.',
  vessel_limit: 'You already run four vessels.',
  month_sealed: 'That month is sealed, so its hours cannot change.',
  entry_key_conflict: 'That entry key was already used for different hours.',
  day_closed: "This ship's day has closed, so the server did not save that entry.",
  rule_set_overlap: 'Another rule set is already in force for those dates.',
  day_not_closed: "This ship's day is still open, so it cannot be signed yet.",
  already_signed: "This ship's day has already been signed.",
  day_not_signed: 'The crew member has not signed this day yet.',
  already_countersigned: "This ship's day has already been countersigned.",
  month_not_ready: 'Every logged day must be signed and countersigned first.',
  month_not_sealed: 'That month is not sealed yet.',
  archive_unreachable: 'The archive is unreachable, so this document cannot be fetched right now.',
  link_ended: 'This link no longer opens.',
  link_revoked: 'This inspection link has been revoked.',
  link_expired: 'This inspection link has expired.',
  outside_scope: 'That date range is outside this inspection link.',
  read_only: 'An inspection link cannot change anything.',
  breach_permanent: 'A recorded breach stays on this record.',
  method_not_allowed: 'That method is not allowed here.',
};

/** Every API failure other than validation uses this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(MESSAGES[code] ?? 'That request could not be completed.');
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export class ValidationError extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super('Validation failed');
    this.errors = errors;
  }
}

export function fail(status: number, code: string, extra: Record<string, unknown> = {}): never {
  throw new ApiError(status, code, extra);
}

export function invalid(field: string, message: string): never {
  throw new ValidationError({ [field]: message });
}
