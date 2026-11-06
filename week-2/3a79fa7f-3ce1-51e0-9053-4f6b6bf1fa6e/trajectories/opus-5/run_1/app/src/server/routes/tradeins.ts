import { isoSeconds, now } from '../clock.js';
import { one, query, withTransaction } from '../db.js';
import { fail, failValidation } from '../errors.js';
import { reply, type Router } from '../http.js';
import { requireCustomer } from '../auth.js';
import { isBoundedText, isJsonInteger } from '../domain/validate.js';

const QUOTE_LIFETIME_SECONDS = 1209600;
const BRANDS = ['Tern Foils', 'Other electric hydrofoil', 'Surf foil board'];
const CONDITIONS = ['A', 'B', 'C'];

export interface TradeInRow {
  id: string;
  user_id: string;
  status: string;
  brand: string;
  model_year: number;
  condition: string;
  serial: string;
  note: string;
  quote_cents: number | null;
  quote_expires_at: Date | null;
  reject_reason: string | null;
  order_number: string | null;
}

/** A quoted trade-in reads as expired from the instant its quote expires. */
export function effectiveStatus(row: TradeInRow, at: Date): string {
  if (row.status === 'quoted' && row.quote_expires_at && at.getTime() >= row.quote_expires_at.getTime()) {
    return 'expired';
  }
  return row.status;
}

export function tradeInShape(row: TradeInRow, at: Date): Record<string, unknown> {
  return {
    id: Number(row.id),
    status: effectiveStatus(row, at),
    brand: row.brand,
    model_year: row.model_year,
    condition: row.condition,
    serial: row.serial,
    note: row.note,
    quote_cents: row.quote_cents,
    quote_expires_at: row.quote_expires_at ? isoSeconds(row.quote_expires_at) : null,
    reject_reason: row.reject_reason,
    order_number: row.order_number,
  };
}

export const TRADE_IN_SELECT =
  'SELECT id, user_id, status, brand, model_year, condition, serial, note, quote_cents, quote_expires_at, reject_reason, order_number FROM trade_ins';

export function quoteExpiresAt(at: Date): Date {
  return new Date(at.getTime() + QUOTE_LIFETIME_SECONDS * 1000);
}

export function registerTradeInRoutes(router: Router): void {
  router.add('POST', '/api/trade-ins', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const fields: Record<string, string> = {};
    if (typeof ctx.body.brand !== 'string' || !BRANDS.includes(ctx.body.brand)) fields.brand = 'Choose your current board.';
    if (!isJsonInteger(ctx.body.model_year) || ctx.body.model_year < 2018 || ctx.body.model_year > 2025) {
      fields.model_year = 'Choose a model year from 2018 to 2025.';
    }
    if (typeof ctx.body.condition !== 'string' || !CONDITIONS.includes(ctx.body.condition)) {
      fields.condition = 'Choose condition A, B or C.';
    }
    if (typeof ctx.body.serial !== 'string' || !/^[A-Za-z0-9]{6,20}$/.test(ctx.body.serial)) {
      fields.serial = 'Enter 6 to 20 letters and digits.';
    }
    const note = ctx.body.note === undefined ? '' : ctx.body.note;
    if (!isBoundedText(note, 0, 500)) fields.note = 'Keep your note under 500 characters.';
    if (Object.keys(fields).length > 0) failValidation(fields);

    return withTransaction(async (client) => {
      const open = await one<TradeInRow>(
        client,
        `${TRADE_IN_SELECT} WHERE user_id = $1 AND (status IN ('submitted', 'accepted')
           OR (status = 'quoted' AND quote_expires_at > $2)) LIMIT 1`,
        [session.userId, at],
      );
      if (open) fail('open_trade_in');
      const created = await one<TradeInRow>(
        client,
        `INSERT INTO trade_ins (user_id, status, brand, model_year, condition, serial, note, created_at)
         VALUES ($1,'submitted',$2,$3,$4,$5,$6,$7)
         RETURNING id, user_id, status, brand, model_year, condition, serial, note, quote_cents, quote_expires_at, reject_reason, order_number`,
        [session.userId, ctx.body.brand, ctx.body.model_year, ctx.body.condition, ctx.body.serial, note, at],
      );
      if (!created) throw new Error('Trade-in was not stored');
      return reply(201, tradeInShape(created, at));
    });
  });

  router.add('GET', '/api/trade-ins/mine', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const found = await query<TradeInRow>(`${TRADE_IN_SELECT} WHERE user_id = $1 ORDER BY id DESC`, [session.userId]);
    return { trade_ins: found.map((row) => tradeInShape(row, at)) };
  });

  router.add('GET', '/api/trade-ins/:id', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const row = await ownedTradeIn(ctx.params.id ?? '', session.userId);
    return tradeInShape(row, at);
  });

  router.add('POST', '/api/trade-ins/:id/accept', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const row = await ownedTradeIn(ctx.params.id ?? '', session.userId);
    if (row.status !== 'quoted') fail('illegal_transition', { message: 'This trade-in cannot be changed now.' });
    if (!row.quote_expires_at || at.getTime() >= row.quote_expires_at.getTime()) {
      await query(`UPDATE trade_ins SET status = 'expired' WHERE id = $1 AND status = 'quoted'`, [row.id]);
      fail('quote_expired');
    }
    await query(`UPDATE trade_ins SET status = 'accepted' WHERE id = $1 AND status = 'quoted'`, [row.id]);
    return tradeInShape({ ...row, status: 'accepted' }, at);
  });

  router.add('POST', '/api/trade-ins/:id/decline', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const row = await ownedTradeIn(ctx.params.id ?? '', session.userId);
    if (row.status !== 'quoted' || !row.quote_expires_at || at.getTime() >= row.quote_expires_at.getTime()) {
      fail('illegal_transition', { message: 'This trade-in cannot be changed now.' });
    }
    await query(`UPDATE trade_ins SET status = 'rejected' WHERE id = $1 AND status = 'quoted'`, [row.id]);
    return tradeInShape({ ...row, status: 'rejected' }, at);
  });
}

async function ownedTradeIn(id: string, userId: number): Promise<TradeInRow> {
  if (!/^[0-9]+$/.test(id)) fail('not_found');
  const row = (await query<TradeInRow>(`${TRADE_IN_SELECT} WHERE id = $1 AND user_id = $2`, [id, userId]))[0];
  if (!row) fail('not_found');
  return row;
}
