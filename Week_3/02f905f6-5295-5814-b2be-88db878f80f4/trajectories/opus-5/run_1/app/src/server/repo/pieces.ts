import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  GlazeCone,
  HistoryEntry,
  PaymentStatus,
  Piece,
  PieceStatus,
  Plan,
  Rotation,
  Shape,
  Stage,
} from '../../shared/types';
import { PIECE_STATUS_LABELS, type HistoryAction } from '../../shared/labels';
import { query, queryOne } from '../db/pool';
import { env } from '../env';
import { effectivePieceStatus } from '../domain/pieceStatus';
import { firingStatusOf } from '../domain/schedule';
import { cubicMilliToString, halfUnitsToInches, sidesInOf } from '../domain/measure';
import { studioLabel } from '../domain/time';

export interface PieceRow {
  number: string;
  owner_kind: 'member' | 'guest';
  owner_user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  kb_account_id: string | null;
  shape: Shape;
  width_half: number;
  depth_half: number;
  height_half: number;
  cubic_milli: number;
  fee_cents: number;
  rate_set_id: number;
  plan: Plan;
  stage: Stage | null;
  cone: GlazeCone | null;
  clay_id: string;
  status: PieceStatus;
  pickup_shelf: string | null;
  intake_photo_id: string | null;
  invoice_id: string | null;
  payment_status: PaymentStatus | null;
  accepted_at: Date;
  ready_at: Date | null;
  reminder_sent_at: Date | null;
}

export interface PieceJoined extends PieceRow {
  member_name: string | null;
  member_number: string | null;
  member_email: string | null;
  firing_id: string | null;
  layer: number | null;
  x_half: number | null;
  y_half: number | null;
  rotation: Rotation | null;
  started_at: Date | null;
  firing_ends_at: Date | null;
  cool_until: Date | null;
  unloaded_at: Date | null;
}

const PIECE_SELECT = `
select p.*, u.name as member_name, u.member_number, u.email as member_email,
       cur.firing_id, cur.layer, cur.x_half, cur.y_half, cur.rotation,
       cur.started_at, cur.firing_ends_at, cur.cool_until, cur.unloaded_at
from pieces p
left join users u on u.id = p.owner_user_id
left join lateral (
  select pl.firing_id, pl.layer, pl.x_half, pl.y_half, pl.rotation,
         f.started_at, f.firing_ends_at, f.cool_until, f.unloaded_at
  from placements pl
  join firings f on f.id = pl.firing_id
  where pl.piece_number = p.number and f.unloaded_at is null
  limit 1
) cur on true`;

export function ownerEmail(row: PieceRow & { member_email?: string | null }): string {
  return row.owner_kind === 'member' ? (row.member_email ?? '') : (row.guest_email ?? '');
}

export function ownerName(row: PieceJoined): string {
  return row.owner_kind === 'member' ? (row.member_name ?? '') : (row.guest_name ?? '');
}

/** Whole studio days a ready piece has waited. */
export function daysOnShelf(readyAt: Date | null, now: Date): number | null {
  if (!readyAt) return null;
  const elapsed = (now.getTime() - readyAt.getTime()) / 1000;
  return Math.max(0, Math.floor(elapsed / env.pickupDaySeconds));
}

export function pieceStatusOf(row: PieceJoined, now: Date): PieceStatus {
  const firingStatus = row.firing_id
    ? firingStatusOf(
        {
          startedAt: row.started_at,
          firingEndsAt: row.firing_ends_at,
          coolUntil: row.cool_until,
          unloadedAt: row.unloaded_at,
        },
        now,
      )
    : null;
  return effectivePieceStatus(row.status, firingStatus);
}

export function toPiece(row: PieceJoined, history: HistoryEntry[], now: Date): Piece {
  const status = pieceStatusOf(row, now);
  return {
    number: row.number,
    owner: {
      kind: row.owner_kind,
      name: ownerName(row),
      email: ownerEmail(row),
      member_number: row.member_number,
    },
    shape: row.shape,
    sides_in: sidesInOf({
      shape: row.shape,
      width: row.width_half,
      depth: row.depth_half,
      height: row.height_half,
    }),
    cubic_inches: cubicMilliToString(row.cubic_milli),
    fee_cents: row.fee_cents,
    rate_set_id: row.rate_set_id,
    plan: row.plan,
    stage: row.stage,
    cone: row.cone,
    clay_id: row.clay_id,
    status,
    status_label: PIECE_STATUS_LABELS[status],
    pickup_shelf: row.pickup_shelf,
    intake_photo_id: row.intake_photo_id,
    accepted_at: row.accepted_at.toISOString(),
    accepted_at_label: studioLabel(row.accepted_at),
    ready_at: row.ready_at ? row.ready_at.toISOString() : null,
    ready_at_label: row.ready_at ? studioLabel(row.ready_at) : null,
    days_on_shelf: daysOnShelf(row.ready_at, now),
    payment_status: row.payment_status,
    placement:
      row.firing_id !== null && row.layer !== null
        ? {
            firing_id: row.firing_id,
            layer: row.layer,
            x: halfUnitsToInches(row.x_half as number),
            y: halfUnitsToInches(row.y_half as number),
            rotation: row.rotation as Rotation,
          }
        : null,
    history,
  };
}

interface HistoryRow {
  piece_number: string;
  at: Date;
  actor: string;
  action: string;
}

async function historyFor(numbers: string[]): Promise<Map<string, HistoryEntry[]>> {
  const map = new Map<string, HistoryEntry[]>();
  if (numbers.length === 0) return map;
  const rows = await query<HistoryRow>(
    `select piece_number, at, actor, action from piece_history
     where piece_number = any($1::text[]) order by at, id`,
    [numbers],
  );
  for (const row of rows) {
    const entries = map.get(row.piece_number) ?? [];
    entries.push({
      at: row.at.toISOString(),
      at_label: studioLabel(row.at),
      actor: row.actor,
      action: row.action,
    });
    map.set(row.piece_number, entries);
  }
  return map;
}

export async function loadPieces(filter: {
  ownerUserId?: string;
  status?: PieceStatus;
  numbers?: string[];
}): Promise<Piece[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.ownerUserId) {
    values.push(filter.ownerUserId);
    where.push(`p.owner_user_id = $${values.length}`);
  }
  if (filter.numbers) {
    values.push(filter.numbers);
    where.push(`p.number = any($${values.length}::text[])`);
  }
  const rows = await query<PieceJoined>(
    `${PIECE_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by p.number`,
    values,
  );
  const now = new Date();
  const history = await historyFor(rows.map((row) => row.number));
  const pieces = rows.map((row) => toPiece(row, history.get(row.number) ?? [], now));
  return filter.status ? pieces.filter((piece) => piece.status === filter.status) : pieces;
}

export async function findPieceJoined(number: string): Promise<PieceJoined | null> {
  return queryOne<PieceJoined>(`${PIECE_SELECT} where p.number = $1`, [number]);
}

export async function loadPiece(number: string): Promise<Piece | null> {
  const row = await findPieceJoined(number);
  if (!row) return null;
  const history = await historyFor([number]);
  return toPiece(row, history.get(number) ?? [], new Date());
}

export async function addHistory(
  client: PoolClient,
  pieceNumber: string,
  actor: string,
  action: HistoryAction,
): Promise<void> {
  await client.query(
    'insert into piece_history (piece_number, actor, action) values ($1, $2, $3)',
    [pieceNumber, actor, action],
  );
}

/** Piece numbers are four digits from a shared sequence; a failed intake skips one. */
export async function nextPieceNumber(): Promise<string> {
  const row = await queryOne<{ number: string }>(
    "select lpad(nextval('piece_number_seq')::text, 4, '0') as number",
  );
  return (row as { number: string }).number;
}

export interface NewPiece {
  number: string;
  ownerKind: 'member' | 'guest';
  ownerUserId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  kbAccountId: string | null;
  shape: Shape;
  widthHalf: number;
  depthHalf: number;
  heightHalf: number;
  cubicMilli: number;
  feeCents: number;
  rateSetId: number;
  plan: Plan;
  stage: Stage;
  cone: GlazeCone | null;
  clayId: string;
  status: PieceStatus;
  intakePhotoId: string;
  invoiceId: string;
  paymentStatus: PaymentStatus | null;
}

export async function insertPiece(client: PoolClient, piece: NewPiece): Promise<void> {
  await client.query(
    `insert into pieces (number, owner_kind, owner_user_id, guest_name, guest_email, kb_account_id,
       shape, width_half, depth_half, height_half, cubic_milli, fee_cents, rate_set_id, plan,
       stage, cone, clay_id, status, intake_photo_id, invoice_id, payment_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      piece.number,
      piece.ownerKind,
      piece.ownerUserId,
      piece.guestName,
      piece.guestEmail,
      piece.kbAccountId,
      piece.shape,
      piece.widthHalf,
      piece.depthHalf,
      piece.heightHalf,
      piece.cubicMilli,
      piece.feeCents,
      piece.rateSetId,
      piece.plan,
      piece.stage,
      piece.cone,
      piece.clayId,
      piece.status,
      piece.intakePhotoId,
      piece.invoiceId,
      piece.paymentStatus,
    ],
  );
}

/** Marks a drop-off paid and sends it to the queue. One payment wins. */
export async function markPaid(client: PoolClient, number: string): Promise<boolean> {
  const result = await client.query(
    `update pieces set payment_status = 'paid', status = 'queued'
     where number = $1 and payment_status = 'owed' and status = 'awaiting_payment'`,
    [number],
  );
  return result.rowCount === 1;
}

export async function markCollected(client: PoolClient, number: string): Promise<boolean> {
  const result = await client.query(
    `update pieces set status = 'collected'
     where number = $1 and status in ('ready', 'uncollected')`,
    [number],
  );
  return result.rowCount === 1;
}

export const TRACKING_TOKEN_BYTES = 24;

export async function createTrackingLink(client: PoolClient, number: string): Promise<string> {
  const token = randomBytes(TRACKING_TOKEN_BYTES).toString('base64url');
  await client.query('update tracking_links set active = false where piece_number = $1', [number]);
  await client.query('insert into tracking_links (token, piece_number) values ($1, $2)', [
    token,
    number,
  ]);
  return token;
}

export async function revokeTrackingLinks(client: PoolClient, number: string): Promise<void> {
  await client.query('update tracking_links set active = false where piece_number = $1', [number]);
}

export function trackingUrl(token: string): string {
  return `${env.publicUrl}/track/${token}`;
}

/** A tracking token reads exactly one piece, and dies with collection. */
export async function pieceForToken(token: string): Promise<PieceJoined | null> {
  const row = await queryOne<{ piece_number: string }>(
    'select piece_number from tracking_links where token = $1 and active',
    [token],
  );
  if (!row) return null;
  const piece = await findPieceJoined(row.piece_number);
  if (!piece || piece.status === 'collected') return null;
  return piece;
}
