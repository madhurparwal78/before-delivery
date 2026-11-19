/**
 * The material library, stock reads and dye-lot holds. The library refresh is
 * all or nothing, a stock read is cached per code, and a hold is checked in the
 * published order with no supplier call for any refusal.
 */
import { createHash } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { cmp, fromInt, parseDec, toFixed, type Dec } from '../domain/decimal.ts';
import { addDays, dateText, englishDate, parseDate } from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import { Check } from '../http/validate.ts';
import type { Ctx, Route } from '../http/context.ts';
import { materialOf, requireOwnPiece } from './lookup.ts';
import { presentHold, presentMaterial, quantityText, type Row } from '../present.ts';
import { ProviderUnavailable, type SupplierLot } from '../services/providers.ts';
import { guardProvider, providerFailure } from './providerGuard.ts';
import { SearchUnavailable } from '../services/search.ts';
import { materialEntry, putEntries } from '../features/indexing.ts';

type Unit = 'sqFt' | 'metre';

export const SUPPLIER_COPY = { busy: F.supplierBusy, down: F.supplierDown } as const;

/** The same code never calls the supplier twice within STOCK_CACHE_SECONDS. */
export async function readLots(ctx: Ctx, code: string): Promise<SupplierLot[]> {
  const cached = await ctx.app.db.one<Row>(
    `SELECT lots, fetched_at FROM stock_reads WHERE code = $1`,
    [code],
  );
  if (cached) {
    const age = ctx.app.now() - new Date(cached.fetched_at as string).getTime();
    if (age < ctx.app.config.timers.stockCacheSeconds * 1000) {
      return cached.lots as SupplierLot[];
    }
  }
  await guardProvider(ctx, 'supplier', F.supplierBusy);
  let lots: SupplierLot[];
  try {
    lots = await ctx.app.providers.readLots(code);
  } catch (error) {
    // A failed read is not cached.
    return providerFailure(ctx, 'supplier', error, SUPPLIER_COPY);
  }
  await ctx.app.db.query(
    `INSERT INTO stock_reads (code, lots, fetched_at) VALUES ($1,$2,now())
     ON CONFLICT (code) DO UPDATE SET lots = $2, fetched_at = now()`,
    [code, JSON.stringify(lots)],
  );
  return lots;
}

export function lotAmount(lot: SupplierLot, unit: Unit): Dec {
  if (unit === 'metre') return parseDec(lot.metres ?? '0') ?? fromInt(0);
  return fromInt(lot.hides ?? 0);
}

export function lotAmountText(lot: SupplierLot, unit: Unit): string {
  return unit === 'metre' ? `${toFixed(lotAmount(lot, 'metre'), 2)} m` : quantityText(String(lot.hides ?? 0), 'sqFt');
}

export interface LotCheckInput {
  unit: Unit;
  materialName: string;
  lots: readonly SupplierLot[];
  chosenLot: string;
  wanted: Dec;
}

/**
 * The last two steps of the hold order, shared with the estimate's lot check:
 * no lot holding enough, then a chosen lot too small while another is enough.
 */
export function checkLotHolds(input: LotCheckInput): string | null {
  const amounts = input.lots.map((lot) => lotAmount(lot, input.unit));
  const largest = amounts.reduce((best, a) => (cmp(a, best) > 0 ? a : best), fromInt(0));
  if (cmp(largest, input.wanted) < 0) {
    return input.unit === 'metre'
      ? F.noLotMetres(toFixed(input.wanted, 2), input.materialName, toFixed(largest, 2))
      : F.noLotHides(Number(toFixed(input.wanted, 0)), input.materialName, Number(toFixed(largest, 0)));
  }
  const chosen = input.lots.find((lot) => lot.lot === input.chosenLot);
  if (!chosen) return F.outOfRange;
  if (cmp(lotAmount(chosen, input.unit), input.wanted) < 0) {
    return F.lotHolds(chosen.lot, lotAmountText(chosen, input.unit));
  }
  return null;
}

export const materialRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/materials',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM materials WHERE desk_id = $1 ORDER BY position, code`,
        [desk.id],
      );
      ctx.json(200, { materials: rows.map(presentMaterial) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/materials/refresh',
    auth: 'required',
    body: 'json',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      await guardProvider(ctx, 'supplier', F.supplierBusy);

      let catalogue;
      try {
        catalogue = await ctx.app.providers.readCatalogue();
      } catch (error) {
        if (error instanceof ProviderUnavailable) throw fail.unavailable(F.supplierUnread);
        return providerFailure(ctx, 'supplier', error, SUPPLIER_COPY);
      }

      // The entries go to search first; only once it has confirmed does the
      // library change.
      try {
        await putEntries(
          ctx.app,
          catalogue.map((m) => materialEntry(desk.id, m.code, m.name)),
        );
      } catch (error) {
        if (!(error instanceof SearchUnavailable)) throw error;
        throw fail.unavailable(F.searchUnconfirmed);
      }

      await ctx.app.db.transaction(async (tx) => {
        for (const [index, material] of catalogue.entries()) {
          await tx.query(
            `INSERT INTO materials (desk_id, code, name, family, unit, prices, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (desk_id, code) DO UPDATE
               SET name = $3, family = $4, unit = $5, prices = $6, position = $7`,
            [desk.id, material.code, material.name, material.family, material.unit, JSON.stringify(material.prices), index],
          );
        }
      });
      ctx.json(200, { count: catalogue.length });
    },
  },

  {
    method: 'GET',
    pattern: '/api/materials/:code/lots',
    auth: 'required',
    async resolve(ctx) {
      const row = await materialOf(ctx, ctx.param('code'));
      if (!row) throw fail.notFound();
      ctx.resolved.material = row;
    },
    async handle(ctx) {
      const material = ctx.resolved.material!;
      const lots = await readLots(ctx, String(material.code));
      ctx.json(200, { code: String(material.code), lots });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/holds',
    auth: 'required',
    async resolve(ctx) {
      ctx.resolved.piece = await requireOwnPiece(ctx, ctx.param('id'));
    },
    async handle(ctx) {
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM holds WHERE piece_id = $1 ORDER BY id`,
        [ctx.resolved.piece!.id],
      );
      ctx.json(200, { holds: rows.map(presentHold) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/holds',
    auth: 'required',
    body: 'json',
    async resolve(ctx) {
      ctx.resolved.piece = await requireOwnPiece(ctx, ctx.param('id'));
    },
    async handle(ctx) {
      const piece = ctx.resolved.piece!;
      const check = new Check(ctx.body);
      const code = check.text('code', 40);
      const lot = check.text('lot', 40);
      check.done();

      const material = await materialOf(ctx, code!);
      if (!material) throw fail.notFound();
      const unit = String(material.unit) as Unit;

      const wanted = new Check(ctx.body).decimal('quantity', {
        min: fromInt(0),
        maxScale: unit === 'metre' ? 2 : 0,
      });
      if (!wanted || wanted.units === 0n) throw fail.fields({ quantity: F.outOfRange });

      const wantedText = unit === 'metre' ? toFixed(wanted, 2) : toFixed(wanted, 0);

      // The published order of checks, with no supplier hold call for a refusal.
      const existing = await ctx.app.db.query<Row>(
        `SELECT * FROM holds WHERE piece_id = $1 ORDER BY id`,
        [piece.id],
      );
      const sameLot = existing.find((h) => h.code === code && h.lot === lot);
      if (sameLot && sameLot.state === 'held' && String(sameLot.quantity) === wantedText) {
        ctx.json(200, { hold: presentHold(sameLot) });
        return;
      }
      if (sameLot && sameLot.state === 'ended') {
        const endsOn = parseDate(String(sameLot.ends_on));
        throw fail.conflict(F.holdEnded(endsOn ? englishDate(endsOn) : String(sameLot.ends_on)));
      }
      if (sameLot && sameLot.state === 'held') {
        throw fail.conflict(F.lotAlreadyHeld(quantityText(String(sameLot.quantity), unit)));
      }
      const otherLot = existing.find((h) => h.state === 'held');
      if (otherLot) throw fail.conflict(F.otherLotHeld(String(otherLot.lot)));

      const lots = await readLots(ctx, code!);
      const refusal = checkLotHolds({
        unit,
        materialName: String(material.name),
        lots,
        chosenLot: lot!,
        wanted,
      });
      if (refusal) throw fail.conflict(refusal);

      // One supplier call per piece, material and lot, under one repeat key.
      const repeatKey = createHash('sha256')
        .update(`hold|${piece.id}|${code}|${lot}`)
        .digest('hex')
        .slice(0, 40);
      let holdId: string;
      try {
        holdId = await ctx.app.providers.placeHold(repeatKey, {
          code: code!,
          lot: lot!,
          quantity: unit === 'metre' ? wantedText : Number(wantedText),
          pieceRef: String(piece.id),
        });
      } catch (error) {
        return providerFailure(ctx, 'supplier', error, SUPPLIER_COPY);
      }

      const endsOn = addDays(ctx.app.today(), ctx.app.config.timers.holdDays);
      const row = await ctx.app.db.one<Row>(
        `INSERT INTO holds (piece_id, code, lot, quantity, hold_id, state, ends_on)
         VALUES ($1,$2,$3,$4,$5,'held',$6)
         ON CONFLICT (piece_id, code, lot) DO UPDATE SET quantity = holds.quantity
         RETURNING *`,
        [piece.id, code, lot, wantedText, holdId, dateText(endsOn)],
      );
      ctx.json(201, { hold: presentHold(row!) });
    },
  },
];
