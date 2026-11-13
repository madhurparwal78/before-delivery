import { jsonResponse } from '../http/context.js';
import { validationFailed } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { loadAllPieces, railPieceOf, statusOf, type PieceRecord } from '../data/pieces.js';
import { brusselsDate } from '../../shared/brussels.js';
import { bareTagCode } from '../domain/tagCode.js';
import { isCategory, isPriceBand, isSize, type PriceBand } from '../../shared/options.js';

const BANDS: Record<PriceBand, (priceCents: number) => boolean> = {
  'under-50': (cents) => cents < 5_000,
  '50-100': (cents) => cents >= 5_000 && cents < 10_000,
  '100-200': (cents) => cents >= 10_000 && cents < 20_000,
  '200-plus': (cents) => cents >= 20_000,
};

/**
 * The rail lists pieces that are on the rail or on hold, plus pieces sold on the current
 * Brussels day shown as Sold, newest intake date first, then by tag code.
 */
export function railPieces(pieces: readonly PieceRecord[], now: number): PieceRecord[] {
  const today = brusselsDate(now);
  return pieces.filter((piece) => {
    const status = statusOf(piece, now);
    if (status === 'on_rail' || status === 'on_hold') return true;
    return status === 'sold' && piece.sale !== null && brusselsDate(piece.sale.soldAt) === today;
  });
}

export const railRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/rail',
    access: 'public',
    handle: async (ctx) => {
      const category = ctx.query('category');
      const size = ctx.query('size');
      const brand = ctx.query('brand');
      const band = ctx.query('price');
      const search = ctx.query('q');

      const fields: Record<string, string> = {};
      if (category !== null && !isCategory(category)) fields['category'] = 'Choose a category from the rail.';
      if (size !== null && !isSize(size)) fields['size'] = 'Choose a size from the rail.';
      if (band !== null && !isPriceBand(band)) fields['price'] = 'Choose a price band from the rail.';
      if (Object.keys(fields).length > 0) throw validationFailed(fields);

      const { now } = ctx;
      const all = railPieces(await loadAllPieces(ctx.app.db, now), now);
      const needle = search === null ? null : search.trim().toLowerCase();
      const bareNeedle = needle === null ? null : bareTagCode(needle);

      const pieces = all
        .map((piece) => ({ piece, rail: railPieceOf(piece, now) }))
        .filter(({ rail }) => {
          if (category !== null && rail.category !== category) return false;
          if (size !== null && rail.size !== size) return false;
          if (brand !== null && rail.brand !== brand) return false;
          if (band !== null && !BANDS[band as PriceBand](rail.currentPriceCents)) return false;
          if (needle !== null && needle !== '') {
            const matches =
              rail.description.toLowerCase().includes(needle) ||
              rail.brand.toLowerCase().includes(needle) ||
              (bareNeedle !== null && bareNeedle !== '' && bareTagCode(rail.tagCode).includes(bareNeedle));
            if (!matches) return false;
          }
          return true;
        })
        .map(({ rail }) => rail);

      return jsonResponse(200, { pieces });
    },
  }),
];
