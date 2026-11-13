// The API's one error shape, RFC 9457 problem details: `{"type","status","code","detail"}`, and for a 422 also
// `"errors"` with one message per field. Every error in the server leaves through `problemResponse`.

import type { ServerResponse } from "node:http";
import { BANNER, SWAPS_PAUSED } from "../shared/copy.js";
import { bpsPercent } from "../shared/format.js";

const PROBLEMS = {
  payload_too_large: [413, "The request body is too large."],
  cross_origin: [403, "Requests must come from Quillmoor’s own pages."],
  unsupported_media_type: [415, "Send the body as application/json."],
  invalid_json: [400, "The request body is not valid JSON."],
  unauthenticated: [401, "Choose who you are acting as."],
  idempotency_key_required: [400, "Send an Idempotency-Key header of 1 to 128 visible characters."],
  idempotency_key_reused: [409, "This Idempotency-Key was already used with a different request."],
  not_found: [404, "Nothing here by that name."],
  forbidden: [403, "Your role can’t do this."],
  precondition_required: [428, "Send the If-Match header from your latest read."],
  precondition_failed: [412, "These risk parameters changed since you opened them. Check the current values and save again."],
  quote_expired: [410, "This quote has expired. Get a new quote."],
  quote_used: [409, "This quote has already been used."],
  position_closed: [409, "This position is closed."],
  already_liquidated: [409, "Already liquidated at this health factor"],
  in_grace: [409, "This position is in its grace period."],
  not_liquidatable: [409, "This position is not below health factor 1."],
  email_taken: [409, "A member with this email already exists."],
  pdf_pending: [409, "The PDF statement isn’t ready yet."],
  validation_failed: [422, "Check the highlighted fields."],
  statement_store_unavailable: [503, "The statement store is unreachable. Nothing was changed. Try again shortly."],
  ledger_unavailable: [503, "The ledger is unreachable – nothing is confirmed. Try again shortly."],
  internal_error: [500, "Something went wrong on our side – nothing is confirmed."],
} as const satisfies Record<string, readonly [number, string]>;

type FixedCode = keyof typeof PROBLEMS;
type Code = FixedCode | "market_stale" | "insufficient_liquidity";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: Code,
    readonly detail: string,
    readonly errors?: Record<string, string>,
  ) {
    super(detail);
  }
}

export function fail(code: FixedCode): ApiError {
  const [status, detail] = PROBLEMS[code];
  return new ApiError(status, code, detail);
}

export function marketStale(detail: typeof BANNER | typeof SWAPS_PAUSED): ApiError {
  return new ApiError(423, "market_stale", detail);
}

export function insufficientLiquidity(available: string, asset: string): ApiError {
  return new ApiError(409, "insufficient_liquidity", `Only ${available} ${asset} is available in the ${asset} pool right now.`);
}

/** 422: one message per field. Fields whose check passed are given as `false` or `undefined`. */
export function validation(fields: Record<string, string | false | undefined>): ApiError {
  const errors = Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const [, detail] = PROBLEMS.validation_failed;
  return new ApiError(422, "validation_failed", detail, errors);
}

/** The one published problem-details shape; every error leaves the server through it. */
export function problemJson(error: ApiError): Record<string, unknown> {
  return {
    type: `urn:quillmoor:problem:${error.code}`,
    status: error.status,
    code: error.code,
    detail: error.detail,
    ...(error.errors ? { errors: error.errors } : {}),
  };
}

export function problemResponse(res: ServerResponse, error: ApiError, extra: Record<string, string> = {}): void {
  res.writeHead(error.status, { "Content-Type": "application/problem+json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(problemJson(error)));
}

/** The published field messages. Percentages and amounts inside them are written in desk format. */
export const FIELD = {
  amount: "Enter a whole number of minor units above zero.",
  asset: "Choose a listed asset.",
  pair: "Choose two different assets.",
  price: "Enter a price above zero with at most 8 decimal places.",
  largeMove: "This moves the price by more than 60%. Confirm the large move to post it.",
  confirm: "Send true or false.",
  quoteId: "Send the quote id.",
  tooSmallShares: "This amount is too small to receive any shares.",
  tooSmallOut: "This amount is too small to receive anything.",
  round: "Send the round shown for this position.",
  name: "Enter a name of 1 to 80 characters.",
  email: "Enter a valid email address.",
  role: "Choose a role.",
  actorId: "Choose an existing member.",
  instant: "Send an RFC 3339 time with an offset.",
  endAfterStart: "End must be after start.",
  unknownField: "Unknown field.",
  controlCharacters: "Remove control characters.",
  ltv: "Loan-to-value must be above 0% and below the liquidation threshold.",
  threshold: `Liquidation threshold must be above 0% and at most ${bpsPercent(9500)}%.`,
  bonus: `Bonus must be from 0% to ${bpsPercent(2000)}%, and the threshold times one plus the bonus must stay below 100%.`,
  reserve: `Reserve factor must be from 0% to ${bpsPercent(5000)}%.`,
} as const;
