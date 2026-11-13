// Reading pieces (with their derived status, placement and history) and writing history.
import type pg from "pg";
import type { Piece, Plan, User } from "../shared/api";
import type { Cone, Rotation, Shape, Stage } from "../shared/rules";
import { daysOnShelf, firingStatus, PIECE_LABELS, pieceStatus, studioLabel, timeFields, type StoredPieceStatus } from "./clock";
import { pool, type Db } from "./db";
import { formatCubic, formatHalves, sidesOut } from "./measure";

export const SYSTEM_ACTOR = "Shelfmark";

export const pieceNumberText = (number: number) => String(number).padStart(4, "0");

/** A piece number from a path or body ("0401" or 401), or null when it is not one. */
export function parsePieceNumber(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

export interface PieceRow {
  number: number;
  member_id: number | null;
  guest_name: string | null;
  guest_email: string | null;
  shape: Shape;
  length_halves: number | null;
  width_halves: number | null;
  diameter_halves: number | null;
  height_halves: number;
  cubic_eighths: number;
  rate_ten_thousandths: number;
  discount_percent: number;
  order_minimum_cents: number;
  minimum_applied: boolean;
  fee_cents: number;
  rate_set_id: number;
  plan: Plan;
  stage: Stage | null;
  cone: Cone | null;
  clay_id: string;
  status: StoredPieceStatus;
  pickup_shelf: string | null;
  intake_photo_id: string;
  accepted_at: Date;
  ready_at: Date | null;
  kb_account_id: string;
  kb_invoice_id: string;
  member_name: string | null;
  member_email: string | null;
  member_number: string | null;
  firing_id: number | null;
  layer: number | null;
  x_halves: number | null;
  y_halves: number | null;
  rotation: Rotation | null;
  firing_stored: "building" | "started" | "unloaded" | null;
  firing_ends_at: Date | null;
  cool_until: Date | null;
}

const SELECT = `SELECT p.*, u.name AS member_name, u.email AS member_email, u.member_number,
    pl.firing_id, pl.layer, pl.x_halves, pl.y_halves, pl.rotation,
    f.status AS firing_stored, f.firing_ends_at, f.cool_until
  FROM pieces p
  LEFT JOIN users u ON u.id = p.member_id
  LEFT JOIN (placements pl JOIN firings f ON f.id = pl.firing_id AND f.status <> 'unloaded') ON pl.piece_number = p.number`;

export async function pieceRows(db: Db, where: string, params: unknown[], lock = false): Promise<PieceRow[]> {
  const found = await db.query<PieceRow>(`${SELECT} WHERE ${where} ORDER BY p.number${lock ? " FOR UPDATE OF p" : ""}`, params);
  return found.rows;
}

export const ownerName = (row: PieceRow) => row.member_name ?? row.guest_name ?? "";
export const ownerEmail = (row: PieceRow) => row.member_email ?? row.guest_email ?? "";

export function currentStatus(row: PieceRow, now: Date) {
  const firing =
    row.firing_stored === null ? null : firingStatus({ status: row.firing_stored, firing_ends_at: row.firing_ends_at, cool_until: row.cool_until }, now);
  return pieceStatus(row.status, firing);
}

/** Sides of a stored piece, in halves, for the placement rules. */
export function sidesHalves(row: PieceRow) {
  return {
    length: row.length_halves ?? undefined,
    width: row.width_halves ?? undefined,
    diameter: row.diameter_halves ?? undefined,
    height: row.height_halves,
  };
}

interface HistoryRow {
  piece_number: number;
  at: Date;
  actor: string;
  action: string;
}

export async function piecesOut(db: Db, rows: PieceRow[], now = new Date()): Promise<Piece[]> {
  const history = await db.query<HistoryRow>(
    "SELECT piece_number, at, actor, action FROM history WHERE piece_number = ANY($1::int[]) ORDER BY id",
    [rows.map((r) => r.number)],
  );
  const byPiece = new Map<number, HistoryRow[]>();
  for (const entry of history.rows) byPiece.set(entry.piece_number, [...(byPiece.get(entry.piece_number) ?? []), entry]);
  return rows.map((row) => {
    const status = currentStatus(row, now);
    return {
      number: pieceNumberText(row.number),
      owner:
        row.member_id === null
          ? { kind: "guest" as const, name: row.guest_name ?? "", email: row.guest_email ?? "", member_number: null }
          : { kind: "member" as const, name: row.member_name ?? "", email: row.member_email ?? "", member_number: row.member_number },
      shape: row.shape,
      sides_in: sidesOut(row.shape, sidesHalves(row)),
      cubic_inches: formatCubic(row.cubic_eighths),
      fee_cents: row.fee_cents,
      rate_set_id: row.rate_set_id,
      plan: row.plan,
      stage: row.stage,
      cone: row.cone,
      clay_id: row.clay_id,
      status,
      status_label: PIECE_LABELS[status],
      pickup_shelf: row.pickup_shelf,
      intake_photo_id: row.intake_photo_id,
      accepted_at: row.accepted_at.toISOString(),
      accepted_at_label: studioLabel(row.accepted_at),
      ...timeFields("ready_at", row.ready_at),
      days_on_shelf: row.ready_at && (status === "ready" || status === "uncollected") ? daysOnShelf(row.ready_at, now) : null,
      placement:
        row.firing_id === null
          ? null
          : {
              firing_id: row.firing_id,
              layer: row.layer ?? 1,
              x: formatHalves(row.x_halves ?? 0),
              y: formatHalves(row.y_halves ?? 0),
              rotation: row.rotation ?? 0,
            },
      history: (byPiece.get(row.number) ?? []).map((h) => ({
        at: h.at.toISOString(),
        at_label: studioLabel(h.at),
        actor: h.actor,
        action: h.action,
      })),
    };
  });
}

export async function pieceByNumber(number: number): Promise<Piece> {
  const [piece] = await piecesOut(pool, await pieceRows(pool, "p.number = $1", [number]));
  return piece;
}

export async function addHistory(client: pg.PoolClient, number: number, actor: string, action: string, at = new Date()): Promise<void> {
  await client.query("INSERT INTO history (piece_number, at, actor, action) VALUES ($1, $2, $3, $4)", [number, at, actor, action]);
}

/** Pieces a user may see: a member only their own, staff all. */
export function visibleTo(user: User): { where: string; params: unknown[] } {
  return user.role === "member" ? { where: "p.member_id = $1", params: [user.id] } : { where: "true", params: [] };
}
