import { rows, type Queryable } from './db/pool.ts';
import { now } from './clock.ts';
import { studioDate } from './domain/studio-day.ts';
import {
  deckGeometry,
  footprintPct,
  headroomEighths,
  inchesFromEighths,
  sqInchesFromQuarters,
} from './domain/load.ts';
import { cubicInches, inchesFromHalves, inchesFromHundredths } from './domain/quote.ts';
import type { LoadStatus, Outcome, PieceStatus } from '../shared/labels.ts';

export interface PieceRow {
  readonly id: string;
  readonly studio_id: string;
  readonly member_id: string;
  readonly title: string;
  readonly clay_body: string;
  readonly length_hundredths: number;
  readonly width_hundredths: number;
  readonly height_hundredths: number;
  readonly r_length_halves: number;
  readonly r_width_halves: number;
  readonly r_height_halves: number;
  readonly cubic_eighths: number;
  readonly membership: 'member' | 'drop_off';
  readonly rates_effective_from: string;
  readonly bisque_rate_cents: number;
  readonly bisque_fee_cents: number;
  readonly glaze_rate_cents: number;
  readonly glaze_fee_cents: number;
  readonly quoted_at: Date;
  readonly status: PieceStatus;
  readonly waiting_since: Date | null;
  readonly photo_key: string | null;
  readonly bisque_outcome: Outcome | null;
  readonly glaze_outcome: Outcome | null;
  readonly pickup_deadline: string | null;
  readonly owner_handle: string;
  readonly created_at: Date;
}

export const PIECE_COLUMNS = `p.id, p.studio_id, p.member_id, p.title, cb.name as clay_body,
  p.length_hundredths, p.width_hundredths, p.height_hundredths,
  p.r_length_halves, p.r_width_halves, p.r_height_halves, p.cubic_eighths,
  p.membership, p.rates_effective_from, p.bisque_rate_cents, p.bisque_fee_cents,
  p.glaze_rate_cents, p.glaze_fee_cents, p.quoted_at, p.status, p.waiting_since,
  p.photo_key, p.bisque_outcome, p.glaze_outcome, p.pickup_deadline,
  owner.handle as owner_handle, p.created_at`;

export const PIECE_FROM = `from pieces p
  join clay_bodies cb on cb.id = p.clay_body_id
  join people owner on owner.id = p.member_id`;

export interface ChargeRow {
  readonly id: string;
  readonly piece_id: string;
  readonly piece_title: string;
  readonly firing: 'bisque' | 'glaze' | 'storage';
  readonly storage_day: string | null;
  readonly cubic_eighths: number | null;
  readonly rate_cents: number;
  readonly fee_cents: number;
  readonly status: 'pending' | 'settled' | 'refund_pending' | 'refunded';
  readonly funding: 'credit' | 'card' | null;
  readonly created_at: Date;
  readonly settled_at: Date | null;
  readonly refunded_at: Date | null;
}

export const CHARGE_COLUMNS = `c.id, c.piece_id, pc.title as piece_title, c.firing, c.storage_day,
  c.cubic_eighths, c.rate_cents, c.fee_cents, c.status, c.funding, c.created_at,
  c.settled_at, c.refunded_at`;

export function chargeBody(row: ChargeRow): Record<string, unknown> {
  return {
    id: row.id,
    piece_id: row.piece_id,
    piece_title: row.piece_title,
    firing: row.firing,
    storage_day: row.storage_day,
    cubic_inches: row.cubic_eighths === null ? null : cubicInches(row.cubic_eighths),
    rate_cents: row.rate_cents,
    fee_cents: row.fee_cents,
    status: row.status,
    funding: row.status === 'pending' ? null : row.funding,
    created_at: row.created_at.toISOString(),
    settled_at: row.settled_at ? row.settled_at.toISOString() : null,
    refunded_at: row.refunded_at ? row.refunded_at.toISOString() : null,
  };
}

export function ticketBody(row: PieceRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    clay_body: row.clay_body,
    length_in: inchesFromHundredths(row.length_hundredths),
    width_in: inchesFromHundredths(row.width_hundredths),
    height_in: inchesFromHundredths(row.height_hundredths),
    photo_url: row.photo_key ? `/api/pieces/${row.id}/photo` : null,
    owner_handle: row.owner_handle,
    waiting_since: row.waiting_since ? row.waiting_since.toISOString() : null,
  };
}

interface LocationRow {
  readonly load_id: string;
  readonly kiln_name: string;
  readonly deck: number;
}

interface HistoryRow {
  readonly status: PieceStatus;
  readonly at: Date;
}

export async function passportBody(
  client: Queryable,
  row: PieceRow,
): Promise<Record<string, unknown>> {
  const [location] = await rows<LocationRow>(
    client,
    `select pl.load_id, k.name as kiln_name, pl.deck
       from piece_open_load ol
       join placements pl on pl.load_id = ol.load_id and pl.piece_id = ol.piece_id
       join loads l on l.id = ol.load_id
       join kilns k on k.id = l.kiln_id
      where ol.piece_id = $1`,
    [row.id],
  );
  const history = await rows<HistoryRow>(
    client,
    'select status, at from piece_history where piece_id = $1 order by id',
    [row.id],
  );
  const charges = await rows<ChargeRow>(
    client,
    `select ${CHARGE_COLUMNS} from charges c join pieces pc on pc.id = c.piece_id
      where c.piece_id = $1 order by c.ordinal`,
    [row.id],
  );
  return {
    ...ticketBody(row),
    rounded: {
      length_in: inchesFromHalves(row.r_length_halves),
      width_in: inchesFromHalves(row.r_width_halves),
      height_in: inchesFromHalves(row.r_height_halves),
    },
    cubic_inches: cubicInches(row.cubic_eighths),
    quote: {
      quoted_at: row.quoted_at.toISOString(),
      rates_effective_from: row.rates_effective_from,
      membership: row.membership,
      bisque: { rate_cents: row.bisque_rate_cents, fee_cents: row.bisque_fee_cents },
      glaze: { rate_cents: row.glaze_rate_cents, fee_cents: row.glaze_fee_cents },
    },
    location: location
      ? { load_id: location.load_id, kiln_name: location.kiln_name, deck: location.deck }
      : null,
    outcomes: { bisque: row.bisque_outcome, glaze: row.glaze_outcome },
    charges: charges.map(chargeBody),
    history: history.map((entry) => ({ status: entry.status, at: entry.at.toISOString() })),
    pickup_deadline: row.pickup_deadline,
  };
}

export async function pieceById(
  client: Queryable,
  studioId: string,
  pieceId: string,
): Promise<PieceRow | null> {
  const found = await rows<PieceRow>(
    client,
    `select ${PIECE_COLUMNS} ${PIECE_FROM} where p.id = $1 and p.studio_id = $2`,
    [pieceId, studioId],
  );
  return found[0] ?? null;
}

export interface LoadRow {
  readonly id: string;
  readonly studio_id: string;
  readonly kiln_id: string;
  readonly firing: 'bisque' | 'glaze';
  readonly status: LoadStatus;
  readonly created_at: Date;
  readonly unloaded_at: Date | null;
  readonly kiln_name: string;
  readonly stack_height_eighths: number;
  readonly shelf_area_tenths: number;
}

export const LOAD_SELECT = `select l.id, l.studio_id, l.kiln_id, l.firing, l.status, l.created_at,
  l.unloaded_at, k.name as kiln_name, k.stack_height_eighths, k.shelf_area_tenths
  from loads l join kilns k on k.id = l.kiln_id`;

interface PlacedPieceRow extends PieceRow {
  readonly deck: number;
  readonly position: number;
}

export async function loadBody(
  client: Queryable,
  load: LoadRow,
): Promise<Record<string, unknown>> {
  const deckNumbers = (
    await rows<{ number: number }>(
      client,
      'select number from load_decks where load_id = $1 order by number',
      [load.id],
    )
  ).map((deck) => deck.number);
  const placed = await rows<PlacedPieceRow>(
    client,
    `select ${PIECE_COLUMNS}, pl.deck, pl.position
       from placements pl
       join pieces p on p.id = pl.piece_id
       join clay_bodies cb on cb.id = p.clay_body_id
       join people owner on owner.id = p.member_id
      where pl.load_id = $1
      order by pl.deck, pl.position`,
    [load.id],
  );

  const geometries = deckNumbers.map((number) =>
    deckGeometry(
      placed
        .filter((piece) => piece.deck === number)
        .map((piece) => ({
          roundedLengthHalves: piece.r_length_halves,
          roundedWidthHalves: piece.r_width_halves,
          roundedHeightHalves: piece.r_height_halves,
        })),
    ),
  );
  const headroom = headroomEighths(load.stack_height_eighths, geometries);
  let value = 0;
  for (const piece of placed) {
    value += load.firing === 'bisque' ? piece.bisque_fee_cents : piece.glaze_fee_cents;
  }

  return {
    id: load.id,
    kiln: {
      id: load.kiln_id,
      name: load.kiln_name,
      stack_height_in: inchesFromEighths(load.stack_height_eighths),
      shelf_area_sq_in: load.shelf_area_tenths / 10,
    },
    firing: load.firing,
    status: load.status,
    headroom_in: inchesFromEighths(headroom),
    value_cents: value,
    decks: deckNumbers.map((number, index) => {
      const geometry = geometries[index] as ReturnType<typeof deckGeometry>;
      return {
        number,
        post_height_in: inchesFromEighths(geometry.postHeightEighths),
        deck_height_in: inchesFromEighths(geometry.deckHeightEighths),
        footprint_sq_in: sqInchesFromQuarters(geometry.footprintQuarters),
        footprint_pct: footprintPct(geometry.footprintQuarters, load.shelf_area_tenths),
        pieces: placed.filter((piece) => piece.deck === number).map(ticketBody),
      };
    }),
    created_at: load.created_at.toISOString(),
    unloaded_at: load.unloaded_at ? load.unloaded_at.toISOString() : null,
  };
}

export async function loadById(
  client: Queryable,
  studioId: string,
  loadId: string,
): Promise<LoadRow | null> {
  const found = await rows<LoadRow>(client, `${LOAD_SELECT} where l.id = $1 and l.studio_id = $2`, [
    loadId,
    studioId,
  ]);
  return found[0] ?? null;
}

interface EntryRow {
  readonly id: string;
  readonly movement_id: string;
  readonly account: string;
  readonly amount_cents: number;
  readonly kind: string;
  readonly charge_id: string | null;
  readonly created_at: Date;
}

function entryBody(row: EntryRow): Record<string, unknown> {
  return {
    id: row.id,
    movement_id: row.movement_id,
    account: row.account,
    amount_cents: row.amount_cents,
    kind: row.kind,
    charge_id: row.charge_id,
    created_at: row.created_at.toISOString(),
  };
}

export async function ledgerEntries(
  client: Queryable,
  memberId: string,
): Promise<Record<string, unknown>[]> {
  const found = await rows<EntryRow>(
    client,
    `select e.id, e.movement_id, e.account, e.amount_cents, m.kind, m.charge_id, e.created_at
       from ledger_entries e
       join ledger_movements m on m.id = e.movement_id
      where e.member_id = $1
      order by m.ordinal, e.ordinal`,
    [memberId],
  );
  return found.map(entryBody);
}

export async function balanceCents(client: Queryable, memberId: string): Promise<number> {
  const found = await rows<{ balance: number }>(
    client,
    `select coalesce(sum(amount_cents), 0)::bigint as balance
       from ledger_entries where member_id = $1 and account = 'member_credit'`,
    [memberId],
  );
  return found[0]?.balance ?? 0;
}

export function studioToday(timeZone: string): string {
  return studioDate(now(), timeZone);
}

export async function memberCharges(
  client: Queryable,
  memberId: string,
): Promise<Record<string, unknown>[]> {
  const found = await rows<ChargeRow>(
    client,
    `select ${CHARGE_COLUMNS} from charges c join pieces pc on pc.id = c.piece_id
      where c.member_id = $1 order by c.ordinal`,
    [memberId],
  );
  return found.map(chargeBody);
}
