/**
 * Every published line of copy, in one place. The server uses it for problem
 * details and notices; the browser imports the same module for banners,
 * labels, announcements and field errors.
 */

import type { OracleStatus } from './oracle.ts';
import type { PositionState } from './position.ts';

export const STALE_BANNER =
  'Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused.';

export const STALE_SWAPS = 'Swaps are paused while the price feed is stale.';

export const PROBLEM_DETAIL = {
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
  precondition_failed:
    'These risk parameters changed since you opened them. Check the current values and save again.',
  quote_expired: 'This quote has expired. Get a new quote.',
  quote_used: 'This quote has already been used.',
  position_closed: 'This position is closed.',
  already_liquidated: 'Already liquidated at this health factor',
  in_grace: 'This position is in its grace period.',
  not_liquidatable: 'This position is not below health factor 1.',
  email_taken: 'A member with this email already exists.',
  pdf_pending: 'The PDF statement isn\u2019t ready yet.',
  validation_failed: 'Check the highlighted fields.',
  statement_store_unavailable:
    'The statement store is unreachable. Nothing was changed. Try again shortly.',
  ledger_unavailable:
    'The ledger is unreachable \u2013 nothing is confirmed. Try again shortly.',
  internal_error: 'Something went wrong on our side \u2013 nothing is confirmed.',
} as const;

/** The oracle status line shown in each asset's price group. */
export const ORACLE_STATUS_LINE: Readonly<Record<OracleStatus, string>> = {
  ok: '',
  unreachable: 'Couldn\u2019t reach the price oracle \u2013 showing the last good price',
  malformed: 'The price oracle sent an unreadable reading \u2013 showing the last good price',
  old_round: 'The price oracle sent an older round \u2013 ignored',
  not_newer: 'Manual post holds \u2013 the oracle has nothing newer',
  large_move: 'The oracle moved more than 60% \u2013 not applied, post it by hand to accept it',
  evidence_unavailable:
    'Couldn\u2019t store the oracle evidence \u2013 showing the last good price',
};

/** The position state labels shown on screen. */
export const POSITION_STATE_LABEL: Readonly<Record<PositionState, string>> = {
  healthy: 'Healthy',
  warned: 'Margin warning',
  liquidatable_grace: 'Liquidatable in grace',
  liquidatable: 'Liquidatable now',
  partially_liquidated: 'Partially liquidated',
  closed: 'Closed',
};

export const ROLE_LABEL = {
  risk_steward: 'Risk steward',
  liquidity_provider: 'Liquidity provider',
  borrower: 'Borrower',
  trader: 'Trader',
  liquidator: 'Liquidator',
} as const;

export const QUEUE_EMPTY = 'No positions are below health factor 1.';
export const PREVIEW_PROMPT = 'Type an amount to see the output.';
export const NETWORK_FAILURE =
  'Couldn\u2019t reach Quillmoor. Press the same button again to retry safely.';
export const NOT_FOUND_HEADING = 'We couldn\u2019t find that page.';

export const STATEMENT_PENDING_LINE =
  'Funds have moved. This settlement is not final until its statement and its PDF are confirmed in storage.';

export const FIELD_ERROR = {
  amountShape: 'Enter digits with a comma before the decimals.',
  amountDecimals: (decimals: number): string =>
    `Enter at most ${decimals} digits after the comma.`,
  amountZero: 'Enter an amount above zero.',
  percent: 'Enter a percentage with at most two decimals, for example 80,00.',
  deskTimeShape: 'Enter a desk time like 2026-11-01 01:30.',
  deskTimeGap: 'That time doesn\u2019t exist in the desk time zone \u2013 the clocks skip it.',
} as const;

/** The 422 field messages the API publishes. */
export const API_FIELD_MESSAGE = {
  amountUnits: 'Enter a whole number of minor units above zero.',
  unlistedAsset: 'Choose a listed asset.',
  samePair: 'Choose two different assets.',
  unknownField: 'Unknown field.',
  controlCharacters: 'Remove control characters.',
  priceShape: 'Enter a price above zero with at most 8 decimal places.',
  priceLargeMove: 'This moves the price by more than 60%. Confirm the large move to post it.',
  confirmLargeMove: 'Send true or false.',
  quoteIdRequired: 'Send the quote id.',
  roundRequired: 'Send the round shown for this position.',
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  role: 'Choose a role.',
  actorId: 'Choose an existing member.',
  instant: 'Send an RFC 3339 time with an offset.',
  endBeforeStart: 'End must be after start.',
  ltv: 'Loan-to-value must be above 0% and below the liquidation threshold.',
  liquidationThreshold: 'Liquidation threshold must be above 0% and at most 95,00%.',
  liquidationBonus:
    'Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%.',
  reserveFactor: 'Reserve factor must be from 0% to 50,00%.',
  supplyTooSmall: 'This amount is too small to receive any shares.',
  outputTooSmall: 'This amount is too small to receive anything.',
} as const;
