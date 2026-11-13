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

const STATUSES: Record<ErrorCode, number> = {
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
  storage_unavailable: 503,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }

  get status(): number {
    return STATUSES[this.code];
  }

  body(): string {
    const payload: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields) payload['fields'] = this.fields;
    return JSON.stringify(payload);
  }
}

export function errorResponse(error: ApiError): { status: number; body: string } {
  return { status: error.status, body: error.body() };
}
