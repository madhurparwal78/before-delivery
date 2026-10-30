import { randomUUID } from 'node:crypto';
import { now } from '../clock.js';
import { pool, query } from '../db.js';
import { NOT_FOUND_BUILD, NOT_FOUND_MATCH, fail, failValidation } from '../errors.js';
import { reply, type Ctx, type Router } from '../http.js';
import {
  ACCESSORIES,
  BOARD_PACKAGES,
  COMPONENTS,
  boardPackageName,
  type BoardName,
} from '../domain/catalog.js';
import { buildShape, rejectUnknownBuildKeys, resolvePicks, type BuildShape } from '../domain/builds.js';
import { buildFromCode, saveBuild } from '../domain/buildstore.js';
import { asLowAsCents } from '../domain/financing.js';
import { scoreAnswers } from '../domain/match.js';

async function stockMap(): Promise<Map<string, number>> {
  const rows = await query<{ sku: string; stock: number }>('SELECT sku, stock FROM stock', []);
  return new Map(rows.map((r) => [r.sku, r.stock]));
}

export async function stockOf(sku: string): Promise<number> {
  const rows = await query<{ stock: number }>('SELECT stock FROM stock WHERE sku = $1', [sku]);
  return rows[0]?.stock ?? 0;
}

async function catalogResponse(): Promise<Record<string, unknown>> {
  const stock = await stockMap();
  return {
    boards: BOARD_PACKAGES.map((pkg) => {
      const count = stock.get(pkg.sku) ?? 0;
      return {
        sku: pkg.sku,
        name: boardPackageName(pkg),
        size: pkg.size,
        finish: pkg.finish,
        price_cents: pkg.priceCents,
        defaults: { ...pkg.defaults },
        stock: count,
        in_stock: count > 0,
        as_low_as_cents: asLowAsCents(pkg.priceCents),
      };
    }),
    components: COMPONENTS.map((part) => {
      const count = stock.get(part.sku) ?? 0;
      return {
        sku: part.sku,
        slot: part.slot,
        name: part.name,
        colour: part.colour,
        price_cents: part.priceCents,
        wh: part.wh,
        mast_m: part.mastM,
        fits: [...part.fits],
        stock: count,
        in_stock: count > 0,
        as_low_as_cents: asLowAsCents(part.priceCents),
      };
    }),
    accessories: ACCESSORIES.map((item) => {
      const count = stock.get(item.sku) ?? 0;
      return {
        sku: item.sku,
        name: item.name,
        price_cents: item.priceCents,
        stock: count,
        in_stock: count > 0,
        as_low_as_cents: asLowAsCents(item.priceCents),
      };
    }),
  };
}

interface SearchItem {
  sku: string;
  name: string;
  price_cents: number;
}

function searchItems(): SearchItem[] {
  return [
    ...BOARD_PACKAGES.map((p) => ({ sku: p.sku, name: boardPackageName(p), price_cents: p.priceCents })),
    ...COMPONENTS.map((c) => ({ sku: c.sku, name: c.name, price_cents: c.priceCents })),
    ...ACCESSORIES.map((a) => ({ sku: a.sku, name: a.name, price_cents: a.priceCents })),
  ];
}

async function quoteBuild(ctx: Ctx): Promise<BuildShape> {
  rejectUnknownBuildKeys(ctx.body);
  const { picks, pkg, parts } = resolvePicks(ctx.body);
  if ((await stockOf(pkg.sku)) <= 0) fail('out_of_stock', { message: 'This size is out of stock.', status: 422 });
  return buildShape(pkg, parts, picks);
}

export function registerCatalogRoutes(router: Router): void {
  router.add('GET', '/api/catalog', 'anyone', async () => catalogResponse());

  router.add('GET', '/api/search', 'anyone', async (ctx) => {
    const raw = ctx.url.searchParams.get('q') ?? '';
    const q = raw.trim();
    if (q.length < 2 || q.length > 64) failValidation({ q: 'Enter 2 to 64 characters.' });
    const needle = q.toLowerCase();
    const results = searchItems()
      .filter((item) => item.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return byName !== 0 ? byName : a.sku.localeCompare(b.sku);
      })
      .slice(0, 20);
    return { results };
  });

  router.add('POST', '/api/builds/quote', 'anyone', async (ctx) => quoteBuild(ctx));

  router.add('POST', '/api/builds', 'anyone', async (ctx) => {
    const shape = await quoteBuild(ctx);
    const picks = {
      board_sku: shape.board_sku,
      wing: shape.slots.wing.sku,
      mast: shape.slots.mast.sku,
      propulsion: shape.slots.propulsion.sku,
      battery: shape.slots.battery.sku,
      controller: shape.slots.controller.sku,
      spares: shape.spares,
      rider_kg: shape.rider_kg,
      gear: shape.gear,
    };
    const created = await saveBuild(pool, picks, shape.code, now());
    return reply(created ? 201 : 200, shape);
  });

  router.add('GET', '/api/builds/:code', 'anyone', async (ctx) => {
    const build = await buildFromCode(pool, ctx.params.code ?? '');
    if (!build) fail('not_found', { message: NOT_FOUND_BUILD });
    return build;
  });

  router.add('POST', '/api/match', 'anyone', async (ctx) => {
    const outcome = scoreAnswers(ctx.body.answers);
    const id = randomUUID();
    await query(
      'INSERT INTO match_results (id, answers, recommended, scores, reasons, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, JSON.stringify(outcome.answers), outcome.recommended, JSON.stringify(outcome.scores), JSON.stringify(outcome.reasons), now()],
    );
    return reply(201, { id, ...outcome });
  });

  router.add('GET', '/api/match/:id', 'anyone', async (ctx) => {
    const rows = await query<{ id: string; answers: string[]; recommended: string; scores: Record<string, number>; reasons: number[] }>(
      'SELECT id, answers, recommended, scores, reasons FROM match_results WHERE id = $1',
      [ctx.params.id ?? ''],
    );
    const row = rows[0];
    if (!row) fail('not_found', { message: NOT_FOUND_MATCH });
    return {
      id: row.id,
      answers: row.answers,
      recommended: row.recommended as BoardName,
      scores: row.scores,
      reasons: row.reasons,
    };
  });
}
