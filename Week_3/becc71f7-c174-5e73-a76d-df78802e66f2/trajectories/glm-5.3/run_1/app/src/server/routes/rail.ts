// The public rail (DP-04, DP-05, DP-07, DP-18).

import type { Route, RouteContext } from '../http.js';
import { sendJson } from '../http.js';
import { ApiError } from '../errors.js';
import { CATEGORIES, SIZES, PRICE_BANDS } from '../../shared/vocab.js';
import { brusselsDateOf, brusselsMidnight, addDays } from '../../shared/time.js';
import { tagCodeDigits, isValidTagCode } from '../../shared/tagcode.js';
import { railPieceJson } from '../views.js';
import type { PieceRow } from '../rows.js';

export const railRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/rail', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const q = ctx.url.searchParams;
      const category = q.get('category');
      const size = q.get('size');
      const brand = q.get('brand');
      const price = q.get('price');
      const search = q.get('q');

      const fields: Record<string, string> = {};
      if (category !== null && !CATEGORIES.some((c) => c.value === category)) fields.category = 'Unknown category.';
      if (size !== null && !SIZES.some((s) => s.value === size)) fields.size = 'Unknown size.';
      if (price !== null && !PRICE_BANDS.some((p) => p.value === price)) fields.price = 'Unknown price band.';
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);
      }

      const now = new Date();
      const pieces = await railPieces(ctx, now);
      const band = price ? PRICE_BANDS.find((p) => p.value === price) : undefined;
      const needle = search?.toLowerCase().trim() ?? '';

      const filtered = pieces.filter((p) => {
        if (category && p.category !== category) return false;
        if (size && p.size !== size) return false;
        if (brand && p.brand.toLowerCase() !== brand.toLowerCase()) return false;
        if (band && (p.currentPriceCents === null || p.currentPriceCents < band.min || p.currentPriceCents > band.max)) return false;
        if (needle) {
          const inText = p.description.toLowerCase().includes(needle) || p.brand.toLowerCase().includes(needle);
          const digits = tagCodeDigits(needle);
          const byTag = digits.length === 8 && isValidTagCode(digits) && p.tag_digits === digits;
          if (!inText && !byTag) return false;
        }
        return true;
      });

      sendJson(ctx.res, 200, { pieces: await Promise.all(filtered.map((p) => railPieceJson(ctx.services.pool, p, now))) });
    },
  },
  {
    method: 'GET', pattern: '/api/public/pieces/:id', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const now = new Date();
      const { rows } = await ctx.services.pool.query<PieceRow & { sold_at: Date | null }>(`
        SELECT p.*, s.sold_at AS sold_at FROM pieces p
        LEFT JOIN sales s ON s.piece_id = p.id AND s.refunded_at IS NULL
        WHERE p.id = $1`, [ctx.params.id]);
      const piece = rows[0];
      if (!piece) throw new ApiError(404, 'not_found', 'Not found.');

      // Public: on the rail, on hold, or sold today. A sold piece past its
      // lifetime answers 410 (DP-07).
      if (piece.status === 'sold' || piece.sold_at !== null) {
        const soldDate = brusselsDateOf(new Date(piece.sold_at!));
        const boundary = brusselsMidnight(addDays(soldDate, 30));
        if (now.getTime() >= boundary.getTime()) {
          throw new ApiError(410, 'piece_gone', 'This piece has left the rail.');
        }
        sendJson(ctx.res, 200, { piece: await railPieceJson(ctx.services.pool, piece, now, { withStations: true, soldAt: piece.sold_at }) });
        return;
      }
      if (piece.status !== 'on_rail' && piece.status !== 'on_hold') {
        throw new ApiError(404, 'not_found', 'Not found.');
      }
      sendJson(ctx.res, 200, { piece: await railPieceJson(ctx.services.pool, piece, now, { withStations: true }) });
    },
  },
];

/** Pieces on the rail or on hold, plus pieces sold on the current Brussels day (DP: Rail). */
async function railPieces(ctx: RouteContext, now: Date): Promise<(PieceRow & { currentPriceCents: number | null })[]> {
  const today = brusselsDateOf(now);
  const startOfToday = brusselsMidnight(today);
  const { rows } = await ctx.services.pool.query<PieceRow>(
    `SELECT ${pieceSelect} FROM pieces p
     WHERE p.status IN ('on_rail', 'on_hold')
        OR (p.status = 'sold' AND EXISTS (
          SELECT 1 FROM sales s WHERE s.piece_id = p.id AND s.refunded_at IS NULL AND s.sold_at >= $1))
     ORDER BY p.intake_date DESC, p.tag_digits ASC`,
    [startOfToday]
  );
  const out: (PieceRow & { currentPriceCents: number | null })[] = [];
  for (const row of rows) {
    const json = await railPieceJson(ctx.services.pool, row, now);
    const currentPrice = (json as { currentPriceCents: number | null }).currentPriceCents;
    out.push({ ...row, currentPriceCents: currentPrice });
  }
  return out;
}

const pieceSelect = `p.id, p.tag_digits, p.consignor_id, p.category, p.brand, p.description, p.size, p.condition,
  p.asking_price_cents, p.intake_date, p.ladder_id, p.version, p.status, p.choice, p.archived_at, p.collected_at, p.import_item_no, p.created_at`;

