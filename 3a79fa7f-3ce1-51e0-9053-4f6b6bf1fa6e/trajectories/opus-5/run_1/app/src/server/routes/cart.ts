import { randomBytes } from 'node:crypto';
import { now } from '../clock.js';
import { pool, withTransaction } from '../db.js';
import { fail, failValidation } from '../errors.js';
import { reply, type Ctx, type Router } from '../http.js';
import { resolveCartId } from '../auth.js';
import { sellableSku } from '../domain/catalog.js';
import {
  ACCESSORY_LINE_CAP,
  BUILD_LINE_CAP,
  BUILD_TOTAL_CAP,
  loadCart,
  normaliseCode,
  type CartShape,
} from '../domain/cart.js';
import { buildFromCode } from '../domain/buildstore.js';
import { stockOf } from './catalog.js';

const SHARE_LIFETIME_SECONDS = 2592000;
const LINE_KEYS = ['type', 'quantity', 'code', 'sku'];

function failLimit(cap: number): never {
  fail('limit', { message: `Limit ${cap} per order.`, fields: { quantity: `Limit ${cap} per order.` } });
}

async function buildTotalQuantity(cartId: number, exceptLineId: number | null): Promise<number> {
  const rows = (
    await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM cart_lines
       WHERE cart_id = $1 AND type = 'build' AND ($2::bigint IS NULL OR id <> $2)`,
      [cartId, exceptLineId],
    )
  ).rows as { total: string }[];
  return Number(rows[0]?.total ?? 0);
}

async function addLine(ctx: Ctx, cartId: number): Promise<CartShape> {
  const allowed =
    ctx.body.type === 'build' ? ['type', 'quantity', 'code'] : ctx.body.type === 'accessory' ? ['type', 'quantity', 'sku'] : LINE_KEYS;
  const unknown = Object.keys(ctx.body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const fields: Record<string, string> = {};
    for (const key of unknown) fields[key] = 'Unknown field.';
    fail('unknown_field', { fields });
  }

  const { type, quantity: rawQuantity } = ctx.body;
  if (type !== 'build' && type !== 'accessory') failValidation({ type: 'Choose a line type.' });
  const quantity = rawQuantity === undefined ? 1 : rawQuantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    failValidation({ quantity: 'Enter a whole quantity of at least 1.' });
  }

  let sku: string;
  let code: string | null = null;
  if (type === 'build') {
    const build = typeof ctx.body.code === 'string' ? await buildFromCode(pool, ctx.body.code) : null;
    if (!build) failValidation({ code: 'Unknown build.' });
    sku = build.board_sku;
    code = build.code;
  } else {
    const item = sellableSku(ctx.body.sku);
    if (!item) failValidation({ sku: 'Unknown item.' });
    sku = item.sku;
  }

  const cap = type === 'build' ? BUILD_LINE_CAP : ACCESSORY_LINE_CAP;

  return withTransaction(async (client) => {
    const existing = (
      await client.query(
        `SELECT id, quantity FROM cart_lines
         WHERE cart_id = $1 AND type = $2 AND ($3::text IS NULL OR build_code = $3) AND sku = $4 FOR UPDATE`,
        [cartId, type, code, sku],
      )
    ).rows[0] as { id: string; quantity: number } | undefined;

    const wanted = (existing?.quantity ?? 0) + quantity;
    if (wanted > cap) failLimit(cap);
    if (type === 'build') {
      const others = await buildTotalQuantity(cartId, existing ? Number(existing.id) : null);
      if (others + wanted > BUILD_TOTAL_CAP) failLimit(BUILD_TOTAL_CAP);
    }
    if (wanted > (await stockOf(sku))) fail('out_of_stock', { message: `Not enough stock for ${sku}.`, status: 422 });

    if (existing) {
      await client.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [existing.id, wanted]);
    } else {
      await client.query(
        'INSERT INTO cart_lines (cart_id, type, build_code, sku, quantity, added_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [cartId, type, code, sku, wanted, now()],
      );
    }
    return loadCart(client, cartId);
  });
}

async function ownedLine(cartId: number, lineId: string): Promise<{ id: string; type: string; sku: string; quantity: number }> {
  if (!/^[0-9]+$/.test(lineId)) fail('not_found');
  const row = (
    await pool.query('SELECT id, type, sku, quantity FROM cart_lines WHERE id = $1 AND cart_id = $2', [lineId, cartId])
  ).rows[0] as { id: string; type: string; sku: string; quantity: number } | undefined;
  if (!row) fail('not_found');
  return row;
}

export function registerCartRoutes(router: Router): void {
  router.add('GET', '/api/cart', 'anyone', async (ctx) => loadCart(pool, await resolveCartId(ctx)));

  router.add('POST', '/api/cart/lines', 'anyone', async (ctx) => addLine(ctx, await resolveCartId(ctx)));

  router.add('PATCH', '/api/cart/lines/:id', 'anyone', async (ctx) => {
    const cartId = await resolveCartId(ctx);
    const line = await ownedLine(cartId, ctx.params.id ?? '');
    const { quantity } = ctx.body;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0) {
      failValidation({ quantity: 'Enter a whole quantity of at least 0.' });
    }
    const cap = line.type === 'build' ? BUILD_LINE_CAP : ACCESSORY_LINE_CAP;
    if (quantity > cap) failLimit(cap);
    if (line.type === 'build' && quantity > 0) {
      const others = await buildTotalQuantity(cartId, Number(line.id));
      if (others + quantity > BUILD_TOTAL_CAP) failLimit(BUILD_TOTAL_CAP);
    }
    if (quantity > (await stockOf(line.sku))) {
      fail('out_of_stock', { message: `Not enough stock for ${line.sku}.`, status: 422 });
    }
    if (quantity === 0) await pool.query('DELETE FROM cart_lines WHERE id = $1', [line.id]);
    else await pool.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [line.id, quantity]);
    return loadCart(pool, cartId);
  });

  router.add('DELETE', '/api/cart/lines/:id', 'anyone', async (ctx) => {
    const cartId = await resolveCartId(ctx);
    const line = await ownedLine(cartId, ctx.params.id ?? '');
    await pool.query('DELETE FROM cart_lines WHERE id = $1', [line.id]);
    return loadCart(pool, cartId);
  });

  router.add('POST', '/api/cart/codes', 'anyone', async (ctx) => {
    const cartId = await resolveCartId(ctx);
    const code = normaliseCode(ctx.body.code);
    if (!code) fail('invalid_code', { fields: { code: 'This code is not valid.' } });
    const applied = (await pool.query('SELECT code FROM cart_codes WHERE cart_id = $1', [cartId])).rows as {
      code: string;
    }[];
    if (applied.some((row) => row.code === code)) fail('code_already_applied', { fields: { code: 'This code is already applied.' } });
    if (applied.length >= 2) fail('too_many_codes', { fields: { code: 'Only two codes can be used.' } });
    await pool.query('INSERT INTO cart_codes (cart_id, code, added_at) VALUES ($1,$2,$3)', [cartId, code, now()]);
    return loadCart(pool, cartId);
  });

  router.add('DELETE', '/api/cart/codes/:code', 'anyone', async (ctx) => {
    const cartId = await resolveCartId(ctx);
    const code = normaliseCode(ctx.params.code);
    if (!code) fail('not_found');
    const result = await pool.query('DELETE FROM cart_codes WHERE cart_id = $1 AND code = $2', [cartId, code]);
    if ((result.rowCount ?? 0) === 0) fail('not_found');
    return loadCart(pool, cartId);
  });

  router.add('POST', '/api/cart/share', 'anyone', async (ctx) => {
    const cartId = await resolveCartId(ctx);
    const cart = await loadCart(pool, cartId);
    const token = randomBytes(24).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + SHARE_LIFETIME_SECONDS * 1000);
    const snapshot = cart.lines.map((line) => ({
      type: line.type,
      code: line.code,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unit_cents: line.unit_cents,
    }));
    await pool.query('INSERT INTO shared_carts (token, lines, created_at, expires_at) VALUES ($1,$2,$3,$4)', [
      token,
      JSON.stringify(snapshot),
      createdAt,
      expiresAt,
    ]);
    return reply(201, { token, expires_at: `${expiresAt.toISOString().slice(0, 19)}Z` });
  });

  router.add('GET', '/api/cart/shared/:token', 'anyone', async (ctx) => {
    const snapshot = await liveSnapshot(ctx.params.token ?? '');
    return reply(
      200,
      { lines: snapshot.lines, expires_at: `${snapshot.expiresAt.toISOString().slice(0, 19)}Z` },
      { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    );
  });

  router.add('POST', '/api/cart/shared/:token/import', 'anyone', async (ctx) => {
    const snapshot = await liveSnapshot(ctx.params.token ?? '');
    const cartId = await resolveCartId(ctx);
    return withTransaction(async (client) => {
      for (const line of snapshot.lines) {
        const existing = (
          await client.query(
            `SELECT id, quantity FROM cart_lines
             WHERE cart_id = $1 AND type = $2 AND ($3::text IS NULL OR build_code = $3) AND sku = $4 FOR UPDATE`,
            [cartId, line.type, line.code, line.sku],
          )
        ).rows[0] as { id: string; quantity: number } | undefined;
        const cap = line.type === 'build' ? BUILD_LINE_CAP : ACCESSORY_LINE_CAP;
        const wanted = (existing?.quantity ?? 0) + line.quantity;
        if (wanted > cap) failLimit(cap);
        if (wanted > (await stockOf(line.sku))) {
          fail('out_of_stock', { message: `Not enough stock for ${line.sku}.`, status: 422 });
        }
        if (existing) await client.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [existing.id, wanted]);
        else {
          await client.query(
            'INSERT INTO cart_lines (cart_id, type, build_code, sku, quantity, added_at) VALUES ($1,$2,$3,$4,$5,$6)',
            [cartId, line.type, line.code, line.sku, wanted, now()],
          );
        }
      }
      const buildTotal = (
        await client.query(
          `SELECT COALESCE(SUM(quantity), 0) AS total FROM cart_lines WHERE cart_id = $1 AND type = 'build'`,
          [cartId],
        )
      ).rows[0] as { total: string };
      if (Number(buildTotal.total) > BUILD_TOTAL_CAP) failLimit(BUILD_TOTAL_CAP);
      return loadCart(client, cartId);
    });
  });
}

interface Snapshot {
  lines: { type: 'build' | 'accessory'; code: string | null; sku: string; name: string; quantity: number; unit_cents: number }[];
  expiresAt: Date;
}

async function liveSnapshot(token: string): Promise<Snapshot> {
  const row = (
    await pool.query('SELECT lines, expires_at FROM shared_carts WHERE token = $1 AND expires_at > $2', [token, now()])
  ).rows[0] as { lines: Snapshot['lines']; expires_at: Date } | undefined;
  if (!row) fail('not_found');
  return { lines: row.lines, expiresAt: row.expires_at };
}
