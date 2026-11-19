import { pool } from '../db/pool.js';
import { isUuid } from '../domain/validate.js';
import type { Context } from '../http/router.js';
import type { MarketRow, OrderRow } from '../domain/types.js';

type Lookup = Omit<Context<undefined>, 'resource'>;

const MARKET_COLUMNS =
  'id, venue_id, kind, symbol, title, status, closes_at, outcome, last_price, book_sequence, resolved_at, settled_at';

const ORDER_COLUMNS =
  'id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity, status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, book_side, book_price, sequence, created_at';

/** A malformed id, an unknown id and another venue's id all answer the same not found. */
export async function marketOfVenue(context: Lookup): Promise<MarketRow | null> {
  const venue = context.actor.venue;
  const id = context.params.id ?? '';
  if (venue === null || !isUuid(id)) return null;
  const result = await pool.query<MarketRow>(
    `select ${MARKET_COLUMNS} from markets where id = $1 and venue_id = $2`,
    [id, venue.id],
  );
  return result.rows[0] ?? null;
}

export async function marketById(id: string, venueId: string): Promise<MarketRow | null> {
  if (!isUuid(id)) return null;
  const result = await pool.query<MarketRow>(
    `select ${MARKET_COLUMNS} from markets where id = $1 and venue_id = $2`,
    [id, venueId],
  );
  return result.rows[0] ?? null;
}

export async function ownOrder(context: Lookup): Promise<OrderRow | null> {
  const id = context.params.id ?? '';
  if (!isUuid(id)) return null;
  const result = await pool.query<OrderRow>(
    `select ${ORDER_COLUMNS} from orders where id = $1 and member_id = $2`,
    [id, context.actor.member.id],
  );
  return result.rows[0] ?? null;
}

export interface DepositRow {
  id: string;
  venue_id: string;
  member_id: string;
  amount_cents: number;
  status: 'succeeded' | 'declined';
  card_last4: string;
  killbill_payment_id: string | null;
  created_at: Date;
}

const DEPOSIT_COLUMNS =
  'id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id, created_at';

export async function ownDeposit(context: Lookup): Promise<DepositRow | null> {
  const id = context.params.id ?? '';
  if (!isUuid(id)) return null;
  const result = await pool.query<DepositRow>(
    `select ${DEPOSIT_COLUMNS} from deposits where id = $1 and member_id = $2`,
    [id, context.actor.member.id],
  );
  return result.rows[0] ?? null;
}

export async function depositOfVenue(context: Lookup): Promise<DepositRow | null> {
  const venue = context.actor.venue;
  const id = context.params.id ?? '';
  if (venue === null || !isUuid(id)) return null;
  const result = await pool.query<DepositRow>(
    `select ${DEPOSIT_COLUMNS} from deposits where id = $1 and venue_id = $2`,
    [id, venue.id],
  );
  return result.rows[0] ?? null;
}

export interface StatementRow {
  id: string;
  venue_id: string;
  member_id: string;
  month: string;
  object_key: string;
}

export async function ownStatement(context: Lookup): Promise<StatementRow | null> {
  const id = context.params.id ?? '';
  if (!isUuid(id)) return null;
  const result = await pool.query<StatementRow>(
    'select id, venue_id, member_id, month, object_key from statements where id = $1 and member_id = $2',
    [id, context.actor.member.id],
  );
  return result.rows[0] ?? null;
}

export interface DocumentRow {
  id: string;
  venue_id: string;
  member_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: Date;
}

export async function documentOfVenue(context: Lookup): Promise<DocumentRow | null> {
  const venue = context.actor.venue;
  const id = context.params.id ?? '';
  if (venue === null || !isUuid(id)) return null;
  const result = await pool.query<DocumentRow>(
    'select id, venue_id, member_id, filename, content_type, size_bytes, uploaded_at from documents where id = $1 and venue_id = $2',
    [id, venue.id],
  );
  return result.rows[0] ?? null;
}

export async function ownApiKey(context: Lookup): Promise<{ id: string; key_id: string } | null> {
  const id = context.params.id ?? '';
  if (!isUuid(id)) return null;
  const result = await pool.query<{ id: string; key_id: string }>(
    'select id, key_id from api_keys where id = $1 and member_id = $2',
    [id, context.actor.member.id],
  );
  return result.rows[0] ?? null;
}

export async function ownFill(context: Lookup): Promise<{ id: string } | null> {
  const id = context.params.id ?? '';
  if (!isUuid(id)) return null;
  const result = await pool.query<{ id: string }>(
    'select id from fills where id = $1 and member_id = $2',
    [id, context.actor.member.id],
  );
  return result.rows[0] ?? null;
}

export const TRADING_ROLES = ['trader', 'builder'] as const;
