type ErrorCode =
  | 'cross_origin'
  | 'too_large'
  | 'unsupported_media_type'
  | 'invalid_json'
  | 'too_many_attempts'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'account_inactive'
  | 'not_found'
  | 'invite_gone'
  | 'forbidden'
  | 'idempotency_key_required'
  | 'idempotency_conflict'
  | 'member_inactive'
  | 'already_member'
  | 'photo_required'
  | 'photo_locked'
  | 'illegal_transition'
  | 'pickup_not_due'
  | 'load_not_planning'
  | 'wrong_firing'
  | 'piece_taken'
  | 'exceeds_headroom'
  | 'exceeds_footprint'
  | 'deck_not_removable'
  | 'empty_load'
  | 'kiln_busy'
  | 'no_card_on_file'
  | 'pack_limit_reached'
  | 'charge_not_refundable'
  | 'month_closed'
  | 'month_open'
  | 'photo_too_large'
  | 'unsupported_photo'
  | 'validation'
  | 'storage_unavailable'
  | 'billing_unavailable';

const statusByCode: Record<ErrorCode, number> = {
  cross_origin: 403,
  too_large: 413,
  unsupported_media_type: 415,
  invalid_json: 400,
  too_many_attempts: 429,
  unauthenticated: 401,
  invalid_credentials: 401,
  account_inactive: 403,
  not_found: 404,
  invite_gone: 410,
  forbidden: 403,
  idempotency_key_required: 400,
  idempotency_conflict: 409,
  member_inactive: 409,
  already_member: 409,
  photo_required: 409,
  photo_locked: 409,
  illegal_transition: 409,
  pickup_not_due: 409,
  load_not_planning: 409,
  wrong_firing: 409,
  piece_taken: 409,
  exceeds_headroom: 409,
  exceeds_footprint: 409,
  deck_not_removable: 409,
  empty_load: 409,
  kiln_busy: 409,
  no_card_on_file: 409,
  pack_limit_reached: 409,
  charge_not_refundable: 409,
  month_closed: 409,
  month_open: 409,
  photo_too_large: 413,
  unsupported_photo: 415,
  validation: 422,
  storage_unavailable: 503,
  billing_unavailable: 503,
};

const defaultMessage: Record<ErrorCode, string> = {
  cross_origin: 'This request came from another origin.',
  too_large: 'That request body is too large.',
  unsupported_media_type: 'Send this request as application/json.',
  invalid_json: 'That request body is not valid JSON.',
  too_many_attempts: 'Too many sign-in attempts. Try again in 15 minutes.',
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'Studio, email or password is wrong.',
  account_inactive: 'This account is not active. Ask the studio owner.',
  not_found: 'That record does not exist.',
  invite_gone: 'This invite has expired or was already used.',
  forbidden: 'Your role may not do that.',
  idempotency_key_required: 'Send an Idempotency-Key header of 1 to 100 visible characters.',
  idempotency_conflict: 'That idempotency key was already used with a different body.',
  member_inactive: 'That member is not active in this studio.',
  already_member: 'That email is already in this studio.',
  photo_required: 'That piece needs an intake photo before check-in.',
  photo_locked: 'That piece is no longer logged, so its photo cannot change.',
  illegal_transition: 'That change is not allowed from the current state.',
  pickup_not_due: 'That piece can still be collected.',
  load_not_planning: 'This load is no longer being planned.',
  wrong_firing: 'That piece is waiting for a different firing.',
  piece_taken: 'That piece is already in another load.',
  exceeds_headroom: 'Too tall for this stack.',
  exceeds_footprint: 'That deck is full.',
  deck_not_removable: 'Only an empty top deck can be removed.',
  empty_load: 'Place at least one piece first.',
  kiln_busy: 'That kiln already has a load in it.',
  no_card_on_file: 'Add a card at the front desk before buying credit.',
  pack_limit_reached: 'You can buy at most 3 credit packs a day. Try again after midnight studio time.',
  charge_not_refundable: 'Only a settled charge can be refunded.',
  month_closed: 'That month is already closed.',
  month_open: 'That month has not ended yet in the studio time zone.',
  photo_too_large: 'Photo is larger than 5,000,000 bytes.',
  unsupported_photo: 'Use a JPEG, PNG or WebP photo.',
  validation: 'Fix the highlighted fields.',
  storage_unavailable: 'Photo storage is unavailable. Try again in a few minutes.',
  billing_unavailable: 'Billing is unavailable. Try again in a few minutes.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | null;
  readonly extra: Record<string, string> | null;

  constructor(
    code: ErrorCode,
    message?: string,
    fields?: Record<string, string>,
    extra?: Record<string, string>,
  ) {
    super(message ?? defaultMessage[code]);
    this.code = code;
    this.status = statusByCode[code];
    this.fields = fields ?? null;
    this.extra = extra ?? null;
  }

  body(): Record<string, unknown> {
    const out: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields) out['errors'] = this.fields;
    if (this.extra) Object.assign(out, this.extra);
    return out;
  }
}

export class ValidationBag {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) {
      throw new ApiError('validation', 'Fix the highlighted fields.', this.fields);
    }
  }
}
