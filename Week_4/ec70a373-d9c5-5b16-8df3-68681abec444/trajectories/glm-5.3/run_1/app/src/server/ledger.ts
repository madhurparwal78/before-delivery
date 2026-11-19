import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import type { MovementKind, Role } from '../types.js';
import { nowMs } from '../clock.js';


export interface MovementInput {
  memberId: string;
  tenantId: string;
  kind: MovementKind;
  fromAccount: string;
  toAccount: string;
  quarterHours: number;
  bookingId?: string | null;
  purchaseId?: string | null;
  actor: { userId: string; name: string; role: Role } | null;
  atMs: number;
  lots?: Array<{ lotId: number; purchaseId: string | null; quarterHours: number }>;
}

/** One movement: exactly two entries that cancel out, never edited or deleted. */
export async function writeMovement(client: DbClient, input: MovementInput): Promise<number> {
  const result = await clientQuery<{ id: string }>(
    client,
    `INSERT INTO movements (tenant_id, member_id, kind, booking_id, purchase_id, quarter_hours,
       from_account, to_account, actor_user_id, actor_name, actor_role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      input.tenantId,
      input.memberId,
      input.kind,
      input.bookingId ?? null,
      input.purchaseId ?? null,
      input.quarterHours,
      input.fromAccount,
      input.toAccount,
      input.actor?.userId ?? null,
      input.actor?.name ?? 'Pilotlight',
      input.actor?.role ?? null,
      input.atMs,
    ],
  );
  const movementId = Number(result[0].id);
  await clientQuery(
    client,
    `INSERT INTO movement_entries (movement_id, member_id, account, quarter_hours) VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
    [movementId, input.memberId, input.fromAccount, -input.quarterHours, input.toAccount, input.quarterHours],
  );
  for (const lot of input.lots ?? []) {
    await clientQuery(
      client,
      `INSERT INTO movement_lots (movement_id, lot_id, purchase_id, quarter_hours) VALUES ($1, $2, $3, $4)`,
      [movementId, lot.lotId, lot.purchaseId, lot.quarterHours],
    );
  }
  return movementId;
}

export interface LotRow extends Row {
  id: string;
  member_id: string;
  purchase_id: string | null;
  pack_name: string;
  valid_through: string | null;
  remainder_qh: number;
  purchase_seq: number;
  created_at: number;
}

export interface LotDraw {
  lotId: number;
  purchaseId: string | null;
  quarterHours: number;
}

/** Drawing order: earliest valid-through first, ties by earlier purchase, opening lot last. */
export const DRAW_ORDER_SQL = `ORDER BY (valid_through IS NULL), valid_through ASC, purchase_seq ASC, id ASC`;

export async function loadLots(client: DbClient, memberId: string): Promise<LotRow[]> {
  return clientQuery<LotRow>(
    client,
    `SELECT id, member_id, purchase_id, pack_name, valid_through, remainder_qh, purchase_seq, created_at
       FROM lots WHERE member_id = $1 ${DRAW_ORDER_SQL}`,
    [memberId],
  );
}

/** Draw quarter hours in lot order, updating remainders. Returns the draws in order. */
export async function drawFromLots(client: DbClient, memberId: string, quarterHours: number): Promise<LotDraw[]> {
  const lots = await loadLots(client, memberId);
  let left = quarterHours;
  const draws: LotDraw[] = [];
  for (const lot of lots) {
    if (left <= 0) break;
    const available = Number(lot.remainder_qh);
    if (available <= 0) continue;
    const take = Math.min(available, left);
    left -= take;
    draws.push({ lotId: Number(lot.id), purchaseId: lot.purchase_id, quarterHours: take });
    await clientQuery(
      client,
      `UPDATE lots SET remainder_qh = remainder_qh - $1 WHERE id = $2`,
      [take, lot.id],
    );
  }
  return draws;
}

/** Return order: to the lots the booking drew from, latest valid-through first, up to what each drew. */
export async function returnToLots(
  client: DbClient,
  memberId: string,
  bookingId: string,
  quarterHours: number,
): Promise<LotDraw[]> {
  const draws = await clientQuery<Row>(
    client,
    `SELECT d.lot_id, d.quarter_hours, l.valid_through, l.purchase_id
       FROM booking_lot_draw d JOIN lots l ON l.id = d.lot_id
      WHERE d.booking_id = $1 AND d.quarter_hours > 0
      ORDER BY (l.valid_through IS NULL), l.valid_through DESC, l.purchase_seq DESC, l.id DESC`,
    [bookingId],
  );
  const drawn = draws.map((row) => ({
    lotId: Number(row.lot_id),
    drawnQh: Number(row.quarter_hours),
    purchaseId: row.purchase_id as string | null,
    validThrough: row.valid_through as string | null,
  }));
  let left = quarterHours;
  const returns: LotDraw[] = [];
  for (const lot of drawn) {
    if (left <= 0) break;
    const room = Math.min(lot.drawnQh, left);
    if (room <= 0) continue;
    left -= room;
    returns.push({ lotId: lot.lotId, purchaseId: lot.purchaseId, quarterHours: room });
    await clientQuery(
      client,
      `UPDATE lots SET remainder_qh = remainder_qh + $1 WHERE id = $2`,
      [room, lot.lotId],
    );
  }
  return returns;
}

export async function recordBookingDraw(
  client: DbClient,
  bookingId: string,
  draws: LotDraw[],
): Promise<void> {
  for (const draw of draws) {
    await clientQuery(
      client,
      `INSERT INTO booking_lot_draw (booking_id, lot_id, purchase_id, quarter_hours) VALUES ($1, $2, $3, $4)
       ON CONFLICT (booking_id, lot_id) DO UPDATE SET quarter_hours = booking_lot_draw.quarter_hours + EXCLUDED.quarter_hours`,
      [bookingId, draw.lotId, draw.purchaseId, draw.quarterHours],
    );
  }
}

export interface MemberBalanceRow extends Row {
  available_qh: string;
  committed_qh: string;
}

export async function memberBalances(
  client: DbClient,
  memberId: string,
): Promise<{ availableQh: number; committedQh: number }> {
  const rows = await clientQuery<MemberBalanceRow>(
    client,
    `SELECT
       COALESCE(SUM(CASE WHEN account = 'available' THEN quarter_hours END), 0)::int AS available_qh,
       COALESCE(SUM(CASE WHEN account = 'committed' THEN quarter_hours END), 0)::int AS committed_qh
       FROM movement_entries WHERE member_id = $1`,
    [memberId],
  );
  const row = rows[0];
  return { availableQh: Number(row.available_qh), committedQh: Number(row.committed_qh) };
}
