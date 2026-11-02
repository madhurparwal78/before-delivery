import { randomUUID } from 'node:crypto';
import { pool, withClient, type DbClient } from '../db.js';
import { env } from '../env.js';
import { FLAVOUR_ORDER, getFlavour, pushStockLevels, stockLeftOf } from './catalogue.js';

export const CRATE_SIZE = 12;
export const DROP_LIMIT = 6;

export interface CartSlot {
  flavour: string | null;
  status: string;
}

export interface CartState {
  id: string;
  slots: CartSlot[];
  count: number;
  province: string;
  subscribe: boolean;
  cadence: string;
  hold: { status: 'active' | 'expired' | 'none'; expires_at: string | null };
}

export class HoldExpired extends Error {}
export class SoldOut extends Error {
  constructor(public stockLeft: number) {
    super();
  }
}
export class HoldLimit extends Error {
  constructor(public limit: 'crate' | 'drop', public stockLeft: number) {
    super();
  }
}

export async function ensureCart(cartId: string | undefined, userId: string | null, defaultProvince: string): Promise<string> {
  return withClient(async (client) => {
    if (cartId) {
      const found = await client.query('select id from carts where id = $1', [cartId]);
      if (found.rows.length > 0) return cartId;
    }
    const id = randomUUID();
    await client.query('insert into carts (id, user_id, province) values ($1, $2, $3)', [
      id,
      userId,
      defaultProvince,
    ]);
    await client.query(
      'insert into cart_slots (cart_id, slot) select $1, g from generate_series(0, 11) g',
      [id]
    );
    return id;
  });
}

export async function activeHold(cartId: string, client: DbClient): Promise<{ id: string; expires_at: Date } | null> {
  const q = await client.query(
    "select id, expires_at from holds where cart_id = $1 and status = 'active' and expires_at > now() order by created_at desc limit 1",
    [cartId]
  );
  if (q.rows.length === 0) return null;
  return { id: q.rows[0].id as string, expires_at: q.rows[0].expires_at as Date };
}

export async function releaseExpiredHolds(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const expired = await client.query<{ id: string }>(
      "select id from holds where status = 'active' and expires_at <= now() for update skip locked"
    );
    for (const hold of expired.rows) {
      await client.query("update holds set status = 'expired' where id = $1", [hold.id]);
      const slots = (await client.query<{ slot: number; flavour: string }>(
        "select slot, flavour from cart_slots where cart_id = (select cart_id from holds where id = $1) and flavour is not null",
        [hold.id]
      )).rows;
      await client.query(
        "update cart_slots set flavour = null where cart_id = (select cart_id from holds where id = $1)",
        [hold.id]
      );
      for (const slot of slots) {
        await client.query(
          "insert into stock_ledger (flavour, kind, qty, hold_id) values ($1, 'released', 1, $2)",
          [slot.flavour, hold.id]
        );
      }
    }
    await client.query('commit');
    if (expired.rows.length > 0) await pushStockLevels();
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function cartState(cartId: string, client: DbClient): Promise<CartState> {
  await client.query("update holds set status = 'expired' where cart_id = $1 and status = 'active' and expires_at <= now()", [cartId]);
  const cart = (await client.query('select id, province, subscribe, cadence from carts where id = $1', [cartId])).rows[0];
  const slots = (await client.query('select slot, flavour from cart_slots where cart_id = $1 order by slot', [cartId]))
    .rows as { slot: number; flavour: string | null }[];
  const hold = await activeHold(cartId, client);
  const anyFilled = slots.some((s) => s.flavour !== null);
  const holdStatus: CartState['hold']['status'] = hold ? 'active' : anyFilled ? 'expired' : 'none';
  return {
    id: cartId,
    slots: slots.map((s) => ({ flavour: s.flavour, status: 'held' })),
    count: slots.filter((s) => s.flavour !== null).length,
    province: cart.province,
    subscribe: cart.subscribe,
    cadence: cart.cadence,
    hold: {
      status: holdStatus,
      expires_at: hold ? hold.expires_at.toISOString() : null,
    },
  };
}

export interface AddResult {
  cart: CartState;
  added: { flavour: string; slots: number[] };
  stockLeft: number;
}

export async function addCans(cartId: string, flavour: string, quantity: number): Promise<AddResult> {
  const result = await withClient(async (client) => {
    await client.query('begin');
    try {
      await releaseExpiredHoldsWithin(client);
      const flavourRow = await getFlavour(flavour, client);
      if (!flavourRow) throw new Error('unknown flavour');
      const slots = (await client.query('select slot, flavour from cart_slots where cart_id = $1 order by slot for update', [cartId]))
        .rows as { slot: number; flavour: string | null }[];
      const empty = slots.filter((s) => s.flavour === null).map((s) => s.slot);
      const filled = slots.filter((s) => s.flavour !== null).length;
      if (filled + quantity > CRATE_SIZE) {
        throw new HoldLimit('crate', await stockLeftOf(flavour, client));
      }
      const dropCount = slots.filter((s) => s.flavour === flavourRow.slug).length;
      if (flavourRow.limited && dropCount + quantity > DROP_LIMIT) {
        throw new HoldLimit('drop', await stockLeftOf(flavour, client));
      }
      const stock = await stockLeftOf(flavour, client);
      if (quantity > stock) {
        throw new SoldOut(stock);
      }
      const targetSlots = empty.slice(0, quantity);
      if (targetSlots.length < quantity) throw new HoldLimit('crate', stock);

      let hold = await activeHold(cartId, client);
      if (!hold) {
        const holdId = randomUUID();
        const expires = new Date(Date.now() + env.holdSeconds * 1000);
        await client.query(
          "insert into holds (id, cart_id, expires_at, status) values ($1, $2, $3, 'active')",
          [holdId, cartId, expires]
        );
        hold = { id: holdId, expires_at: expires };
      }
      for (const slot of targetSlots) {
        await client.query('update cart_slots set flavour = $2 where cart_id = $1 and slot = $3', [
          cartId,
          flavourRow.slug,
          slot,
        ]);
        await client.query(
          "insert into stock_ledger (flavour, kind, qty, hold_id) values ($1, 'reserved', 1, $2)",
          [flavourRow.slug, hold.id]
        );
      }
      const cart = await cartState(cartId, client);
      const stockAfter = await stockLeftOf(flavour, client);
      await client.query('commit');
      return { cart, added: { flavour: flavourRow.slug, slots: targetSlots }, stockLeft: stockAfter };
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  });
  await pushStockLevels();
  return result;
}

async function releaseExpiredHoldsWithin(client: DbClient): Promise<void> {
  const expired = await client.query<{ id: string; cart_id: string }>(
    "select id, cart_id from holds where status = 'active' and expires_at <= now() for update skip locked"
  );
  for (const hold of expired.rows) {
    await client.query("update holds set status = 'expired' where id = $1", [hold.id]);
    const slots = (await client.query<{ flavour: string }>(
      'select flavour from cart_slots where cart_id = $1 and flavour is not null',
      [hold.cart_id]
    )).rows;
    await client.query('update cart_slots set flavour = null where cart_id = $1', [hold.cart_id]);
    for (const slot of slots) {
      await client.query(
        "insert into stock_ledger (flavour, kind, qty, hold_id) values ($1, 'released', 1, $2)",
        [slot.flavour, hold.id]
      );
    }
  }
}

export async function removeCan(cartId: string, slot: number): Promise<{ cart: CartState; stockLeft: number }> {
  const result = await withClient(async (client) => {
    await client.query('begin');
    try {
      const row = (await client.query<{ flavour: string | null }>(
        'select flavour from cart_slots where cart_id = $1 and slot = $2 for update',
        [cartId, slot]
      )).rows[0];
      if (!row || row.flavour === null) throw new Error('empty slot');
      const hold = await activeHold(cartId, client);
      await client.query('update cart_slots set flavour = null where cart_id = $1 and slot = $2', [cartId, slot]);
      if (hold) {
        await client.query(
          "insert into stock_ledger (flavour, kind, qty, hold_id) values ($1, 'released', 1, $2)",
          [row.flavour, hold.id]
        );
      }
      const remaining = (await client.query<{ n: number }>(
        'select count(*)::int as n from cart_slots where cart_id = $1 and flavour is not null',
        [cartId]
      )).rows[0].n;
      if (remaining === 0) {
        await client.query("update holds set status = 'none' where cart_id = $1 and status = 'active'", [cartId]);
      }
      const stockLeft = await stockLeftOf(row.flavour, client);
      const cart = await cartState(cartId, client);
      await client.query('commit');
      return { cart, stockLeft };
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  });
  await pushStockLevels();
  return result;
}

export async function updateCartSettings(
  cartId: string,
  patch: { province?: string; subscribe?: boolean; cadence?: string }
): Promise<CartState> {
  return withClient(async (client) => {
    if (patch.province !== undefined) {
      await client.query('update carts set province = $2 where id = $1', [cartId, patch.province]);
    }
    if (patch.cadence !== undefined) {
      await client.query('update carts set cadence = $2 where id = $1', [cartId, patch.cadence]);
    }
    if (patch.subscribe !== undefined) {
      if (patch.subscribe) {
        await assertSubscribable(cartId, client);
      }
      await client.query('update carts set subscribe = $2 where id = $1', [cartId, patch.subscribe]);
    }
    return cartState(cartId, client);
  });
}

export async function assertSubscribable(cartId: string, client: DbClient): Promise<void> {
  const slots = (await client.query<{ flavour: string | null }>(
    'select flavour from cart_slots where cart_id = $1 order by slot',
    [cartId]
  )).rows;
  const counts = new Map<string, number>();
  for (const s of slots) {
    if (s.flavour) counts.set(s.flavour, (counts.get(s.flavour) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total !== CRATE_SIZE) throw new Error('not_subscribable');
  for (const [flavour] of counts) {
    const f = await getFlavour(flavour, client);
    if (!f?.subscribable) throw new Error('not_subscribable');
  }
  const regular = FLAVOUR_ORDER.slice(0, 3);
  const mix = [...counts.entries()];
  if (mix.length === 1) return;
  if (
    mix.length === 3 &&
    regular.every((r) => (counts.get(r) ?? 0) === 4)
  ) {
    return;
  }
  throw new Error('not_subscribable');
}

export function planFor(counts: Map<string, number>, cadence: string): string | null {
  if (counts.size === 1) {
    const flavour = [...counts.keys()][0];
    return `ceibo-${flavour}-${cadence}`;
  }
  if (counts.size === 3) {
    return `ceibo-discovery-${cadence}`;
  }
  return null;
}

export async function takeCartForCheckout(cartId: string): Promise<{
  slots: { flavour: string; slot: number }[];
  province: string;
  subscribe: boolean;
  cadence: string;
  holdId: string;
} | null> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      await releaseExpiredHoldsWithin(client);
      const hold = await activeHold(cartId, client);
      const slots = (await client.query<{ slot: number; flavour: string | null }>(
        'select slot, flavour from cart_slots where cart_id = $1 order by slot for update',
        [cartId]
      )).rows;
      if (!hold || slots.length !== CRATE_SIZE || slots.some((s) => s.flavour === null)) {
        await client.query('rollback');
        return null;
      }
      const cart = (await client.query('select province, subscribe, cadence from carts where id = $1', [cartId]))
        .rows[0];
      await client.query('commit');
      return {
        slots: slots.map((s) => ({ flavour: s.flavour!, slot: s.slot })),
        province: cart.province,
        subscribe: cart.subscribe,
        cadence: cart.cadence,
        holdId: hold.id,
      };
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  });
}

export async function clearCart(cartId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('begin');
    await client.query('update cart_slots set flavour = null where cart_id = $1', [cartId]);
    await client.query("update holds set status = 'none' where cart_id = $1 and status = 'active'", [cartId]);
    await client.query('commit');
  });
}
