import {
  ERROR_COPY,
  FIELD_COPY,
  OUTAGE_COPY,
  claimConflictCopy,
  claimTooLongCopy,
  layOverlapCopy,
  panelLaidCopy,
  panelOffClothCopy,
  rateLimitedCopy,
  type SimpleErrorCode,
} from '../shared/copy';

export type FieldErrors = Record<string, string>;

/**
 * The single refusal ladder for the whole API. A request that breaks several
 * rules is answered with the lowest rank it reaches.
 */
const LADDER: readonly string[] = [
  'too_large',
  'unsupported_media',
  'unauthenticated',
  'bad_credentials',
  'not_found',
  'forbidden',
  'no_cutting_authority',
  'no_authority_on_claim_date',
  'role_change_forbidden',
  'precondition_required',
  'stale_revision',
  'sealed',
  // every other 409 shares one rank
  'state',
  'rate_limited',
  'invalid',
];

const STATE_CODES = new Set([
  'wrong_state',
  'remeasure_required',
  'not_nested',
  'claim_empty',
  'claim_conflict',
  'claim_lapsed',
  'claim_closed',
  'already_cut',
  'idempotency_key_reused',
  'lay_overlap',
  'panel_laid',
  'already_issued',
  'already_revised',
  'already_decided',
  'not_accepted',
  'account_in_use',
  'email_taken',
  'photo_exists',
  'exceeds_balance',
]);

export function ladderRank(code: string): number {
  const key = STATE_CODES.has(code) ? 'state' : code;
  const index = LADDER.indexOf(key);
  return index === -1 ? LADDER.length : index;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: FieldErrors;
  readonly extra?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    code: string,
    status: number,
    message: string,
    options?: { fields?: FieldErrors; extra?: Record<string, unknown>; headers?: Record<string, string> },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.message = message;
    if (options?.fields) this.fields = options.fields;
    if (options?.extra) this.extra = options.extra;
    if (options?.headers) this.headers = options.headers;
  }

  get rank(): number {
    return ladderRank(this.code);
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields) body['fields'] = this.fields;
    if (this.extra) Object.assign(body, this.extra);
    return body;
  }
}

const SIMPLE_STATUS: Record<SimpleErrorCode, number> = {
  unauthenticated: 401,
  bad_credentials: 401,
  not_found: 404,
  forbidden: 403,
  no_cutting_authority: 403,
  no_authority_on_claim_date: 403,
  role_change_forbidden: 403,
  precondition_required: 428,
  stale_revision: 412,
  sealed: 409,
  wrong_state: 409,
  remeasure_required: 409,
  not_nested: 409,
  claim_empty: 409,
  claim_lapsed: 409,
  claim_closed: 409,
  already_cut: 409,
  idempotency_key_reused: 409,
  already_issued: 409,
  already_revised: 409,
  already_decided: 409,
  not_accepted: 409,
  account_in_use: 409,
  email_taken: 409,
  photo_exists: 409,
  exceeds_balance: 409,
  invalid: 422,
  too_large: 413,
  unsupported_media: 415,
};

export function refuse(code: SimpleErrorCode): AppError {
  return new AppError(code, SIMPLE_STATUS[code], ERROR_COPY[code]);
}

export function notFound(): AppError {
  return refuse('not_found');
}

export function invalid(fields: FieldErrors): AppError {
  return new AppError('invalid', 422, ERROR_COPY.invalid, { fields });
}

export function claimConflict(winnerDisplayName: string, claimId: string): AppError {
  return new AppError('claim_conflict', 409, claimConflictCopy(winnerDisplayName), {
    extra: { winner: { display_name: winnerDisplayName, claim_id: claimId } },
  });
}

export function layOverlap(panel: number, other: number): AppError {
  return new AppError('lay_overlap', 409, layOverlapCopy(panel, other));
}

export function panelAlreadyLaid(panel: number): AppError {
  return new AppError('panel_laid', 409, panelLaidCopy(panel));
}

export function panelOffCloth(panel: number): AppError {
  return invalid({ position: panelOffClothCopy(panel) });
}

export function claimTooLong(stockCode: string): AppError {
  return invalid({ length_mm: claimTooLongCopy(stockCode) });
}

export function clothMismatch(): AppError {
  return invalid({ stock_code: FIELD_COPY.clothMismatch });
}

export function lotMismatch(): AppError {
  return invalid({ stock_code: FIELD_COPY.lotMismatch });
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError('rate_limited', 429, rateLimitedCopy(retryAfterSeconds), {
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}

export function databaseUnavailable(): AppError {
  return new AppError('database_unavailable', 503, OUTAGE_COPY.database);
}

export function identityUnavailable(): AppError {
  return new AppError('identity_unavailable', 503, OUTAGE_COPY.identity);
}

export function storeUnavailable(which: 'ownerSheet' | 'photo' | 'issuing'): AppError {
  return new AppError('store_unavailable', 503, OUTAGE_COPY[which]);
}
