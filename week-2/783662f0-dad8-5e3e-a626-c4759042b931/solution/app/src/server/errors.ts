import type { Response } from 'express';
import { COPY, FIELD_COPY } from '../shared/copy.js';

type ErrorCode =
  // boundary
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'cross_origin'
  // session and lookup
  | 'unauthenticated'
  | 'bad_credentials'
  | 'not_found'
  | 'unknown_handle'
  // roles
  | 'forbidden'
  | 'not_your_character'
  | 'not_seated'
  | 'not_leader'
  | 'not_your_turn'
  | 'not_trade_party'
  // preconditions
  | 'precondition_required'
  | 'precondition_failed'
  // billing gates
  | 'server_suspended'
  | 'server_inactive'
  // invites
  | 'invite_used'
  | 'invite_expired'
  | 'invite_superseded'
  // conflicts
  | 'email_in_use'
  | 'member_limit_reached'
  | 'already_member'
  | 'payment_pending'
  | 'nothing_due'
  | 'same_plan'
  | 'plan_change_pending'
  | 'server_not_active'
  | 'roster_full'
  | 'character_limit'
  | 'slot_held'
  | 'inventory_full'
  | 'tile_taken'
  | 'weather_grounded'
  | 'already_in_party'
  | 'party_closed'
  | 'run_in_progress'
  | 'table_in_use'
  | 'table_full'
  | 'already_seated'
  | 'game_in_play'
  | 'not_settled'
  | 'rematch_required'
  | 'table_not_full'
  | 'game_not_in_play'
  | 'stale_turn'
  | 'turn_expired'
  | 'trade_open'
  | 'trade_closed'
  | 'trade_changed'
  | 'not_paid'
  | 'already_refunded'
  | 'coins_spent'
  | 'idempotency_key_reused'
  // unprocessable
  | 'unknown_field'
  | 'validation'
  | 'blocked'
  | 'too_far'
  | 'not_buildable'
  | 'no_block_in_inventory'
  | 'no_block'
  | 'wrong_surface'
  | 'no_route'
  | 'same_tile'
  | 'illegal_move'
  | 'missing_ingredients'
  | 'empty_slot'
  | 'insufficient_coins'
  // limits and outages
  | 'daily_limit_reached'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'database_unavailable'
  | 'internal';

interface Spec {
  readonly status: number;
  readonly message: string;
}

const SPECS: Readonly<Record<ErrorCode, Spec>> = {
  payload_too_large: { status: 413, message: 'Request body is larger than 16384 bytes.' },
  unsupported_media_type: { status: 415, message: 'Send this request as application/json.' },
  cross_origin: { status: 403, message: 'This request came from another origin.' },

  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  bad_credentials: { status: 401, message: COPY.signInWrong },
  not_found: { status: 404, message: COPY.notFound },
  unknown_handle: { status: 404, message: COPY.membersUnknownHandle },

  forbidden: { status: 403, message: 'Only the server owner can do that.' },
  not_your_character: { status: 403, message: 'That character belongs to another player.' },
  not_seated: { status: 403, message: 'Only a seated player can do that.' },
  not_leader: { status: 403, message: 'Only the party leader can do that.' },
  not_your_turn: { status: 403, message: 'It is not your turn.' },
  not_trade_party: { status: 403, message: 'You are not part of this trade.' },

  precondition_required: { status: 428, message: 'Send If-Match with the version you read.' },
  precondition_failed: { status: 412, message: COPY.staleVersion },

  server_suspended: { status: 423, message: COPY.refusalSuspended },
  server_inactive: { status: 423, message: COPY.refusalInactive },

  invite_used: { status: 410, message: COPY.joinUsed },
  invite_expired: { status: 410, message: COPY.joinExpired },
  invite_superseded: { status: 410, message: COPY.joinSuperseded },

  email_in_use: { status: 409, message: COPY.joinEmailInUse },
  member_limit_reached: { status: 409, message: "This server's plan allows no more members." },
  already_member: { status: 409, message: 'That player is already a member.' },
  payment_pending: { status: 409, message: COPY.billingPaymentPending },
  nothing_due: { status: 409, message: COPY.billingNothingDue },
  same_plan: { status: 409, message: COPY.billingSamePlan },
  plan_change_pending: { status: 409, message: COPY.billingPlanChangePending },
  server_not_active: { status: 409, message: COPY.billingServerNotActive },
  roster_full: { status: 409, message: COPY.rosterFull },
  character_limit: { status: 409, message: "This server's plan allows no more characters." },
  slot_held: { status: 409, message: 'That stack is offered in a trade.' },
  inventory_full: { status: 409, message: COPY.inventoryFull },
  tile_taken: { status: 409, message: COPY.tileTaken },
  weather_grounded: { status: 409, message: COPY.weatherGrounded },
  already_in_party: { status: 409, message: 'That character is already in a party.' },
  party_closed: { status: 409, message: 'That party is closed.' },
  run_in_progress: { status: 409, message: 'This party already has a chapter run.' },
  table_in_use: { status: 409, message: COPY.tableInUse },
  table_full: { status: 409, message: COPY.tableFull },
  already_seated: { status: 409, message: 'You already hold a seat.' },
  game_in_play: { status: 409, message: COPY.standUpInPlay },
  not_settled: { status: 409, message: COPY.standUpNotSettled },
  rematch_required: { status: 409, message: 'Offer a rematch to play again.' },
  table_not_full: { status: 409, message: 'Every seat must be taken first.' },
  game_not_in_play: { status: 409, message: 'No game is in play at this table.' },
  stale_turn: { status: 409, message: COPY.staleTurn },
  turn_expired: { status: 409, message: COPY.turnExpired },
  trade_open: { status: 409, message: 'That player is already trading.' },
  trade_closed: { status: 409, message: 'This trade is closed.' },
  trade_changed: { status: 409, message: COPY.tradeChanged },
  not_paid: { status: 409, message: 'This purchase is not paid.' },
  already_refunded: { status: 409, message: COPY.alreadyRefunded },
  coins_spent: { status: 409, message: COPY.coinsSpent },
  idempotency_key_reused: {
    status: 409,
    message: 'That Idempotency-Key was used with a different body.',
  },

  unknown_field: { status: 422, message: FIELD_COPY.unknownField },
  validation: { status: 422, message: 'Check the highlighted fields.' },
  blocked: { status: 422, message: COPY.blocked },
  too_far: { status: 422, message: COPY.tooFar },
  not_buildable: { status: 422, message: COPY.notBuildable },
  no_block_in_inventory: { status: 422, message: 'You have no block of that material.' },
  no_block: { status: 422, message: COPY.noBlock },
  wrong_surface: { status: 422, message: 'That is the wrong surface for this vehicle.' },
  no_route: { status: 422, message: COPY.noRoute },
  same_tile: { status: 422, message: 'The vehicle is already on that tile.' },
  illegal_move: { status: 422, message: 'That move is not legal.' },
  missing_ingredients: { status: 422, message: 'Some ingredients are missing.' },
  empty_slot: { status: 422, message: 'That slot is empty.' },
  insufficient_coins: { status: 422, message: 'Not enough coins for the stake.' },

  daily_limit_reached: { status: 429, message: COPY.dailyLimitReached },
  billing_unavailable: { status: 503, message: COPY.billingOutage },
  storage_unavailable: { status: 503, message: COPY.saveNotWritten },
  database_unavailable: { status: 503, message: 'The database is unreachable. Try again shortly.' },
  internal: { status: 500, message: 'Something went wrong on the server.' },
};

/** Retry-After, in whole seconds, by status and code. */
function retryAfter(code: ErrorCode, status: number): number | null {
  if (code === 'billing_unavailable') return 30;
  if (code === 'storage_unavailable') return 10;
  if (code === 'database_unavailable') return 2;
  if (status === 423) return 10;
  return null;
}

interface ErrorDetail {
  /** Published copy for this occurrence, when it carries a value. */
  readonly message?: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly etag?: string;
  /** Only 429 carries a caller-computed Retry-After. */
  readonly retryAfterSeconds?: number;
}

class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail;

  constructor(code: ErrorCode, detail: ErrorDetail = {}) {
    super(detail.message ?? SPECS[code].message);
    this.code = code;
    this.detail = detail;
  }
}

export const fail = (code: ErrorCode, detail?: ErrorDetail): ApiError => new ApiError(code, detail);

interface BuiltError {
  readonly status: number;
  readonly body: {
    error: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    etag?: string;
  };
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The one error builder. Every error response in the app — handler refusals,
 * the global 500, the static-file 404 and event-stream error events — is built
 * here.
 */
export function buildError(error: unknown): BuiltError {
  if (!(error instanceof ApiError)) {
    process.stderr.write(
      `Unhandled failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
  }
  const api =
    error instanceof ApiError
      ? error
      : new ApiError('internal', { message: SPECS.internal.message });
  const spec = SPECS[api.code];
  const body: BuiltError['body'] = {
    error: api.code,
    message: api.detail.message ?? spec.message,
  };
  if (api.detail.fields !== undefined) body.fields = { ...api.detail.fields };
  if (api.code === 'precondition_failed') body.etag = api.detail.etag ?? '';

  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  const seconds = api.detail.retryAfterSeconds ?? retryAfter(api.code, spec.status);
  if (seconds !== null && seconds !== undefined) headers['Retry-After'] = String(Math.ceil(seconds));
  return { status: spec.status, body, headers };
}

export function sendError(res: Response, error: unknown): void {
  const built = buildError(error);
  if (res.headersSent) {
    res.end();
    return;
  }
  for (const [name, value] of Object.entries(built.headers)) res.setHeader(name, value);
  res.status(built.status).send(JSON.stringify(built.body));
}

