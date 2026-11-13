// Loads pieces with everything their derived state needs, and shapes them into the published views.
import { brusselsDate } from "../shared/brussels";
import { formatInstant } from "../shared/format";
import type { Choice, Photo, Piece, PortalPiece, PublicPiece, RailPiece } from "../shared/api";
import type { Category, Condition, PieceStatus } from "../shared/catalog";
import type { Db } from "./db";
import { choiceIsOpen, choiceOpensAt, currentStation, periodEnd, previousPrice, priceAt, statusOf, stationsOf, type LadderTerms, type StatusFacts } from "./rules/piece";
import { tagCodeOf } from "./rules/tagCode";
import { isUuid } from "./validate";

interface PieceRow {
  id: string;
  tag_number: number;
  consignor_id: string;
  consignor_name: string;
  consignor_status: string;
  category: Category;
  brand: string;
  description: string;
  size: string;
  condition: Condition;
  intake_date: string;
  ladder_id: string;
  choice: Choice | null;
  version: number;
  archived_at: Date | null;
  collected_at: Date | null;
  first_percent: number;
  first_day: number;
  second_percent: number;
  second_day: number;
  period_end_day: number;
}

export interface PieceRecord extends StatusFacts {
  id: string;
  tagCode: string;
  tagNumber: number;
  consignorId: string;
  consignorName: string;
  consignorStatus: string;
  category: Category;
  brand: string;
  description: string;
  size: string;
  condition: Condition;
  ladderId: string;
  choice: Choice | null;
  version: number;
  photos: Photo[];
  liveSale: { id: string; soldAt: Date; shareCents: number } | null;
  status: PieceStatus;
}

export const ladderTerms = (row: { first_percent: number; first_day: number; second_percent: number; second_day: number; period_end_day: number }): LadderTerms => ({
  firstMarkdownPercent: row.first_percent,
  firstMarkdownDay: row.first_day,
  secondMarkdownPercent: row.second_percent,
  secondMarkdownDay: row.second_day,
  periodEndDay: row.period_end_day,
});

const SELECT_PIECES = `
  SELECT p.*, c.name AS consignor_name, c.status AS consignor_status,
         l.first_percent, l.first_day, l.second_percent, l.second_day, l.period_end_day
  FROM pieces p JOIN consignors c ON c.id = p.consignor_id JOIN ladders l ON l.id = p.ladder_id`;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** Every piece the condition selects, with its status as of `now`. */
export async function loadPieces(db: Db, now: Date, condition = "TRUE", params: unknown[] = []): Promise<PieceRecord[]> {
  const { rows } = await db.query<PieceRow>(`${SELECT_PIECES} WHERE ${condition}`, params);
  const ids = rows.map((row) => row.id);
  const prices = await db.query<{ piece_id: string; cents: number; from_at: Date }>("SELECT piece_id, cents, from_at FROM asking_prices WHERE piece_id = ANY($1) ORDER BY id", [ids]);
  const photos = await db.query<{ id: string; piece_id: string; content_type: string; width: number; height: number; created_at: Date }>("SELECT id, piece_id, content_type, width, height, created_at FROM photos WHERE piece_id = ANY($1) ORDER BY created_at, id", [ids]);
  const holds = await db.query<{ piece_id: string }>("SELECT piece_id FROM holds WHERE piece_id = ANY($1) AND released_at IS NULL AND ended_at IS NULL AND ends_at > $2", [ids, now]);
  const sales = await db.query<{ id: string; piece_id: string; sold_at: Date; consignor_share_cents: number }>("SELECT id, piece_id, sold_at, consignor_share_cents FROM sales WHERE piece_id = ANY($1) AND refunded_at IS NULL", [ids]);
  const pricesOf = groupBy(prices.rows, (row) => row.piece_id);
  const photosOf = groupBy(photos.rows, (row) => row.piece_id);
  const held = new Set(holds.rows.map((row) => row.piece_id));
  const saleOf = new Map(sales.rows.map((row) => [row.piece_id, row]));
  return rows.map((row) => {
    const sale = saleOf.get(row.id);
    const facts: StatusFacts = {
      intakeDate: row.intake_date,
      ladder: ladderTerms(row),
      askingPrices: (pricesOf.get(row.id) ?? []).map((price) => ({ cents: price.cents, fromAt: price.from_at })),
      archivedAt: row.archived_at,
      collectedAt: row.collected_at,
      choice: row.choice,
      sold: sale !== undefined,
      held: held.has(row.id),
    };
    return {
      ...facts,
      id: row.id,
      tagCode: tagCodeOf(row.tag_number),
      tagNumber: row.tag_number,
      consignorId: row.consignor_id,
      consignorName: row.consignor_name,
      consignorStatus: row.consignor_status,
      category: row.category,
      brand: row.brand,
      description: row.description,
      size: row.size,
      condition: row.condition,
      ladderId: row.ladder_id,
      choice: row.choice,
      version: row.version,
      photos: (photosOf.get(row.id) ?? []).map((photo) => ({
        id: photo.id,
        pieceId: photo.piece_id,
        contentType: photo.content_type,
        width: photo.width,
        height: photo.height,
        publicUrl: `/api/photos/${photo.id}`,
        createdAt: formatInstant(photo.created_at),
      })),
      liveSale: sale ? { id: sale.id, soldAt: sale.sold_at, shareCents: sale.consignor_share_cents } : null,
      status: statusOf(facts, now),
    };
  });
}

/** A piece whose id the pipeline's resource step has already found. */
export async function loadPiece(db: Db, now: Date, id: string, lock = false): Promise<PieceRecord> {
  if (lock) await db.query("SELECT 1 FROM pieces WHERE id = $1 FOR UPDATE", [id]);
  const [piece] = await loadPieces(db, now, "p.id = $1", [id]);
  return piece;
}

export async function pieceRowExists(db: Db, id: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { rowCount } = await db.query("SELECT 1 FROM pieces WHERE id = $1", [id]);
  return rowCount === 1;
}

export function railPieceView(piece: PieceRecord, now: Date): RailPiece {
  return {
    id: piece.id,
    tagCode: piece.tagCode,
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    condition: piece.condition,
    status: piece.status,
    station: currentStation(piece, now),
    currentPriceCents: priceAt(piece, now),
    previousPriceCents: previousPrice(piece, now),
    photoUrls: piece.photos.map((photo) => photo.publicUrl),
  };
}

export function publicPieceView(piece: PieceRecord, now: Date): PublicPiece {
  return {
    ...railPieceView(piece, now),
    stations: stationsOf(piece, now, formatInstant),
    ...(piece.liveSale ? { soldAt: formatInstant(piece.liveSale.soldAt) } : {}),
  };
}

export function pieceView(piece: PieceRecord, now: Date): Piece {
  return {
    ...railPieceView(piece, now),
    consignor: { id: piece.consignorId, name: piece.consignorName },
    askingPriceCents: piece.askingPrices[piece.askingPrices.length - 1].cents,
    intakeDate: piece.intakeDate,
    ladderId: piece.ladderId,
    stations: stationsOf(piece, now, formatInstant),
    choice: piece.choice,
    choiceOpensAt: formatInstant(choiceOpensAt(piece)),
    choiceClosesAt: formatInstant(periodEnd(piece)),
    photos: piece.photos,
    version: piece.version,
    archivedAt: piece.archivedAt && formatInstant(piece.archivedAt),
    collectedAt: piece.collectedAt && formatInstant(piece.collectedAt),
  };
}

export function portalPieceView(piece: PieceRecord, now: Date): PortalPiece {
  const sold = piece.liveSale !== null;
  return {
    id: piece.id,
    tagCode: piece.tagCode,
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    status: piece.status,
    station: currentStation(piece, now),
    currentPriceCents: sold ? null : priceAt(piece, now),
    previousPriceCents: sold ? null : previousPrice(piece, now),
    stations: stationsOf(piece, now, formatInstant).map((station) => (sold ? { ...station, priceCents: null } : station)),
    choice: piece.choice,
    choiceOpen: choiceIsOpen(piece, now) && !sold,
    choiceOpensAt: formatInstant(choiceOpensAt(piece)),
    choiceClosesAt: formatInstant(periodEnd(piece)),
    shareCents: piece.liveSale?.shareCents ?? null,
  };
}

export const onRailToday = (piece: PieceRecord, now: Date): boolean =>
  piece.status === "on_rail" || piece.status === "on_hold" || (piece.liveSale !== null && brusselsDate(piece.liveSale.soldAt) === brusselsDate(now));
