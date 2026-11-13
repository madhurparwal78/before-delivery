/**
 * Pieces as the shop's record holds them, and as the API gives them out. A piece's status,
 * price and stations are always derived from the server's clock here.
 */

import { instantOf, instantParam, maybeInstant, type Queryable } from '../db.js';
import {
  addDays,
  brusselsDate,
  isoSeconds,
  startOfBrusselsDay,
  type BrusselsDate,
} from '../../shared/brussels.js';
import {
  choiceWindow,
  currentPriceCents,
  currentStation,
  periodEndInstant,
  previousPriceCents,
  stationsOf,
  type AskingPriceWindow,
  type Ladder,
  type PriceContext,
} from '../domain/ladder.js';
import { RETURNS_SHELF_DAYS, SOLD_PIECE_LIFETIME_DAYS } from '../../shared/shop.js';
import type { Choice, PieceStatus, StationName } from '../../shared/options.js';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PiecePhoto {
  id: string;
  pieceId: string;
  contentType: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface PieceSale {
  id: string;
  soldAt: number;
  priceCents: number;
  consignorShareCents: number;
  soldByName: string;
}

export interface PieceHold {
  id: string;
  endsAt: number;
}

export interface PieceRecord {
  id: string;
  serial: number;
  tagCode: string;
  consignorId: string;
  consignorName: string;
  consignorStatus: string;
  category: string;
  brand: string;
  description: string;
  size: string;
  condition: string;
  askingPriceCents: number;
  intakeDate: BrusselsDate;
  ladder: Ladder;
  askingHistory: AskingPriceWindow[];
  choice: Choice | null;
  collectedAt: number | null;
  archivedAt: number | null;
  version: number;
  createdAt: number;
  photos: PiecePhoto[];
  activeHold: PieceHold | null;
  sale: PieceSale | null;
}

const PIECE_COLUMNS = `
  p.id, p.serial, p.tag_code, p.consignor_id, p.category, p.brand, p.description, p.size,
  p.condition, p.asking_price_cents, p.intake_date, p.ladder_id, p.choice, p.collected_at,
  p.archived_at, p.version, p.created_at,
  c.name AS consignor_name, c.status AS consignor_status,
  l.effective_on, l.first_markdown_percent, l.first_markdown_day,
  l.second_markdown_percent, l.second_markdown_day, l.period_end_day`;

const PIECE_FROM = `
  FROM pieces p
  JOIN consignors c ON c.id = p.consignor_id
  JOIN ladders l ON l.id = p.ladder_id`;

export function priceContextOf(piece: PieceRecord): PriceContext {
  return {
    ladder: piece.ladder,
    intakeDate: piece.intakeDate,
    askingHistory: piece.askingHistory,
  };
}

/** A piece's status, derived from its dates, holds and sales. */
export function statusOf(piece: PieceRecord, now: number): PieceStatus {
  if (piece.archivedAt !== null) return 'archived';
  if (piece.sale !== null) return 'sold';
  if (piece.activeHold !== null) return 'on_hold';
  if (now < periodEndInstant(piece.ladder, piece.intakeDate)) return 'on_rail';
  if (piece.choice !== 'return') return 'donation_box';
  if (piece.collectedAt !== null) return 'returned';
  const movesOn = startOfBrusselsDay(
    addDays(piece.intakeDate, piece.ladder.periodEndDay + RETURNS_SHELF_DAYS),
  );
  return now < movesOn ? 'returns_shelf' : 'donation_box';
}

/** A sold piece's public page answers 410 from 00:00 Brussels on day 30 after the sale. */
export function soldPieceGoneAt(soldAt: number): number {
  return startOfBrusselsDay(addDays(brusselsDate(soldAt), SOLD_PIECE_LIFETIME_DAYS));
}

export interface RailPiece {
  id: string;
  tagCode: string;
  description: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  status: PieceStatus;
  station: StationName;
  currentPriceCents: number;
  previousPriceCents: number | null;
  photoUrls: string[];
}

export function railPieceOf(piece: PieceRecord, now: number): RailPiece {
  const context = priceContextOf(piece);
  return {
    id: piece.id,
    tagCode: piece.tagCode,
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    condition: piece.condition,
    status: statusOf(piece, now),
    station: currentStation(context, now),
    currentPriceCents: currentPriceCents(context, now),
    previousPriceCents: previousPriceCents(context, now),
    photoUrls: piece.photos.map((photo) => `/api/photos/${photo.id}`),
  };
}

function stationList(piece: PieceRecord, now: number, hidePrices: boolean): unknown[] {
  return stationsOf(priceContextOf(piece), now).map((station) => ({
    station: station.station,
    label: station.label,
    at: isoSeconds(station.at),
    priceCents: hidePrices ? null : station.priceCents,
    state: station.state,
  }));
}

/** The public piece page's shape: a rail piece plus its stations, and `soldAt` when sold. */
export function publicPieceJson(piece: PieceRecord, now: number): unknown {
  return {
    ...railPieceOf(piece, now),
    stations: stationList(piece, now, false),
    soldAt: piece.sale === null ? null : isoSeconds(piece.sale.soldAt),
  };
}

export function photoJson(photo: PiecePhoto): unknown {
  return {
    id: photo.id,
    pieceId: photo.pieceId,
    contentType: photo.contentType,
    width: photo.width,
    height: photo.height,
    publicUrl: `/api/photos/${photo.id}`,
    createdAt: isoSeconds(photo.createdAt),
  };
}

export function pieceJson(piece: PieceRecord, now: number): unknown {
  const window = choiceWindow(piece.ladder, piece.intakeDate);
  return {
    ...railPieceOf(piece, now),
    consignor: { id: piece.consignorId, name: piece.consignorName },
    askingPriceCents: piece.askingPriceCents,
    intakeDate: piece.intakeDate,
    ladderId: piece.ladder.id,
    stations: stationList(piece, now, false),
    choice: piece.choice,
    choiceOpensAt: isoSeconds(window.opensAt),
    choiceClosesAt: isoSeconds(window.closesAt),
    photos: piece.photos.map(photoJson),
    version: piece.version,
    archivedAt: piece.archivedAt === null ? null : isoSeconds(piece.archivedAt),
    collectedAt: piece.collectedAt === null ? null : isoSeconds(piece.collectedAt),
  };
}

export function isChoiceOpen(piece: PieceRecord, now: number): boolean {
  const window = choiceWindow(piece.ladder, piece.intakeDate);
  return piece.sale === null && now >= window.opensAt && now < window.closesAt;
}

/** The consignor page's shape: never a sale price, a commission or another consignor. */
export function portalPieceJson(piece: PieceRecord, now: number): unknown {
  const context = priceContextOf(piece);
  const sold = piece.sale !== null;
  const window = choiceWindow(piece.ladder, piece.intakeDate);
  return {
    id: piece.id,
    tagCode: piece.tagCode,
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    status: statusOf(piece, now),
    station: currentStation(context, now),
    currentPriceCents: sold ? null : currentPriceCents(context, now),
    previousPriceCents: sold ? null : previousPriceCents(context, now),
    stations: stationList(piece, now, sold),
    choice: piece.choice,
    choiceOpen: isChoiceOpen(piece, now),
    choiceOpensAt: isoSeconds(window.opensAt),
    choiceClosesAt: isoSeconds(window.closesAt),
    shareCents: piece.sale === null ? null : piece.sale.consignorShareCents,
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────

function recordOf(row: Record<string, unknown>): PieceRecord {
  return {
    id: row['id'] as string,
    serial: Number(row['serial']),
    tagCode: row['tag_code'] as string,
    consignorId: row['consignor_id'] as string,
    consignorName: row['consignor_name'] as string,
    consignorStatus: row['consignor_status'] as string,
    category: row['category'] as string,
    brand: row['brand'] as string,
    description: row['description'] as string,
    size: row['size'] as string,
    condition: row['condition'] as string,
    askingPriceCents: Number(row['asking_price_cents']),
    intakeDate: row['intake_date'] as string,
    ladder: {
      id: row['ladder_id'] as string,
      effectiveOn: row['effective_on'] as string,
      firstMarkdownPercent: Number(row['first_markdown_percent']),
      firstMarkdownDay: Number(row['first_markdown_day']),
      secondMarkdownPercent: Number(row['second_markdown_percent']),
      secondMarkdownDay: Number(row['second_markdown_day']),
      periodEndDay: Number(row['period_end_day']),
    },
    askingHistory: [],
    choice: (row['choice'] as Choice | null) ?? null,
    collectedAt: maybeInstant(row['collected_at']),
    archivedAt: maybeInstant(row['archived_at']),
    version: Number(row['version']),
    createdAt: instantOf(row['created_at']),
    photos: [],
    activeHold: null,
    sale: null,
  };
}

async function hydrate(db: Queryable, pieces: PieceRecord[], now: number): Promise<PieceRecord[]> {
  if (pieces.length === 0) return pieces;
  const ids = pieces.map((piece) => piece.id);
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));

  const prices = await db.query(
    `SELECT piece_id, asking_price_cents, effective_from FROM asking_prices
      WHERE piece_id = ANY($1::uuid[]) ORDER BY effective_from, id`,
    [ids],
  );
  for (const row of prices.rows) {
    byId.get(row['piece_id'] as string)?.askingHistory.push({
      askingPriceCents: Number(row['asking_price_cents']),
      effectiveFrom: instantOf(row['effective_from']),
    });
  }

  const photos = await db.query(
    `SELECT id, piece_id, content_type, width, height, created_at FROM photos
      WHERE piece_id = ANY($1::uuid[]) ORDER BY position, created_at, id`,
    [ids],
  );
  for (const row of photos.rows) {
    byId.get(row['piece_id'] as string)?.photos.push({
      id: row['id'] as string,
      pieceId: row['piece_id'] as string,
      contentType: row['content_type'] as string,
      width: Number(row['width']),
      height: Number(row['height']),
      createdAt: instantOf(row['created_at']),
    });
  }

  const holds = await db.query(
    `SELECT id, piece_id, ends_at FROM holds
      WHERE piece_id = ANY($1::uuid[]) AND released_at IS NULL AND ends_at > $2
      ORDER BY starts_at DESC`,
    [ids, instantParam(now)],
  );
  for (const row of holds.rows) {
    const piece = byId.get(row['piece_id'] as string);
    if (piece !== undefined && piece.activeHold === null) {
      piece.activeHold = { id: row['id'] as string, endsAt: instantOf(row['ends_at']) };
    }
  }

  const sales = await db.query(
    `SELECT s.id, s.piece_id, s.sold_at, s.price_cents, s.consignor_share_cents,
            m.name AS sold_by_name
       FROM sales s JOIN members m ON m.id = s.sold_by
      WHERE s.piece_id = ANY($1::uuid[]) AND s.refunded_at IS NULL`,
    [ids],
  );
  for (const row of sales.rows) {
    const piece = byId.get(row['piece_id'] as string);
    if (piece !== undefined) {
      piece.sale = {
        id: row['id'] as string,
        soldAt: instantOf(row['sold_at']),
        priceCents: Number(row['price_cents']),
        consignorShareCents: Number(row['consignor_share_cents']),
        soldByName: row['sold_by_name'] as string,
      };
    }
  }

  return pieces;
}

export async function loadPieceById(
  db: Queryable,
  id: string,
  now: number,
): Promise<PieceRecord | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const { rows } = await db.query(`SELECT ${PIECE_COLUMNS} ${PIECE_FROM} WHERE p.id = $1`, [id]);
  const row = rows[0];
  if (row === undefined) return null;
  const [piece] = await hydrate(db, [recordOf(row)], now);
  return piece ?? null;
}

export async function loadPieceByTagCode(
  db: Queryable,
  tagCode: string,
  now: number,
): Promise<PieceRecord | null> {
  const { rows } = await db.query(`SELECT ${PIECE_COLUMNS} ${PIECE_FROM} WHERE p.tag_code = $1`, [
    tagCode,
  ]);
  const row = rows[0];
  if (row === undefined) return null;
  const [piece] = await hydrate(db, [recordOf(row)], now);
  return piece ?? null;
}

export async function loadAllPieces(db: Queryable, now: number): Promise<PieceRecord[]> {
  const { rows } = await db.query(
    `SELECT ${PIECE_COLUMNS} ${PIECE_FROM} ORDER BY p.intake_date DESC, p.tag_code`,
  );
  return hydrate(db, rows.map(recordOf), now);
}

export async function loadPiecesOfConsignor(
  db: Queryable,
  consignorId: string,
  now: number,
): Promise<PieceRecord[]> {
  const { rows } = await db.query(
    `SELECT ${PIECE_COLUMNS} ${PIECE_FROM} WHERE p.consignor_id = $1
      ORDER BY p.intake_date DESC, p.tag_code`,
    [consignorId],
  );
  return hydrate(db, rows.map(recordOf), now);
}

export async function nextSerial(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ next: string }>(
    `SELECT COALESCE(MAX(serial), 0) + 1 AS next FROM pieces`,
  );
  return Number(rows[0]?.next ?? 1);
}

/** The ladder in force on a date is the one with the latest effective date on or before it. */
export async function ladderInForceOn(db: Queryable, date: BrusselsDate): Promise<Ladder | null> {
  const { rows } = await db.query(
    `SELECT id, effective_on, first_markdown_percent, first_markdown_day,
            second_markdown_percent, second_markdown_day, period_end_day
       FROM ladders WHERE effective_on <= $1 ORDER BY effective_on DESC LIMIT 1`,
    [date],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row['id'] as string,
    effectiveOn: row['effective_on'] as string,
    firstMarkdownPercent: Number(row['first_markdown_percent']),
    firstMarkdownDay: Number(row['first_markdown_day']),
    secondMarkdownPercent: Number(row['second_markdown_percent']),
    secondMarkdownDay: Number(row['second_markdown_day']),
    periodEndDay: Number(row['period_end_day']),
  };
}
