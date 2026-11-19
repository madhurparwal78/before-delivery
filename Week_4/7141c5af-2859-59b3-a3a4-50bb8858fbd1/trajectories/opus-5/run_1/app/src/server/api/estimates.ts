/**
 * Estimates. Material, rate and currency are read by the server; a price,
 * total, state or another desk's id under an unpublished key changes nothing.
 */
import { F } from '../../shared/feedback.ts';
import { fromInt, parseDec, toFixed, type Dec } from '../domain/decimal.ts';
import { PATTERN_AREA_SQ_FT } from '../domain/layout.ts';
import {
  computeEstimate,
  isQuarterHour,
  priceOf,
  TOWN_CURRENCY,
  TOWN_TAX_PERCENT,
  toMinor,
  type Currency,
} from '../domain/money.ts';
import { BUSINESS_ZONE, dateText, englishDate, localTime } from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import { Check } from '../http/validate.ts';
import type { Ctx, Route } from '../http/context.ts';
import { materialOf, resolvePiece, piece as resolved } from './lookup.ts';
import { presentEstimate, presentRate, type Row } from '../present.ts';
import { checkLotHolds, readLots } from './materials.ts';
import type { Town } from '../domain/time.ts';

const MAX_HOURS = fromInt(10_000);

/** The rate that applies to a new estimate: the latest taking effect by today. */
export async function currentRate(ctx: Ctx, currency: Currency): Promise<Dec> {
  const desk = ctx.requireDesk();
  const row = await ctx.app.db.one<Row>(
    `SELECT * FROM rates WHERE desk_id = $1 AND takes_effect_on <= $2
      ORDER BY takes_effect_on DESC, id DESC LIMIT 1`,
    [desk.id, ctx.app.todayText()],
  );
  if (!row) throw new Error('a desk always has a rate');
  const value = parseDec(String(row[currency.toLowerCase()]));
  if (!value) throw new Error('bad stored rate');
  return value;
}

interface EstimateRequest {
  materialCode: string | null;
  lot: string | null;
  patternAreaSqFt: Dec | null;
  metres: Dec | null;
  labourHours: Dec;
  openVersion: number | null;
}

async function readRequest(ctx: Ctx): Promise<{
  request: EstimateRequest;
  material: Row | null;
  lotAverageSqFt: Dec | null;
  currency: Currency;
  taxPercent: number;
}> {
  const piece = resolved(ctx);
  const town = String(piece.town) as Town;
  const currency = TOWN_CURRENCY[town];
  const taxPercent = TOWN_TAX_PERCENT[town];

  const check = new Check(ctx.body);
  const codeValue = ctx.body.materialCode;
  const materialCode =
    codeValue === null || codeValue === undefined || codeValue === ''
      ? null
      : (check.text('materialCode', 40) ?? null);

  const material = materialCode ? await materialOf(ctx, materialCode) : null;
  if (materialCode && !material) throw fail.notFound();
  const unit = material ? (String(material.unit) as 'sqFt' | 'metre') : null;

  const lotValue = ctx.body.lot;
  const lot =
    lotValue === null || lotValue === undefined || lotValue === ''
      ? null
      : (check.text('lot', 40) ?? null);
  if (material && !lot) check.add('lot', F.required);

  const patternAreaSqFt =
    unit === 'sqFt'
      ? ((check.decimal('patternAreaSqFt', {
          required: false,
          min: fromInt(0),
          maxScale: 2,
        }) as Dec | null | undefined) ?? parseDec(PATTERN_AREA_SQ_FT))
      : null;
  const metres =
    unit === 'metre'
      ? (check.decimal('metres', { min: fromInt(0), maxScale: 2 }) as Dec | null)
      : null;

  const labourHours = check.decimal('labourHours', { min: fromInt(0), max: MAX_HOURS });
  if (labourHours && !isQuarterHour(labourHours)) check.add('labourHours', F.quarterHours);

  const openVersionValue = ctx.body.openVersion;
  const openVersion =
    openVersionValue === undefined || openVersionValue === null
      ? null
      : (check.integer('openVersion', { min: 1 }) ?? null);

  check.done();

  let lotAverageSqFt: Dec | null = null;
  if (material && unit === 'sqFt') {
    const lots = await readLots(ctx, String(material.code));
    const chosen = lots.find((l) => l.lot === lot);
    if (!chosen) throw fail.fields({ lot: F.outOfRange });
    lotAverageSqFt = parseDec(chosen.averageSqFt ?? '0');
  } else if (material && unit === 'metre') {
    const lots = await readLots(ctx, String(material.code));
    if (!lots.some((l) => l.lot === lot)) throw fail.fields({ lot: F.outOfRange });
  }

  return {
    request: {
      materialCode,
      lot,
      patternAreaSqFt: patternAreaSqFt ?? null,
      metres,
      labourHours: labourHours!,
      openVersion,
    },
    material,
    lotAverageSqFt,
    currency,
    taxPercent,
  };
}

async function buildEstimate(ctx: Ctx): Promise<{ row: Row; openVersion: number | null }> {
  const { request, material, lotAverageSqFt, currency, taxPercent } = await readRequest(ctx);
  const rate = await currentRate(ctx, currency);
  const unit = material ? (String(material.unit) as 'sqFt' | 'metre') : null;

  const amounts = computeEstimate({
    currency,
    taxPercent,
    labourHours: request.labourHours,
    labourRate: rate,
    material: material
      ? {
          pricePerUnit: priceOf(material.prices as Record<string, string>, currency),
          unit: unit!,
          lotAverageSqFt: lotAverageSqFt ?? fromInt(0),
        }
      : null,
    patternAreaSqFt: request.patternAreaSqFt ?? fromInt(0),
    metres: request.metres ?? fromInt(0),
  });

  // The lot must hold what the estimate asks of it.
  if (material) {
    const lots = await readLots(ctx, String(material.code));
    const wanted =
      unit === 'metre' ? (amounts.metres ?? fromInt(0)) : fromInt(amounts.hides ?? 0);
    const refusal = checkLotHolds({
      unit: unit!,
      materialName: String(material.name),
      lots,
      chosenLot: request.lot!,
      wanted,
    });
    if (refusal) throw fail.conflict(refusal);
  }

  return {
    row: {
      currency,
      material_code: request.materialCode,
      lot: request.lot,
      pattern_area: request.patternAreaSqFt ? toFixed(request.patternAreaSqFt, 2) : null,
      hides: amounts.hides,
      metres: amounts.metres ? toFixed(amounts.metres, 2) : null,
      labour_hours: toFixed(request.labourHours, 2),
      labour_rate_minor: String(toMinor(currency, rate)),
      material_minor: String(amounts.materialMinor),
      labour_minor: String(amounts.labourMinor),
      subtotal_minor: String(amounts.subtotalMinor),
      tax_percent: taxPercent,
      tax_minor: String(amounts.taxMinor),
      total_minor: String(amounts.totalMinor),
    },
    openVersion: request.openVersion,
  };
}

export const estimateRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/pieces/:id/estimates',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM estimates WHERE piece_id = $1 ORDER BY version DESC`,
        [resolved(ctx).id],
      );
      ctx.json(200, { estimates: rows.map(presentEstimate) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/estimates/preview',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const { row } = await buildEstimate(ctx);
      ctx.json(200, {
        estimate: presentEstimate({
          ...row,
          id: null,
          version: 0,
          state: 'open',
          signed_by: null,
          signed_at: null,
          created_at: null,
        }),
      });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/estimates',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = resolved(ctx);
      const { row, openVersion } = await buildEstimate(ctx);

      const open = await ctx.app.db.one<Row>(
        `SELECT * FROM estimates WHERE piece_id = $1 AND state = 'open'
          ORDER BY version DESC LIMIT 1`,
        [piece.id],
      );
      if (openVersion !== null && (!open || Number(open.version) !== openVersion)) {
        const changedAt = open
          ? new Date(open.created_at as string).getTime()
          : ctx.app.now();
        throw fail.stale(F.estimateStale(localTime(BUSINESS_ZONE, changedAt)));
      }

      const saved = await ctx.app.db.transaction(async (tx) => {
        if (open) {
          await tx.query(`UPDATE estimates SET state = 'replaced' WHERE id = $1`, [open.id]);
        }
        const next = await tx.one<Row>(
          `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM estimates WHERE piece_id = $1`,
          [piece.id],
        );
        return tx.one<Row>(
          `INSERT INTO estimates (desk_id, piece_id, version, state, currency, material_code, lot,
             pattern_area, hides, metres, labour_hours, labour_rate_minor, material_minor,
             labour_minor, subtotal_minor, tax_percent, tax_minor, total_minor)
           VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [
            desk.id,
            piece.id,
            next!.version,
            row.currency,
            row.material_code,
            row.lot,
            row.pattern_area,
            row.hides,
            row.metres,
            row.labour_hours,
            row.labour_rate_minor,
            row.material_minor,
            row.labour_minor,
            row.subtotal_minor,
            row.tax_percent,
            row.tax_minor,
            row.total_minor,
          ],
        );
      });
      ctx.json(201, { estimate: presentEstimate(saved!) });
    },
  },
];

export const rateRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/rates',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM rates WHERE desk_id = $1 ORDER BY takes_effect_on DESC, id DESC`,
        [desk.id],
      );
      ctx.json(200, { rates: rows.map(presentRate) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/rates',
    auth: 'required',
    body: 'json',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const check = new Check(ctx.body);
      const takesEffectOn = check.date('takesEffectOn');
      const amounts: Record<string, Dec | null> = {};
      for (const key of ['eur', 'gbp', 'usd', 'jpy', 'aed'] as const) {
        amounts[key] = check.decimal(key.toUpperCase(), { min: fromInt(0), maxScale: 2 }) as Dec | null;
      }
      check.done();

      // Rates take effect today or later, on the Turin date.
      const today = ctx.app.today();
      const day = takesEffectOn!;
      if (dateText(day) < dateText(today)) throw fail.invalid(F.rateTooEarly);

      const taken = await ctx.app.db.one<Row>(
        `SELECT id FROM rates WHERE desk_id = $1 AND takes_effect_on = $2`,
        [desk.id, dateText(day)],
      );
      if (taken) throw fail.conflict(F.rateTaken);

      const row = await ctx.app.db.one<Row>(
        `INSERT INTO rates (desk_id, takes_effect_on, eur, gbp, usd, jpy, aed)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          desk.id,
          dateText(day),
          toFixed(amounts.eur!, 2),
          toFixed(amounts.gbp!, 2),
          toFixed(amounts.usd!, 2),
          toFixed(amounts.jpy!, 0),
          toFixed(amounts.aed!, 2),
        ],
      );
      ctx.json(201, { rate: presentRate(row!), message: F.rateSaved(englishDate(day)) });
    },
  },
];
