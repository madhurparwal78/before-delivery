/**
 * Condition pins. Coordinates are percentages to one decimal and a pin's
 * number, once given, is never used again.
 */
import { fromInt, toFixed } from '../domain/decimal.ts';
import { fail } from '../http/errors.ts';
import { Check, LIMITS } from '../http/validate.ts';
import type { Route } from '../http/context.ts';
import { resolvePiece, piece as resolved } from './lookup.ts';
import { PIN_KINDS, presentPin, type Row } from '../present.ts';

const ZERO = fromInt(0);
const HUNDRED = fromInt(100);

export const pinRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/pieces/:id/pins',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM pins WHERE piece_id = $1 ORDER BY (y)::numeric, (x)::numeric, id`,
        [resolved(ctx).id],
      );
      ctx.json(200, { pins: rows.map(presentPin) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/pieces/:id/pins',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const row = resolved(ctx);
      const check = new Check(ctx.body);
      const x = check.decimal('x', { min: ZERO, max: HUNDRED, maxScale: 1 });
      const y = check.decimal('y', { min: ZERO, max: HUNDRED, maxScale: 1 });
      const kind = check.choice('kind', PIN_KINDS);
      const note = check.optionalText('note', LIMITS.pinNote);
      check.done();

      const signed = check.boolean('signed');
      const piece = await ctx.app.db.one<Row>(
        `UPDATE pieces SET pin_high = pin_high + 1 WHERE id = $1 RETURNING pin_high`,
        [row.id],
      );
      const pin = await ctx.app.db.one<Row>(
        `INSERT INTO pins (piece_id, number, x, y, kind, note, signed)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [row.id, piece!.pin_high, toFixed(x!, 1), toFixed(y!, 1), kind, note ?? '', signed],
      );
      ctx.json(201, { pin: presentPin(pin!) });
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/pieces/:id/pins/:pinId',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const row = resolved(ctx);
      const pinId = ctx.param('pinId');
      if (!/^\d+$/.test(pinId)) throw fail.notFound();
      const pin = await ctx.app.db.one<Row>(
        `SELECT id FROM pins WHERE id = $1 AND piece_id = $2`,
        [pinId, row.id],
      );
      if (!pin) throw fail.notFound();
      await ctx.app.db.query(`DELETE FROM pins WHERE id = $1`, [pin.id]);
      ctx.noContent();
    },
  },
];
