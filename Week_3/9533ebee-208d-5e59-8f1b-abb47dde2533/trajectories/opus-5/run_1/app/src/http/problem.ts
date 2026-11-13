/**
 * The one shared problem-details builder. Every error the API answers,
 * including the 500 handler and missing built files, leaves through here in
 * the one published RFC 9457 shape.
 */

import { PROBLEM_DETAIL, STALE_BANNER, STALE_SWAPS } from '../domain/copy.ts';
import { formatAmount } from '../domain/deskformat.ts';
import { assetDecimals, type Asset } from '../domain/assets.ts';

export type ProblemCode =
  keyof typeof PROBLEM_DETAIL | 'market_stale' | 'insufficient_liquidity';

export interface ProblemBody {
  readonly type: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly errors?: Readonly<Record<string, string>>;
}

export class Problem extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly errors: Readonly<Record<string, string>> | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: ProblemCode,
    detail: string,
    options?: {
      errors?: Readonly<Record<string, string>>;
      headers?: Readonly<Record<string, string>>;
    },
  ) {
    super(`${code}: ${detail}`);
    this.name = 'Problem';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = options?.errors;
    this.headers = options?.headers ?? {};
  }

  body(): ProblemBody {
    const base = {
      type: `urn:quillmoor:problem:${this.code}`,
      status: this.status,
      code: this.code,
      detail: this.detail,
    };
    return this.errors === undefined ? base : { ...base, errors: this.errors };
  }
}

export function isProblem(error: unknown): error is Problem {
  return error instanceof Problem;
}

// The published errors, each built in exactly one place.

export const payloadTooLarge = (): Problem =>
  new Problem(413, 'payload_too_large', PROBLEM_DETAIL.payload_too_large);

export const crossOrigin = (): Problem =>
  new Problem(403, 'cross_origin', PROBLEM_DETAIL.cross_origin);

export const unsupportedMediaType = (): Problem =>
  new Problem(415, 'unsupported_media_type', PROBLEM_DETAIL.unsupported_media_type);

export const invalidJson = (): Problem =>
  new Problem(400, 'invalid_json', PROBLEM_DETAIL.invalid_json);

export const unauthenticated = (): Problem =>
  new Problem(401, 'unauthenticated', PROBLEM_DETAIL.unauthenticated, {
    headers: { 'WWW-Authenticate': 'Bearer' },
  });

export const idempotencyKeyRequired = (): Problem =>
  new Problem(400, 'idempotency_key_required', PROBLEM_DETAIL.idempotency_key_required);

export const idempotencyKeyReused = (): Problem =>
  new Problem(409, 'idempotency_key_reused', PROBLEM_DETAIL.idempotency_key_reused);

export const notFound = (): Problem => new Problem(404, 'not_found', PROBLEM_DETAIL.not_found);

export const forbidden = (): Problem => new Problem(403, 'forbidden', PROBLEM_DETAIL.forbidden);

export const preconditionRequired = (): Problem =>
  new Problem(428, 'precondition_required', PROBLEM_DETAIL.precondition_required);

export const preconditionFailed = (): Problem =>
  new Problem(412, 'precondition_failed', PROBLEM_DETAIL.precondition_failed);

/** The stale-feed refusal for draws, collateral withdrawals and liquidations. */
export const marketStale = (): Problem => new Problem(423, 'market_stale', STALE_BANNER);

/** The stale-feed refusal for previews, quotes and swaps. */
export const marketStaleSwap = (): Problem => new Problem(423, 'market_stale', STALE_SWAPS);

export const quoteExpired = (): Problem =>
  new Problem(410, 'quote_expired', PROBLEM_DETAIL.quote_expired);

export const quoteUsed = (): Problem =>
  new Problem(409, 'quote_used', PROBLEM_DETAIL.quote_used);

export const positionClosed = (): Problem =>
  new Problem(409, 'position_closed', PROBLEM_DETAIL.position_closed);

export const alreadyLiquidated = (): Problem =>
  new Problem(409, 'already_liquidated', PROBLEM_DETAIL.already_liquidated);

export const inGrace = (): Problem => new Problem(409, 'in_grace', PROBLEM_DETAIL.in_grace);

export const notLiquidatable = (): Problem =>
  new Problem(409, 'not_liquidatable', PROBLEM_DETAIL.not_liquidatable);

export const insufficientLiquidity = (asset: Asset, available: bigint): Problem =>
  new Problem(
    409,
    'insufficient_liquidity',
    `Only ${formatAmount(available, assetDecimals(asset))} ${asset} is available in the ${asset} pool right now.`,
  );

export const emailTaken = (): Problem =>
  new Problem(409, 'email_taken', PROBLEM_DETAIL.email_taken);

export const pdfPending = (): Problem =>
  new Problem(409, 'pdf_pending', PROBLEM_DETAIL.pdf_pending);

export const validationFailed = (errors: Readonly<Record<string, string>>): Problem =>
  new Problem(422, 'validation_failed', PROBLEM_DETAIL.validation_failed, { errors });

export const statementStoreUnavailable = (): Problem =>
  new Problem(503, 'statement_store_unavailable', PROBLEM_DETAIL.statement_store_unavailable);

export const ledgerUnavailable = (): Problem =>
  new Problem(503, 'ledger_unavailable', PROBLEM_DETAIL.ledger_unavailable);

export const internalError = (): Problem =>
  new Problem(500, 'internal_error', PROBLEM_DETAIL.internal_error);
