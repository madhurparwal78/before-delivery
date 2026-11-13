// The JSON shapes of the API (DP-54 response shapes), built in one place.

import type { Pool } from './db.js';
import type { PieceRow, LadderRow, PhotoRow } from './rows.js';
import { priceHistory } from './rows.js';
import { stationsAt, currentPriceCents, previousPriceCents, stationInstants, type Ladder } from './pricing.js';
import { toZ, brusselsDateOf, addDays, brusselsMidnight } from '../shared/time.js';
import { formatTagCode } from '../shared/tagcode.js';
import { ibanPassesMod97 } from '../shared/iban.js';

export function tagCodeOf(piece: PieceRow): string {
  return formatTagCode(piece.tag_digits);
}

export function ladderJson(l: LadderRow): Ladder {
  return {
    id: l.id,
    effectiveOn: l.effective_on,
    firstMarkdownPercent: l.first_markdown_percent,
    firstMarkdownDay: l.first_markdown_day,
    secondMarkdownPercent: l.second_markdown_percent,
    secondMarkdownDay: l.second_markdown_day,
    periodEndDay: l.period_end_day,
  };
}

export function photoJson(p: PhotoRow): unknown {
  return {
    id: p.id,
    pieceId: p.piece_id,
    contentType: p.content_type,
    width: p.width,
    height: p.height,
    publicUrl: `/api/photos/${p.id}`,
    createdAt: toZ(new Date(p.created_at)),
  };
}

/** railPiece: no consignor or shopper data (DP-35). */
export async function railPieceJson(pool: Pool, piece: PieceRow, now: Date, opts: { withStations?: boolean; soldAt?: Date | null } = {}): Promise<unknown> {
  const ladder = (await pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
  const history = await priceHistory(pool, piece.id);
  const photos = (await pool.query<PhotoRow>('SELECT * FROM photos WHERE piece_id = $1 ORDER BY position, created_at', [piece.id])).rows;
  const current = currentPriceCents(ladderJson(ladder), piece.intake_date, now, history);
  const previous = previousPriceCents(ladderJson(ladder), piece.intake_date, now, history);
  const json: Record<string, unknown> = {
    id: piece.id,
    tagCode: tagCodeOf(piece),
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    condition: piece.condition,
    status: piece.status,
    station: stationValueOf(ladderJson(ladder), piece.intake_date, now),
    currentPriceCents: current,
    previousPriceCents: previous,
    photoUrls: photos.map((p) => `/api/photos/${p.id}`),
  };
  if (opts.withStations) {
    const { stations } = stationsAt(ladderJson(ladder), piece.intake_date, now, history);
    json.stations = stations;
  }
  if (opts.soldAt) json.soldAt = toZ(opts.soldAt);
  return json;
}

export function stationValueOf(ladder: Ladder, intakeDate: string, now: Date): string {
  const { current } = stationsAt(ladder, intakeDate, now, []);
  return current;
}

/** piece: railPiece plus the staff fields. */
export async function pieceJson(pool: Pool, piece: PieceRow, now: Date): Promise<unknown> {
  const ladder = (await pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
  const history = await priceHistory(pool, piece.id);
  const photos = (await pool.query<PhotoRow>('SELECT * FROM photos WHERE piece_id = $1 ORDER BY position, created_at', [piece.id])).rows;
  const consignor = (await pool.query<{ id: string; name: string }>('SELECT id, name FROM consignors WHERE id = $1', [piece.consignor_id])).rows[0]!;
  const instants = stationInstants(ladderJson(ladder), piece.intake_date);
  const { stations, current } = stationsAt(ladderJson(ladder), piece.intake_date, now, history);
  const choiceOpensAt = brusselsMidnight(addDays(piece.intake_date, ladderJson(ladder).periodEndDay - 14));
  const choiceClosesAt = instants.period_ends;
  return {
    id: piece.id,
    tagCode: tagCodeOf(piece),
    description: piece.description,
    category: piece.category,
    brand: piece.brand,
    size: piece.size,
    condition: piece.condition,
    status: piece.status,
    station: current,
    currentPriceCents: currentPriceCents(ladderJson(ladder), piece.intake_date, now, history),
    previousPriceCents: previousPriceCents(ladderJson(ladder), piece.intake_date, now, history),
    photoUrls: photos.map((p) => `/api/photos/${p.id}`),
    consignor: consignor ? { id: consignor.id, name: consignor.name } : { id: piece.consignor_id, name: 'Erased consignor' },
    askingPriceCents: piece.asking_price_cents,
    intakeDate: piece.intake_date,
    ladderId: piece.ladder_id,
    stations,
    choice: piece.choice,
    choiceOpensAt: toZ(choiceOpensAt),
    choiceClosesAt: toZ(choiceClosesAt),
    photos: photos.map(photoJson),
    version: piece.version,
    archivedAt: piece.archived_at ? toZ(new Date(piece.archived_at)) : null,
    collectedAt: piece.collected_at ? toZ(new Date(piece.collected_at)) : null,
  };
}

export function consignorJson(c: { id: string; name: string; email: string | null; phone: string | null; iban: string | null; status: string; created_at: Date }): unknown {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    iban: c.iban,
    ibanValid: c.iban !== null && ibanPassesMod97(c.iban),
    status: c.status,
    createdAt: toZ(new Date(c.created_at)),
  };
}

export function saleJson(s: { id: string; piece_id: string; sold_at: Date; price_cents: number; consignor_share_cents: number; commission_cents: number; vat_cents: number; payment: string; sold_by: string; refunded_at: Date | null; refundable_until: Date }, piece: { tag_digits: string } | null, consignorName: string, soldByName: string, soldById: string): unknown {
  return {
    id: s.id,
    pieceId: s.piece_id,
    tagCode: piece ? formatTagCode(piece.tag_digits) : null,
    soldAt: toZ(new Date(s.sold_at)),
    priceCents: s.price_cents,
    consignorShareCents: s.consignor_share_cents,
    commissionCents: s.commission_cents,
    vatCents: s.vat_cents,
    payment: s.payment,
    soldBy: { id: soldById, name: soldByName },
    consignorName,
    refundedAt: s.refunded_at ? toZ(new Date(s.refunded_at)) : null,
    refundableUntil: toZ(new Date(s.refundable_until)),
  };
}

/** The Brussels month (YYYY-MM) an instant falls in. */
export function brusselsMonthOf(instant: Date): string {
  return brusselsDateOf(instant).slice(0, 7);
}
