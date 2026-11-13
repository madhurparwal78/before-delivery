import type { ProblemBody } from '../shared/types.js';
import { deskAmount } from '../shared/deskFormat.js';

export type ProblemCode =
  | 'payload_too_large' | 'cross_origin' | 'unsupported_media_type' | 'invalid_json'
  | 'unauthenticated' | 'idempotency_key_required' | 'idempotency_key_reused'
  | 'not_found' | 'forbidden' | 'precondition_required' | 'precondition_failed'
  | 'market_stale' | 'quote_expired' | 'quote_used' | 'position_closed'
  | 'already_liquidated' | 'in_grace' | 'not_liquidatable' | 'insufficient_liquidity'
  | 'email_taken' | 'pdf_pending' | 'validation_failed'
  | 'statement_store_unavailable' | 'ledger_unavailable' | 'internal_error';

export const STALE_BANNER = 'Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused.';
export const STALE_SWAP = 'Swaps are paused while the price feed is stale.';

export class ProblemError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly errors?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: ProblemCode, detail: string, errors?: Record<string, string>, headers?: Record<string, string>) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = errors;
    this.headers = headers;
  }
}

/** The one shared problem-details builder every error leaves the server through. */
export function problem(status: number, code: ProblemCode, detail: string, errors?: Record<string, string>, headers?: Record<string, string>): ProblemError {
  return new ProblemError(status, code, detail, errors, headers);
}

export function problemBody(err: ProblemError): ProblemBody {
  const body: ProblemBody = {
    type: `urn:quillmoor:problem:${err.code}`,
    status: err.status,
    code: err.code,
    detail: err.detail,
  };
  if (err.errors && Object.keys(err.errors).length > 0) body.errors = err.errors;
  return body;
}

export const DETAILS: Record<ProblemCode, string> = {
  payload_too_large: 'The request body is too large.',
  cross_origin: 'Requests must come from Quillmoor\u2019s own pages.',
  unsupported_media_type: 'Send the body as application/json.',
  invalid_json: 'The request body is not valid JSON.',
  unauthenticated: 'Choose who you are acting as.',
  idempotency_key_required: 'Send an Idempotency-Key header of 1 to 128 visible characters.',
  idempotency_key_reused: 'This Idempotency-Key was already used with a different request.',
  not_found: 'Nothing here by that name.',
  forbidden: 'Your role can\u2019t do this.',
  precondition_required: 'Send the If-Match header from your latest read.',
  precondition_failed: 'These risk parameters changed since you opened them. Check the current values and save again.',
  market_stale: STALE_BANNER,
  quote_expired: 'This quote has expired. Get a new quote.',
  quote_used: 'This quote has already been used.',
  position_closed: 'This position is closed.',
  already_liquidated: 'Already liquidated at this health factor',
  in_grace: 'This position is in its grace period.',
  not_liquidatable: 'This position is not below health factor 1.',
  insufficient_liquidity: 'Only <available> <ASSET> is available in the <ASSET> pool right now.',
  email_taken: 'A member with this email already exists.',
  pdf_pending: 'The PDF statement isn\u2019t ready yet.',
  validation_failed: 'Check the highlighted fields.',
  statement_store_unavailable: 'The statement store is unreachable. Nothing was changed. Try again shortly.',
  ledger_unavailable: 'The ledger is unreachable \u2013 nothing is confirmed. Try again shortly.',
  internal_error: 'Something went wrong on our side \u2013 nothing is confirmed.',
};

export function insufficientLiquidity(available: bigint, asset: string, decimals: number): ProblemError {
  const shown = deskAmount(available, decimals, false);
  return problem(409, 'insufficient_liquidity', `Only ${shown} ${asset} is available in the ${asset} pool right now.`);
}
