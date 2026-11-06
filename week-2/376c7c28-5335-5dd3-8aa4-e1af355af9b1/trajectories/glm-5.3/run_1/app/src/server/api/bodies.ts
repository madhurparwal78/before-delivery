import type { Db } from "../db";
import { q, one } from "../db";
import type { ChargeRow, PieceRow, StudioRow } from "../types";
import { feeCents } from "../quote";
import { computeLoadFigures } from "../loads";
import type { Person, Studio } from "../http/context";

// Response body builders, in exactly one place each.

type TicketQueryRow = {
  id: string;
  title: string;
  status: string;
  clay_body: string;
  length_in: number;
  width_in: number;
  height_in: number;
  photo_key: string | null;
  owner_handle: string;
  waiting_since: Date | null;
};

const TICKET_SELECT = `SELECT p.id, p.title, p.status, cb.name AS clay_body, p.length_in, p.width_in, p.height_in,
        p.photo_key, o.handle AS owner_handle, p.waiting_since
   FROM pieces p
   JOIN clay_bodies cb ON cb.id = p.clay_body_id
   JOIN people o ON o.id = p.owner_id`;

export type TicketBody = {
  id: string;
  title: string;
  status: string;
  clay_body: string;
  length_in: number;
  width_in: number;
  height_in: number;
  photo_url: string | null;
  owner_handle: string;
  waiting_since: Date | null;
};

export function ticketBody(r: TicketQueryRow): TicketBody {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    clay_body: r.clay_body,
    length_in: r.length_in,
    width_in: r.width_in,
    height_in: r.height_in,
    photo_url: r.photo_key !== null ? `/api/pieces/${r.id}/photo` : null,
    owner_handle: r.owner_handle,
    waiting_since: r.waiting_since,
  };
}

export async function ticketById(db: Db, pieceId: string): Promise<TicketQueryRow | undefined> {
  return one<TicketQueryRow>(db, `${TICKET_SELECT} WHERE p.id = $1`, [pieceId]);
}

export async function passportBody(db: Db, piece: PieceRow): Promise<Record<string, unknown>> {
  const [ticket, history, charges, placement] = await Promise.all([
    ticketById(db, piece.id),
    q<{ status: string; at: Date }>(db, "SELECT status, at FROM piece_history WHERE piece_id = $1 ORDER BY at, id", [piece.id]),
    q<ChargeRow>(db, "SELECT * FROM charges WHERE piece_id = $1 ORDER BY created_at, id", [piece.id]),
    one<{ load_id: string; deck: number; kiln_name: string }>(
      db,
      `SELECT pl.load_id, pl.deck, k.name AS kiln_name
         FROM placements pl JOIN loads l ON l.id = pl.load_id JOIN kilns k ON k.id = l.kiln_id
        WHERE pl.piece_id = $1`,
      [piece.id],
    ),
  ]);
  const rounded = {
    length_in: piece.rounded_l_half / 2,
    width_in: piece.rounded_w_half / 2,
    height_in: piece.rounded_h_half / 2,
  };
  const quote = {
    quoted_at: piece.quoted_at,
    rates_effective_from: piece.rates_effective_from,
    membership: piece.membership,
    bisque: { rate_cents: piece.bisque_rate_cents, fee_cents: feeCents(piece.cubic_eighths, piece.bisque_rate_cents) },
    glaze: { rate_cents: piece.glaze_rate_cents, fee_cents: feeCents(piece.cubic_eighths, piece.glaze_rate_cents) },
  };
  return {
    ...ticketBody(ticket as TicketQueryRow),
    rounded,
    cubic_inches: piece.cubic_eighths / 8,
    quote,
    location: placement ? { load_id: placement.load_id, kiln_name: placement.kiln_name, deck: placement.deck } : null,
    outcomes: { bisque: piece.bisque_outcome, glaze: piece.glaze_outcome },
    charges: charges.map(chargeBody),
    history,
    pickup_deadline: piece.pickup_deadline,
  };
}

export function chargeBody(c: ChargeRow): Record<string, unknown> {
  return {
    id: c.id,
    piece_id: c.piece_id,
    piece_title: null as unknown as string, // filled by callers with pieces
    firing: c.firing,
    storage_day: c.storage_day,
    cubic_inches: c.cubic_eighths === null ? null : c.cubic_eighths / 8,
    rate_cents: c.rate_cents,
    fee_cents: c.fee_cents,
    status: c.status,
    funding: c.status === "settled" || c.status === "refunded" ? c.funding : null,
    created_at: c.created_at,
    settled_at: c.settled_at,
    refunded_at: c.refunded_at,
  };
}

export async function chargeBodyWithTitle(db: Db, c: ChargeRow): Promise<Record<string, unknown>> {
  const piece = await one<{ title: string }>(db, "SELECT title FROM pieces WHERE id = $1", [c.piece_id]);
  return { ...chargeBody(c), piece_title: piece?.title ?? "" };
}

export function userBody(person: Person, studio: Studio): Record<string, unknown> {
  return {
    user: {
      id: person.id,
      name: person.name,
      handle: person.handle,
      role: person.role,
      studio: { slug: studio.slug, name: studio.name, time_zone: studio.time_zone },
    },
  };
}

export async function loadBody(db: Db, loadId: string): Promise<Record<string, unknown> | null> {
  const load = await one<{ id: string; firing: "bisque" | "glaze"; status: string; created_at: Date; unloaded_at: Date | null; kiln_id: string }>(
    db,
    "SELECT * FROM loads WHERE id = $1",
    [loadId],
  );
  if (!load) return null;
  const kiln = await one<{ id: string; name: string; stack_height_in: number; shelf_area_sq_in: number }>(db, "SELECT * FROM kilns WHERE id = $1", [load.kiln_id]);
  const deckRows = await q<{ number: number }>(db, "SELECT number FROM load_decks WHERE load_id = $1 ORDER BY number", [loadId]);
  const placed = await q<{ id: string; deck: number; position: number }>(db, "SELECT piece_id AS id, deck, position FROM placements WHERE load_id = $1", [loadId]);
  const pieceRows = placed.length === 0 ? [] : await q<PieceRow>(
    db,
    `SELECT p.* FROM pieces p WHERE p.id = ANY($1::text[])`,
    [placed.map((p) => p.id)],
  );
  const piecesById = new Map(pieceRows.map((p) => [p.id, p]));
  const tickets = new Map<string, TicketQueryRow>();
  for (const p of placed) {
    const t = await ticketById(db, p.id);
    if (t) tickets.set(p.id, t);
  }
  const placedFull = placed
    .filter((p) => tickets.has(p.id))
    .map((p) => {
      const t = tickets.get(p.id) as TicketQueryRow;
      return { ticket: { id: t.id, title: t.title, length_in: t.length_in, width_in: t.width_in, height_in: t.height_in }, deck: p.deck, position: p.position };
    });
  const feeForFiring = (t: { id: string }): number => {
    const piece = piecesById.get(t.id);
    if (!piece) return 0;
    return feeCents(piece.cubic_eighths, load.firing === "bisque" ? piece.bisque_rate_cents : piece.glaze_rate_cents);
  };
  const figures = computeLoadFigures(kiln?.shelf_area_sq_in ?? 380, deckRows.length, placedFull, feeForFiring);
  return {
    id: load.id,
    kiln: kiln ?? null,
    firing: load.firing,
    status: load.status,
    headroom_in: figures.headroom_in,
    value_cents: figures.value_cents,
    decks: figures.decks.map((d) => ({
      number: d.number,
      post_height_in: d.post_height_in,
      deck_height_in: d.deck_height_in,
      footprint_sq_in: d.footprint_sq_in,
      footprint_pct: d.footprint_pct,
      pieces: d.pieces.map((p) => {
        const t = tickets.get((p as { id: string }).id);
        return t ? ticketBody(t) : null;
      }),
    })),
    created_at: load.created_at,
    unloaded_at: load.unloaded_at,
  };
}

export function entryBody(e: {
  id: string;
  movement_id: string;
  account: string;
  amount_cents: number;
  kind: string;
  charge_id: string | null;
  created_at: Date;
}): Record<string, unknown> {
  return {
    id: e.id,
    movement_id: e.movement_id,
    account: e.account,
    amount_cents: e.amount_cents,
    kind: e.kind,
    charge_id: e.charge_id,
    created_at: e.created_at,
  };
}

export function studioBody(studio: StudioRow, todayStr: string, storageFeeCents: number): Record<string, unknown> {
  return {
    name: studio.name,
    slug: studio.slug,
    time_zone: studio.time_zone,
    today: todayStr,
    pickup_window_days: studio.pickup_window_days,
    storage_fee_cents: storageFeeCents,
  };
}
