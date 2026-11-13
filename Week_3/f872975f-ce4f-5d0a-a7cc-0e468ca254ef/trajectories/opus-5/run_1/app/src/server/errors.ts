export type ErrorCode =
  | 'bad_json'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'card_declined'
  | 'payment_failed'
  | 'cross_origin'
  | 'forbidden'
  | 'not_found'
  | 'already_held'
  | 'board_state'
  | 'hold_not_active'
  | 'ticket_state'
  | 'offcut_not_cut'
  | 'lineage_cycle'
  | 'idempotency_conflict'
  | 'too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'unsupported_version'
  | 'wrong_board'
  | 'billing_unavailable'
  | 'storage_unavailable';

const STATUS: Record<ErrorCode, number> = {
  bad_json: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  card_declined: 402,
  payment_failed: 402,
  cross_origin: 403,
  forbidden: 403,
  not_found: 404,
  already_held: 409,
  board_state: 409,
  hold_not_active: 409,
  ticket_state: 409,
  offcut_not_cut: 409,
  lineage_cycle: 409,
  idempotency_conflict: 409,
  too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
  unsupported_version: 422,
  wrong_board: 422,
  billing_unavailable: 503,
  storage_unavailable: 503
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  bad_json: 'The request body is not valid JSON.',
  unauthenticated: 'Sign in to do that.',
  invalid_credentials: 'That email and password do not match.',
  card_declined: 'The card was declined.',
  payment_failed: 'Billing did not confirm the payment.',
  cross_origin: 'Cross-origin requests are not accepted.',
  forbidden: 'Your role may not do that.',
  not_found: 'Not on this rack.',
  already_held: 'Another maker already holds this board.',
  board_state: "The board's status does not allow this.",
  hold_not_active: 'This hold is no longer active.',
  ticket_state: "The ticket's status does not allow this.",
  offcut_not_cut: 'This offcut is still waiting at the saw.',
  lineage_cycle: 'That change would make the board its own ancestor.',
  idempotency_conflict: 'That idempotency key was used for a different request.',
  too_large: 'The request body is too large.',
  unsupported_media_type: 'That content type is not accepted.',
  validation: 'Some fields need fixing.',
  unsupported_version: 'That layout file version is not supported.',
  wrong_board: 'That layout file is for another board.',
  billing_unavailable: 'Billing is offline.',
  storage_unavailable: 'Photo storage is offline.'
};

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly fields: Record<string, string> | null;

  public constructor(code: ErrorCode, fields?: Record<string, string>, message?: string) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields ?? null;
  }

  public body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields !== null) body.fields = this.fields;
    return body;
  }
}

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  public add(field: string, message: string): void {
    if (this.fields[field] === undefined) this.fields[field] = message;
  }

  public get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  public throwIfAny(): void {
    if (!this.empty) throw new ApiError('validation', this.fields);
  }
}
