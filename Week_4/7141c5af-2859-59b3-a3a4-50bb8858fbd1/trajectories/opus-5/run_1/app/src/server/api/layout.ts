/**
 * The hide's layout. The server decides every rotation and placement, and a
 * save over a layout changed elsewhere answers 412.
 */
import { F } from '../../shared/feedback.ts';
import {
  checkPlacement,
  checkRotation,
  emptyPlacements,
  FLAWS,
  hideFigure,
  HIDE_AREA_SQ_FT,
  HIDE_HEIGHT_CM,
  HIDE_WIDTH_CM,
  isPieceName,
  type PieceName,
  type Placement,
} from '../domain/layout.ts';
import { BUSINESS_ZONE, localTime } from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import type { Ctx, Route } from '../http/context.ts';
import { resolvePiece, piece as resolved } from './lookup.ts';
import { presentLayout, type Row } from '../present.ts';

const HIDE = { widthCm: HIDE_WIDTH_CM, heightCm: HIDE_HEIGHT_CM, areaSqFt: HIDE_AREA_SQ_FT };

async function readLayout(ctx: Ctx, pieceId: string): Promise<Row> {
  let row = await ctx.app.db.one<Row>(`SELECT * FROM layouts WHERE piece_id = $1`, [pieceId]);
  if (!row) {
    row = await ctx.app.db.one<Row>(
      `INSERT INTO layouts (piece_id, version, placements) VALUES ($1, 1, $2) RETURNING *`,
      [pieceId, JSON.stringify(emptyPlacements())],
    );
  }
  return row!;
}

function layoutBody(row: Row): Row {
  const placements = row.placements as Placement[];
  const figure = hideFigure(placements);
  return {
    ...presentLayout(row, FLAWS as unknown as Row[], HIDE as unknown as Row),
    usedSqFt: figure.usedSqFt,
    usedPercent: figure.usedPercent,
  };
}

/** The one reading of a coordinate or rotation sent in a body. */
function numberField(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  throw fail.fields({ [field]: F.notNumber });
}

function versionField(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  throw fail.fields({ version: F.notNumber });
}

/** Turns a refusal into its published copy. */
function refusePlacement(name: PieceName, placements: readonly Placement[], x: number, y: number, rotation: number): void {
  const rotationRefusal = checkRotation(name, rotation);
  if (rotationRefusal === 'grainBound') throw fail.invalid(F.grainBound(name));
  if (rotationRefusal === 'outOfRange') throw fail.fields({ rotation: F.outOfRange });

  const refusal = checkPlacement(name, x, y, rotation, placements);
  if (!refusal) return;
  switch (refusal.kind) {
    case 'coordinate':
      throw fail.fields({ x: F.outOfRange });
    case 'offHide':
      throw fail.invalid(F.offHide(name));
    case 'flaw':
      throw fail.invalid(F.crossesFlaw(name, refusal.flaw.x, refusal.flaw.y));
    case 'overlap':
      throw fail.invalid(F.overlaps(name, refusal.other));
  }
}

function staleRefusal(row: Row): never {
  const changedAt = new Date(row.changed_at as string).getTime();
  throw fail.stale(F.layoutStale(localTime(BUSINESS_ZONE, changedAt)));
}

export const layoutRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/pieces/:id/layout',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const row = await readLayout(ctx, String(resolved(ctx).id));
      ctx.json(200, { layout: layoutBody(row) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/layout',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const piece = resolved(ctx);
      const row = await readLayout(ctx, String(piece.id));
      const version = versionField(ctx.body.version);
      if (version !== Number(row.version)) staleRefusal(row);

      const sent = ctx.body.placements;
      if (!Array.isArray(sent)) throw fail.fields({ placements: F.required });

      const placements = emptyPlacements();
      for (const item of sent) {
        if (item === null || typeof item !== 'object') throw fail.fields({ placements: F.required });
        const entry = item as Record<string, unknown>;
        const name = typeof entry.name === 'string' ? entry.name : '';
        if (!isPieceName(name)) throw fail.fields({ name: F.outOfRange });
        const x = numberField(entry.x, 'x');
        const y = numberField(entry.y, 'y');
        const rotation = numberField(entry.rotation, 'rotation');
        refusePlacement(name, placements, x, y, rotation);
        const slot = placements.find((p) => p.name === name)!;
        slot.x = x;
        slot.y = y;
        slot.rotation = rotation;
        slot.state = 'placed';
      }

      const saved = await ctx.app.db.one<Row>(
        `UPDATE layouts SET placements = $2, version = version + 1, changed_at = now()
          WHERE piece_id = $1 RETURNING *`,
        [piece.id, JSON.stringify(placements)],
      );
      ctx.json(200, { layout: layoutBody(saved!) });
    },
  },

  {
    method: 'PUT',
    pattern: '/api/pieces/:id/layout/placements/:name',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const piece = resolved(ctx);
      const name = ctx.param('name');
      if (!isPieceName(name)) throw fail.notFound();

      const row = await readLayout(ctx, String(piece.id));
      const placements = (row.placements as Placement[]).map((p) => ({ ...p }));

      // A coordinate or rotation in any other form is refused first of all.
      const x = numberField(ctx.body.x, 'x');
      const y = numberField(ctx.body.y, 'y');
      const rotation = numberField(ctx.body.rotation, 'rotation');
      refusePlacement(name, placements, x, y, rotation);

      const version = versionField(ctx.body.version);
      if (version !== Number(row.version)) staleRefusal(row);

      const slot = placements.find((p) => p.name === name)!;
      slot.x = x;
      slot.y = y;
      slot.rotation = rotation;
      slot.state = 'placed';

      const saved = await ctx.app.db.one<Row>(
        `UPDATE layouts SET placements = $2, version = version + 1, changed_at = now()
          WHERE piece_id = $1 AND version = $3 RETURNING *`,
        [piece.id, JSON.stringify(placements), version],
      );
      if (!saved) staleRefusal(await readLayout(ctx, String(piece.id)));
      ctx.json(200, { layout: layoutBody(saved) });
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/pieces/:id/layout/placements/:name',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const piece = resolved(ctx);
      const name = ctx.param('name');
      if (!isPieceName(name)) throw fail.notFound();

      const row = await readLayout(ctx, String(piece.id));
      const versionText = ctx.query('version');
      if (versionText === null) throw fail.fields({ version: F.required });
      const version = versionField(versionText);
      if (version !== Number(row.version)) staleRefusal(row);

      const placements = (row.placements as Placement[]).map((p) =>
        p.name === name ? { ...p, x: null, y: null, rotation: 0, state: 'tray' as const } : { ...p },
      );
      const saved = await ctx.app.db.one<Row>(
        `UPDATE layouts SET placements = $2, version = version + 1, changed_at = now()
          WHERE piece_id = $1 AND version = $3 RETURNING *`,
        [piece.id, JSON.stringify(placements), version],
      );
      if (!saved) staleRefusal(await readLayout(ctx, String(piece.id)));
      ctx.json(200, { layout: layoutBody(saved) });
    },
  },
];
