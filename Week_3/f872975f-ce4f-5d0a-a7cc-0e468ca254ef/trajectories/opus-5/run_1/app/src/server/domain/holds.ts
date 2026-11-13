import { DEPOSIT_CENTS } from '../../shared/constants';
import { PiecePlacement, SaleKind, pieceShapes } from '../../shared/geometry';
import { Queryable, rows } from '../db/pool';
import { ApiError } from '../errors';
import { BoardRow } from './boards';
import { lockLineage } from './lineage';

export type HoldStatus = 'pending-payment' | 'held' | 'released' | 'converted-to-sale';
export type ReleaseReason = null | 'cancelled' | 'expired' | 'payment-failed';

export interface HoldRow {
  id: string;
  board_tag: string;
  maker_id: string;
  status: HoldStatus;
  release_reason: ReleaseReason;
  pieces: PiecePlacement[];
  cuts_mm: number[];
  take_mm: number;
  sale: SaleKind;
  offcut_mm: number | null;
  price_cents: number;
  deposit_cents: number;
  created_at: Date;
  held_at: Date | null;
  expires_at: Date | null;
  killbill_payment_id: string | null;
  maker_name: string;
}

const HOLD_COLUMNS = `
  h.id, h.board_tag, h.maker_id, h.status, h.release_reason, h.pieces, h.cuts_mm, h.take_mm, h.sale,
  h.offcut_mm, h.price_cents, h.deposit_cents, h.created_at, h.held_at, h.expires_at, h.killbill_payment_id,
  u.name AS maker_name
`;

export function holdShape(hold: HoldRow, withMaker: boolean): Record<string, unknown> {
  const shape: Record<string, unknown> = {
    id: hold.id,
    board: hold.board_tag,
    status: hold.status,
    release_reason: hold.release_reason,
    pieces: pieceShapes(hold.pieces),
    cuts_mm: hold.cuts_mm,
    take_mm: hold.take_mm,
    sale: hold.sale,
    offcut_mm: hold.offcut_mm,
    price_cents: hold.price_cents,
    deposit_cents: hold.deposit_cents,
    created_at: hold.created_at.toISOString(),
    held_at: hold.held_at === null ? null : hold.held_at.toISOString(),
    expires_at: hold.expires_at === null ? null : hold.expires_at.toISOString(),
    killbill_payment_id: hold.killbill_payment_id
  };
  if (withMaker) shape.maker = { name: hold.maker_name };
  return shape;
}

export async function loadHold(client: Queryable, id: string): Promise<HoldRow | null> {
  const found = await rows<HoldRow>(
    client,
    `SELECT ${HOLD_COLUMNS} FROM holds h JOIN users u ON u.id = h.maker_id WHERE h.id = $1`,
    [id]
  );
  return found[0] ?? null;
}

export async function loadHoldsForMaker(client: Queryable, makerId: string): Promise<HoldRow[]> {
  return rows<HoldRow>(
    client,
    `SELECT ${HOLD_COLUMNS} FROM holds h JOIN users u ON u.id = h.maker_id
     WHERE h.maker_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
    [makerId]
  );
}

export async function loadAllHolds(client: Queryable): Promise<HoldRow[]> {
  return rows<HoldRow>(
    client,
    `SELECT ${HOLD_COLUMNS} FROM holds h JOIN users u ON u.id = h.maker_id ORDER BY h.created_at DESC, h.id DESC`
  );
}

/** The caller's own live hold on a board, used for `my_hold`. */
export async function loadMyHold(client: Queryable, tag: string, makerId: string): Promise<HoldRow | null> {
  const found = await rows<HoldRow>(
    client,
    `SELECT ${HOLD_COLUMNS} FROM holds h JOIN users u ON u.id = h.maker_id
     WHERE h.board_tag = $1 AND h.maker_id = $2 AND h.status IN ('pending-payment', 'held')
     ORDER BY h.created_at DESC LIMIT 1`,
    [tag, makerId]
  );
  return found[0] ?? null;
}

/** A hold is active only while server now is before its expiry. */
export function isActive(hold: HoldRow, now: Date): boolean {
  return hold.status === 'held' && hold.expires_at !== null && now.getTime() < hold.expires_at.getTime();
}

/**
 * Releases every `held` hold whose expiry has passed and returns its board to the rack,
 * so untouched records read correctly.
 */
export async function releaseExpiredHolds(client: Queryable, now: Date): Promise<void> {
  await client.query(
    `WITH expired AS (
       UPDATE holds SET status = 'released', release_reason = 'expired'
       WHERE status = 'held' AND expires_at <= $1
       RETURNING board_tag
     )
     UPDATE boards SET status = 'available'
     WHERE tag IN (SELECT board_tag FROM expired) AND status = 'held'`,
    [now]
  );
}

async function expireOne(client: Queryable, hold: HoldRow): Promise<void> {
  await client.query(`UPDATE holds SET status = 'released', release_reason = 'expired' WHERE id = $1`, [hold.id]);
  await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'`, [hold.board_tag]);
}

/** Locks a hold and settles its expiry before anything else happens to it. */
export async function lockHoldAndSettleExpiry(client: Queryable, id: string, now: Date): Promise<HoldRow | null> {
  const locked = await rows<{ id: string }>(client, 'SELECT id FROM holds WHERE id = $1 FOR UPDATE', [id]);
  if (locked[0] === undefined) return null;
  const hold = await loadHold(client, id);
  if (hold === null) return null;
  if (hold.status === 'held' && !isActive(hold, now)) {
    await expireOne(client, hold);
    return { ...hold, status: 'released', release_reason: 'expired' };
  }
  return hold;
}

export interface ClaimedLayout {
  pieces: PiecePlacement[];
  cuts_mm: number[];
  take_mm: number;
  sale: SaleKind;
  offcut_mm: number | null;
  price_cents: number;
}

async function nextHoldId(client: Queryable): Promise<string> {
  const allocated = await rows<{ value: string }>(client, "SELECT nextval('hold_id_seq')::text AS value");
  const value = allocated[0]?.value;
  if (value === undefined) throw new Error('hold id was not allocated');
  return `H-${value.padStart(4, '0')}`;
}

/**
 * Claims a board for a maker. Exactly one of any number of simultaneous claims wins; the
 * others get `already_held`.
 */
export async function claimBoard(
  client: Queryable,
  board: BoardRow,
  makerId: string,
  layout: ClaimedLayout,
  now: Date
): Promise<HoldRow> {
  await lockLineage(client, board.tag);
  const locked = await rows<{ status: string }>(client, 'SELECT status FROM boards WHERE tag = $1 FOR UPDATE', [board.tag]);
  const live = await rows<HoldRow>(
    client,
    `SELECT ${HOLD_COLUMNS} FROM holds h JOIN users u ON u.id = h.maker_id
     WHERE h.board_tag = $1 AND h.status IN ('pending-payment', 'held') FOR UPDATE OF h`,
    [board.tag]
  );
  for (const hold of live) {
    if (hold.status === 'held' && !isActive(hold, now)) {
      await expireOne(client, hold);
      continue;
    }
    throw new ApiError('already_held');
  }
  const current = locked[0]?.status ?? board.status;
  const afterExpiry = live.length > 0 && current === 'held' ? 'available' : current;
  if (afterExpiry !== 'available') throw new ApiError('board_state');
  const id = await nextHoldId(client);
  await client.query(
    `INSERT INTO holds (id, board_tag, maker_id, status, pieces, cuts_mm, take_mm, sale, offcut_mm,
                        price_cents, deposit_cents, created_at)
     VALUES ($1, $2, $3, 'pending-payment', $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      board.tag,
      makerId,
      JSON.stringify(layout.pieces),
      JSON.stringify(layout.cuts_mm),
      layout.take_mm,
      layout.sale,
      layout.offcut_mm,
      layout.price_cents,
      DEPOSIT_CENTS,
      now
    ]
  );
  const created = await loadHold(client, id);
  if (created === null) throw new Error('hold was not created');
  return created;
}

export async function markHeld(client: Queryable, id: string, paymentId: string, now: Date, holdSeconds: number): Promise<void> {
  const expiresAt = new Date(now.getTime() + holdSeconds * 1000);
  await client.query(
    `UPDATE holds SET status = 'held', held_at = $2, expires_at = $3, killbill_payment_id = $4 WHERE id = $1`,
    [id, now, expiresAt, paymentId]
  );
  const hold = await loadHold(client, id);
  if (hold !== null) {
    await client.query(`UPDATE boards SET status = 'held' WHERE tag = $1`, [hold.board_tag]);
  }
}

export async function markPaymentFailed(client: Queryable, id: string, paymentId: string | null): Promise<void> {
  await client.query(
    `UPDATE holds SET status = 'released', release_reason = 'payment-failed', killbill_payment_id = COALESCE($2, killbill_payment_id)
     WHERE id = $1`,
    [id, paymentId]
  );
}
