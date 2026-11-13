// Records and their response shapes: boards, rates in force, holds, tickets, invoices, the ledger
// and lineage traversal. Every serialiser here produces exactly the keys the API publishes.
import type { Board, BoardSummary, Hold, Invoice, Photo, Rate, Ticket, User } from "../shared/api";
import {
  boardFeet, longestClearRun, OPEN_STATUSES, priceCents, volumeMm3,
  type BoardStatus, type DefectZone, type Grade, type HoldStatus, type Piece, type ReleaseReason, type Sale, type Species,
  type TicketStatus,
} from "../shared/domain";
import { query, one, type Db } from "./db";
import { ApiError } from "./http";

export const iso = (d: Date): string => d.toISOString();
export const now = (): Date => new Date();

export interface BoardRow {
  tag: string;
  species: Species;
  grade: Grade | null;
  status: BoardStatus;
  lot_id: string;
  lot_name: string;
  lot_origin: string;
  lot_built_year: number;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  defects: DefectZone[];
  parent_tag: string | null;
  cut_ticket: string | null;
  created_at: Date;
}

const BOARD_SELECT = `SELECT b.tag, b.species, b.grade, b.status, b.lot_id, l.name AS lot_name, l.origin AS lot_origin,
  l.built_year AS lot_built_year, b.length_mm, b.width_mm, b.thickness_mm, b.defects, b.parent_tag, b.cut_ticket, b.created_at
  FROM boards b JOIN lots l ON l.id = b.lot_id`;

export async function boardRow(db: Db, tag: string, lock = false): Promise<BoardRow | undefined> {
  return one<BoardRow>(db, `${BOARD_SELECT} WHERE b.tag = $1${lock ? " FOR UPDATE OF b" : ""}`, [tag]);
}

export async function boardRows(db: Db, where: string, params: unknown[]): Promise<BoardRow[]> {
  return query<BoardRow>(db, `${BOARD_SELECT} WHERE ${where} ORDER BY b.tag`, params);
}

export const isOpen = (status: BoardStatus): boolean => (OPEN_STATUSES as readonly string[]).includes(status);
export const isPublicStatus = (status: BoardStatus): boolean => status === "available" || status === "held";

/** Staff see every board; everyone else sees Available and Held boards only. */
export function visibleTo(row: BoardRow, staff: boolean): boolean {
  return staff || isPublicStatus(row.status);
}

// ---- rates ----

type RateTable = Map<string, number>;

interface RateRow {
  species: Species;
  grade: Grade;
  rate_cents: number;
  effective_at: Date;
}

/** The version in force at instant t: latest effective_at at or before t, the later-created one on a tie. */
export async function ratesInForce(db: Db, at: Date): Promise<{ table: RateTable; rows: Rate[] }> {
  const rows = await query<RateRow>(db,
    `SELECT DISTINCT ON (species, grade) species, grade, rate_cents, effective_at FROM rates
     WHERE effective_at <= $1 ORDER BY species, grade, effective_at DESC, id DESC`, [at]);
  const table: RateTable = new Map();
  for (const r of rows) table.set(`${r.species}|${r.grade}`, r.rate_cents);
  return {
    table,
    rows: rows.map((r) => ({ species: r.species, grade: r.grade, rate_cents: r.rate_cents, effective_at: iso(r.effective_at) }))
      .sort((a, b) => a.species.localeCompare(b.species) || a.grade.localeCompare(b.grade)),
  };
}

export async function scheduledRates(db: Db, at: Date): Promise<Rate[]> {
  const rows = await query<RateRow>(db,
    "SELECT species, grade, rate_cents, effective_at FROM rates WHERE effective_at > $1 ORDER BY effective_at, species, grade, id", [at]);
  return rows.map((r) => ({ species: r.species, grade: r.grade, rate_cents: r.rate_cents, effective_at: iso(r.effective_at) }));
}

function rateFor(row: { species: Species; grade: Grade | null; status: BoardStatus }, rates: RateTable): number | null {
  if (row.grade === null || !isOpen(row.status)) return null;
  return rates.get(`${row.species}|${row.grade}`) ?? null;
}

// ---- boards ----

export function boardFigures(row: BoardRow, rates: RateTable) {
  const volume = volumeMm3(row.thickness_mm, row.width_mm, row.length_mm);
  const rate = rateFor(row, rates);
  return {
    volume_mm3: volume,
    board_feet: boardFeet(volume),
    rate_cents: rate,
    price_cents: rate === null ? null : priceCents(row.thickness_mm, row.width_mm, row.length_mm, rate),
    longest_clear_mm: longestClearRun(0, row.length_mm, row.defects),
  };
}

const orderedDefects = (zones: DefectZone[]): DefectZone[] =>
  zones.map((d) => ({ kind: d.kind, start_mm: d.start_mm, end_mm: d.end_mm }));

export function boardSummary(row: BoardRow, rates: RateTable): BoardSummary {
  const f = boardFigures(row, rates);
  return {
    tag: row.tag, species: row.species, grade: row.grade, status: row.status,
    lot: { id: row.lot_id, name: row.lot_name },
    length_mm: row.length_mm, width_mm: row.width_mm, thickness_mm: row.thickness_mm,
    volume_mm3: f.volume_mm3, board_feet: f.board_feet, rate_cents: f.rate_cents, price_cents: f.price_cents,
    longest_clear_mm: f.longest_clear_mm, defects: orderedDefects(row.defects), parent_tag: row.parent_tag,
  };
}

interface PhotoRow {
  id: string;
  width: number;
  height: number;
}

export async function boardDetail(db: Db, row: BoardRow, rates: RateTable, viewer: User | null): Promise<Board> {
  const photos = await query<PhotoRow>(db, "SELECT id, width, height FROM photos WHERE board_tag = $1 ORDER BY id", [row.tag]);
  let myHold: Hold | null = null;
  if (viewer?.role === "maker") {
    const h = await one<HoldRow>(db,
      `${HOLD_SELECT} WHERE h.board_tag = $1 AND h.maker_id = $2 AND h.status IN ('pending-payment','held')
       ORDER BY h.created_at DESC LIMIT 1`, [row.tag, viewer.id]);
    myHold = h ? holdJson(h, false) : null;
  }
  const summary = boardSummary(row, rates);
  return {
    ...summary,
    lot: { id: row.lot_id, name: row.lot_name, origin: row.lot_origin, built_year: row.lot_built_year },
    photos: photos.map((p): Photo => ({ id: p.id, url: `/api/photos/${p.id}`, thumb_url: `/api/photos/${p.id}/thumb`, width: p.width, height: p.height })),
    my_hold: myHold,
  };
}

export async function nextTag(db: Db): Promise<string> {
  const row = await one<{ n: number }>(db, "SELECT nextval('board_tag_seq')::int AS n");
  return `KW-${String(row?.n ?? 0).padStart(4, "0")}`;
}

export async function nextId(db: Db, sequence: "hold_seq" | "ticket_seq" | "invoice_seq" | "photo_seq", prefix: string): Promise<string> {
  const row = await one<{ n: number }>(db, `SELECT nextval('${sequence}')::int AS n`);
  return `${prefix}-${String(row?.n ?? 0).padStart(4, "0")}`;
}

// ---- ledger ----

interface Entry {
  account: string;
  volume_mm3: number;
}

export async function writeMovement(
  db: Db, kind: "intake" | "split" | "whole-sale" | "trim" | "adjustment", ticket: string | null, by: number | null, entries: Entry[], at: Date,
): Promise<void> {
  if (entries.reduce((s, e) => s + e.volume_mm3, 0) !== 0) throw new Error(`unbalanced ${kind} movement`);
  const m = await one<{ id: number }>(db,
    "INSERT INTO movements (kind, created_at, ticket_id, by_user) VALUES ($1, $2, $3, $4) RETURNING id", [kind, at, ticket, by]);
  for (const e of entries) {
    await db.query("INSERT INTO entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3)", [m?.id, e.account, e.volume_mm3]);
  }
}

export async function balance(db: Db, account: string): Promise<number> {
  const row = await one<{ v: number }>(db, "SELECT COALESCE(SUM(volume_mm3), 0)::bigint AS v FROM entries WHERE account = $1", [account]);
  return row?.v ?? 0;
}

// ---- holds ----

export interface HoldRow {
  id: string;
  board_tag: string;
  maker_id: number;
  maker_name: string;
  status: HoldStatus;
  release_reason: ReleaseReason | null;
  pieces: Piece[];
  cuts_mm: number[];
  take_mm: number;
  sale: Sale;
  offcut_mm: number | null;
  price_cents: number;
  deposit_cents: number;
  created_at: Date;
  held_at: Date | null;
  expires_at: Date | null;
  killbill_payment_id: string | null;
}

export const HOLD_SELECT = `SELECT h.id, h.board_tag, h.maker_id, u.name AS maker_name, h.status, h.release_reason, h.pieces, h.cuts_mm,
  h.take_mm, h.sale, h.offcut_mm, h.price_cents, h.deposit_cents, h.created_at, h.held_at, h.expires_at, h.killbill_payment_id
  FROM holds h JOIN users u ON u.id = h.maker_id`;

export const orderedPieces = (pieces: Piece[]): Piece[] =>
  pieces.map((p) => ({ label: p.label, length_mm: p.length_mm, width_mm: p.width_mm, start_mm: p.start_mm }));

export function holdJson(h: HoldRow, withMaker: boolean): Hold {
  const hold: Hold = {
    id: h.id, board: h.board_tag, status: h.status, release_reason: h.release_reason, pieces: orderedPieces(h.pieces),
    cuts_mm: h.cuts_mm, take_mm: h.take_mm, sale: h.sale, offcut_mm: h.offcut_mm, price_cents: h.price_cents,
    deposit_cents: h.deposit_cents, created_at: iso(h.created_at), held_at: h.held_at ? iso(h.held_at) : null,
    expires_at: h.expires_at ? iso(h.expires_at) : null, killbill_payment_id: h.killbill_payment_id,
  };
  return withMaker ? { ...hold, maker: { name: h.maker_name } } : hold;
}

/** Holds nobody acted on: release every held hold at or past its expiry, keeping the deposit. */
export async function releaseExpiredHolds(db: Db, at: Date): Promise<void> {
  await db.query(
    `WITH expired AS (
       SELECT id, board_tag FROM holds WHERE status = 'held' AND expires_at <= $1 FOR UPDATE SKIP LOCKED),
     released AS (
       UPDATE holds h SET status = 'released', release_reason = 'expired' FROM expired e WHERE h.id = e.id RETURNING h.board_tag)
     UPDATE boards b SET status = 'available' FROM released r WHERE b.tag = r.board_tag AND b.status = 'held'`, [at]);
}

/** Inside a locked step: a held hold at or past its expiry is released as expired, board back on the rack. */
export async function expireIfDue(db: Db, h: HoldRow, at: Date): Promise<boolean> {
  if (h.status !== "held" || h.expires_at === null || at < h.expires_at) return false;
  await db.query("UPDATE holds SET status = 'released', release_reason = 'expired' WHERE id = $1", [h.id]);
  await db.query("UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'", [h.board_tag]);
  h.status = "released";
  h.release_reason = "expired";
  return true;
}

// ---- tickets and invoices ----

interface TicketRow {
  id: string;
  status: TicketStatus;
  board_tag: string;
  maker_id: number;
  maker_name: string;
  pieces: Piece[];
  cuts_mm: number[];
  take_mm: number;
  sale: Sale;
  offcut_tag: string | null;
  planned_mm: number | null;
  measured_mm: number | null;
  pdf_key: string;
  created_at: Date;
}

interface EventRow {
  ticket_id: string;
  kind: "issued" | "started" | "done";
  name: string;
  at: Date;
}

export async function ticketsWhere(db: Db, where: string, params: unknown[]): Promise<(Ticket & { makerId: number })[]> {
  const rows = await query<TicketRow>(db,
    `SELECT t.id, t.status, t.board_tag, t.maker_id, u.name AS maker_name, t.pieces, t.cuts_mm, t.take_mm, t.sale, t.offcut_tag,
       t.planned_mm, t.measured_mm, t.pdf_key, t.created_at
     FROM tickets t JOIN users u ON u.id = t.maker_id WHERE ${where} ORDER BY t.created_at, t.id`, params);
  if (rows.length === 0) return [];
  const events = await query<EventRow>(db,
    `SELECT e.ticket_id, e.kind, u.name, e.at FROM ticket_events e JOIN users u ON u.id = e.by_user
     WHERE e.ticket_id = ANY($1) ORDER BY e.at, e.id`, [rows.map((r) => r.id)]);
  return rows.map((t) => ({
    makerId: t.maker_id,
    id: t.id, status: t.status, board: t.board_tag, maker: { name: t.maker_name }, pieces: orderedPieces(t.pieces),
    cuts_mm: t.cuts_mm, take_mm: t.take_mm, sale: t.sale,
    offcut: t.offcut_tag === null || t.planned_mm === null ? null : { tag: t.offcut_tag, planned_mm: t.planned_mm, measured_mm: t.measured_mm },
    pdf_key: t.pdf_key, created_at: iso(t.created_at),
    events: events.filter((e) => e.ticket_id === t.id).map((e) => ({ kind: e.kind, by: { name: e.name }, at: iso(e.at) })),
  }));
}

export const publicTicket = ({ makerId: _maker, ...ticket }: Ticket & { makerId: number }): Ticket => ticket;

interface InvoiceRow {
  id: string;
  ticket_id: string;
  board_tag: string;
  maker_id: number;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  lines: Invoice["lines"];
  paid_at: Date;
  killbill_payment_id: string;
}

export async function invoicesWhere(db: Db, where: string, params: unknown[]): Promise<(Invoice & { makerId: number })[]> {
  const rows = await query<InvoiceRow>(db, `SELECT * FROM invoices WHERE ${where} ORDER BY paid_at DESC, id DESC`, params);
  return rows.map((r) => ({
    makerId: r.maker_id,
    id: r.id, ticket: r.ticket_id, board: r.board_tag, price_cents: r.price_cents, deposit_cents: r.deposit_cents,
    amount_cents: r.amount_cents,
    lines: r.lines.map((l) => ({ label: l.label, length_mm: l.length_mm, amount_cents: l.amount_cents })),
    status: "paid", paid_at: iso(r.paid_at), killbill_payment_id: r.killbill_payment_id,
  }));
}

export const publicInvoice = ({ makerId: _maker, ...invoice }: Invoice & { makerId: number }): Invoice => invoice;

// ---- lineage ----

interface LineageRow {
  tag: string;
  parent_tag: string | null;
  status: BoardStatus;
  created_at: Date;
}

/** The root of a board's lineage, following parents upward. */
async function lineageRoot(db: Db, tag: string): Promise<string> {
  const row = await one<{ tag: string }>(db,
    `WITH RECURSIVE up AS (
       SELECT tag, parent_tag, 0 AS depth FROM boards WHERE tag = $1
       UNION ALL SELECT b.tag, b.parent_tag, up.depth + 1 FROM boards b JOIN up ON b.tag = up.parent_tag WHERE up.depth < 10000)
     SELECT tag FROM up ORDER BY depth DESC LIMIT 1`, [tag]);
  return row?.tag ?? tag;
}

/** Serialises corrections, claims and sales within one lineage on its root's row. */
export async function lockLineage(db: Db, tag: string): Promise<void> {
  await db.query("SELECT tag FROM boards WHERE tag = $1 FOR UPDATE", [await lineageRoot(db, tag)]);
}

/** Every board below `tag`, parent before child and siblings by creation order. */
export async function descendantsInOrder(db: Db, tag: string): Promise<LineageRow[]> {
  const rows = await query<LineageRow>(db,
    `WITH RECURSIVE down AS (
       SELECT tag, parent_tag, status, created_at FROM boards WHERE parent_tag = $1
       UNION ALL SELECT b.tag, b.parent_tag, b.status, b.created_at FROM boards b JOIN down d ON b.parent_tag = d.tag)
     SELECT * FROM down`, [tag]);
  const children = new Map<string, LineageRow[]>();
  for (const r of rows) {
    const list = children.get(r.parent_tag ?? "") ?? [];
    list.push(r);
    children.set(r.parent_tag ?? "", list);
  }
  const out: LineageRow[] = [];
  const walk = (parent: string): void => {
    const kids = (children.get(parent) ?? []).sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.tag.localeCompare(b.tag));
    for (const k of kids) {
      out.push(k);
      walk(k.tag);
    }
  };
  walk(tag);
  return out;
}

export async function ticketStatusOf(db: Db, ticketId: string | null): Promise<TicketStatus | null> {
  if (ticketId === null) return null;
  const row = await one<{ status: TicketStatus }>(db, "SELECT status FROM tickets WHERE id = $1", [ticketId]);
  return row?.status ?? null;
}

export function notFound(): never {
  throw new ApiError("not_found");
}
