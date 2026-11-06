import { randomUUID } from 'node:crypto';
import { CART, CONFLICTS, FIELD_MESSAGES } from '../../shared/copy.js';
import { DEFAULT_PROVINCE } from '../../shared/money.js';
import { config, LIMITS } from '../config.js';
import { db, withTransaction } from '../db/pool.js';
import { PUBLIC_STATES } from '../domain/batches.js';
import { lowestAvailableBar } from '../domain/stock.js';
import { boundedText, parseBody } from '../http/body.js';
import type { ApiResponse, RequestContext } from '../http/context.js';
import { errors } from '../http/errors.js';
import { loadBatch } from '../repo/batches.js';
import { buildCart, effectiveHoldStatus, HOLD_COLUMNS, serializeHold, type HoldRow } from '../repo/cart.js';
import { readProvinceQuery } from './public.js';

const HOLD_SHAPE = { batch: boundedText(FIELD_MESSAGES.batch, 1, 32) } as const;

export async function createHold(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, HOLD_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const code = parsed.value.batch;
  const cartId = ctx.cartId ?? randomUUID();
  const now = new Date();

  const outcome = await withTransaction(async (client) => {
    // Serialising on the batch row is what makes the last bar go to exactly one shopper.
    const locked = await client.query('SELECT code FROM batches WHERE code = $1 FOR UPDATE', [code]);
    if (locked.rowCount === 0) return { kind: 'not_found' } as const;
    const batch = await loadBatch(client, now, code);
    if (!batch || !PUBLIC_STATES.includes(batch.state)) return { kind: 'not_found' } as const;
    if (batch.state === 'scheduled') return { kind: 'not_live' } as const;
    if (batch.state === 'sold_out') return { kind: 'sold_out' } as const;

    const mine = batch.holds.filter((hold) => hold.cart_id === cartId).length;
    if (mine >= LIMITS.holdsPerCartPerBatch) return { kind: 'hold_limit' } as const;

    const bar = lowestAvailableBar(batch.bars);
    if (bar === null) {
      return batch.counts.held > 0 ? ({ kind: 'all_held' } as const) : ({ kind: 'sold_out' } as const);
    }
    const expiresAt = new Date(now.getTime() + config.holdTtlSeconds * 1_000);
    const inserted = await client.query<HoldRow>(
      `INSERT INTO holds (cart_id, batch_code, bar, status, created_at, expires_at)
       VALUES ($1, $2, $3, 'active', $4, $5)
       RETURNING ${HOLD_COLUMNS}`,
      [cartId, code, bar, now, expiresAt],
    );
    const row = inserted.rows[0];
    if (!row) return { kind: 'sold_out' } as const;
    return { kind: 'created', row } as const;
  });

  if (outcome.kind === 'not_found') throw errors.notFound();
  if (outcome.kind === 'not_live') throw errors.conflict('not_live', CART.notLive);
  if (outcome.kind === 'sold_out') throw errors.conflict('sold_out', CART.soldOut);
  if (outcome.kind === 'all_held') throw errors.conflict('all_held', CART.allHeld);
  if (outcome.kind === 'hold_limit') throw errors.conflict('hold_limit', CART.holdLimit);

  if (ctx.cartId === null) ctx.setCartCookie(cartId);
  const province = readProvinceQuery(ctx) ?? DEFAULT_PROVINCE;
  const cart = await buildCart(db, cartId, province, now);
  return { status: 201, body: { hold: serializeHold(outcome.row, now), cart } };
}

export async function releaseHold(ctx: RequestContext): Promise<ApiResponse> {
  const id = ctx.params['id'] ?? '';
  const cartId = ctx.cartId;
  if (cartId === null) throw errors.notFound();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw errors.notFound();
  const now = new Date();
  const row = await withTransaction(async (client) => {
    const found = await client.query<HoldRow>(
      `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1 AND cart_id = $2 FOR UPDATE`,
      [id, cartId],
    );
    const hold = found.rows[0];
    if (!hold) return null;
    if (effectiveHoldStatus(hold, now) !== 'active') {
      throw errors.conflict('hold_not_active', CONFLICTS.holdNotActive);
    }
    const updated = await client.query<HoldRow>(
      `UPDATE holds SET status = 'released' WHERE id = $1 RETURNING ${HOLD_COLUMNS}`,
      [id],
    );
    return updated.rows[0] ?? null;
  });
  if (!row) throw errors.notFound();
  return { status: 200, body: { hold: serializeHold(row, now) } };
}
