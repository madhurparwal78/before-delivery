import crypto from 'node:crypto';
import {
  CRATE_SIZE,
  DROP_HOLD_LIMIT,
  type Cadence,
  type FlavourSlug,
  type ProvinceCode,
  findFlavour,
} from '../../shared/catalogue.js';
import { env } from '../env.js';
import { lockedStockFigures, writeLedgerEvent } from './ledger.js';
import { query, transaction, type Transaction } from './pool.js';

export type HoldStatus = 'active' | 'expired' | 'none';

export interface CrateSlot {
  flavour: FlavourSlug;
  status: 'held';
}

export interface Crate {
  id: string;
  slots: Array<CrateSlot | null>;
  count: number;
  province: ProvinceCode;
  subscribe: boolean;
  cadence: Cadence;
  hold: { status: HoldStatus; expires_at: string | null };
  server_time: string;
}

interface CartRow {
  id: string;
  user_id: string | null;
  province: string;
  subscribe: boolean;
  cadence: string;
  hold_expires_at: Date | null;
  hold_expired: boolean;
}

interface ItemRow {
  slot_index: number;
  flavour: string;
}

export type AddRefusal =
  | { refusal: 'sold_out'; stockLeft: number }
  | { refusal: 'hold_limit'; limit: 'crate' | 'drop'; stockLeft: number };

export interface AddGranted {
  granted: true;
  slots: number[];
  stockLeft: number;
}

export type AddResult = AddGranted | (AddRefusal & { granted: false });

function toCrate(row: CartRow, items: readonly ItemRow[], now: Date): Crate {
  const slots: Array<CrateSlot | null> = Array.from({ length: CRATE_SIZE }, () => null);
  for (const item of items) {
    slots[item.slot_index] = { flavour: item.flavour as FlavourSlug, status: 'held' };
  }
  const expiresAt = row.hold_expires_at;
  const active = expiresAt !== null && now.getTime() < expiresAt.getTime();
  return {
    id: row.id,
    slots,
    count: items.length,
    province: row.province as ProvinceCode,
    subscribe: row.subscribe,
    cadence: row.cadence as Cadence,
    hold: {
      status: active ? 'active' : row.hold_expired ? 'expired' : 'none',
      expires_at: active ? expiresAt.toISOString() : null,
    },
    server_time: now.toISOString(),
  };
}

async function readCart(tx: Transaction, cartId: string): Promise<CartRow | null> {
  const rows = await tx.query<CartRow>('select * from carts where id = $1 for update', [cartId]);
  return rows[0] ?? null;
}

async function readItems(tx: Transaction, cartId: string): Promise<ItemRow[]> {
  return tx.query<ItemRow>(
    'select slot_index, flavour from cart_items where cart_id = $1 order by slot_index',
    [cartId],
  );
}

/**
 * Gives an expired hold's cans back. Any request touching the crate at or after
 * `expires_at` runs this first, so it never sees cans it no longer holds.
 */
async function releaseIfExpired(tx: Transaction, row: CartRow, now: Date): Promise<CartRow> {
  if (row.hold_expires_at === null || now.getTime() < row.hold_expires_at.getTime()) return row;
  const items = await readItems(tx, row.id);
  for (const item of items) {
    await writeLedgerEvent(tx, item.flavour as FlavourSlug, 'released', 1);
  }
  await tx.execute('delete from cart_items where cart_id = $1', [row.id]);
  await tx.execute(
    'update carts set hold_expires_at = null, hold_expired = true, subscribe = false where id = $1',
    [row.id],
  );
  return { ...row, hold_expires_at: null, hold_expired: true, subscribe: false };
}

/** Creates the crate behind a `ceibo_cart` cookie on the first cart request. */
export async function createCart(
  userId: string | null,
  province: ProvinceCode,
): Promise<string> {
  const id = crypto.randomUUID();
  await query('insert into carts (id, user_id, province) values ($1, $2, $3)', [
    id,
    userId,
    province,
  ]);
  return id;
}

export async function loadCrate(cartId: string): Promise<Crate | null> {
  return transaction(async (tx) => {
    const row = await readCart(tx, cartId);
    if (row === null) return null;
    const now = new Date();
    const fresh = await releaseIfExpired(tx, row, now);
    return toCrate(fresh, await readItems(tx, fresh.id), now);
  });
}

export interface CrateChoices {
  province?: ProvinceCode;
  subscribe?: boolean;
  cadence?: Cadence;
}

export async function updateCrateChoices(
  cartId: string,
  choices: CrateChoices,
): Promise<Crate | null> {
  return transaction(async (tx) => {
    const row = await readCart(tx, cartId);
    if (row === null) return null;
    const now = new Date();
    const fresh = await releaseIfExpired(tx, row, now);
    const next: CartRow = {
      ...fresh,
      province: choices.province ?? fresh.province,
      subscribe: choices.subscribe ?? fresh.subscribe,
      cadence: choices.cadence ?? fresh.cadence,
    };
    await tx.execute(
      'update carts set province = $2, subscribe = $3, cadence = $4 where id = $1',
      [cartId, next.province, next.subscribe, next.cadence],
    );
    return toCrate(next, await readItems(tx, cartId), now);
  });
}

/** Turns subscribe-and-save off when an edit makes the crate ineligible. */
export async function clearSubscribe(cartId: string): Promise<void> {
  await query('update carts set subscribe = false where id = $1', [cartId]);
}

export interface AddOutcome {
  crate: Crate;
  result: AddResult;
}

/**
 * Reserves `quantity` cans in one go, all or nothing, into the lowest-numbered
 * empty slots. The crate's 12-can limit is checked before the limited drop's
 * 6-can limit, and both before stock.
 */
export async function reserveCans(
  cartId: string,
  flavour: FlavourSlug,
  quantity: number,
): Promise<AddOutcome | null> {
  return transaction(async (tx) => {
    const row = await readCart(tx, cartId);
    if (row === null) return null;
    const now = new Date();
    const fresh = await releaseIfExpired(tx, row, now);
    const items = await readItems(tx, cartId);
    const figures = await lockedStockFigures(tx);
    const stockLeft = figures.get(flavour)!.available;

    const refuse = (result: AddRefusal): AddOutcome => ({
      crate: toCrate(fresh, items, now),
      result: { ...result, granted: false },
    });

    if (items.length + quantity > CRATE_SIZE) {
      return refuse({ refusal: 'hold_limit', limit: 'crate', stockLeft });
    }
    if (findFlavour(flavour)!.limited) {
      const held = items.filter((item) => item.flavour === flavour).length;
      if (held + quantity > DROP_HOLD_LIMIT) {
        return refuse({ refusal: 'hold_limit', limit: 'drop', stockLeft });
      }
    }
    if (quantity > stockLeft) {
      return refuse({ refusal: 'sold_out', stockLeft });
    }

    const taken = new Set(items.map((item) => item.slot_index));
    const slots: number[] = [];
    for (let index = 0; index < CRATE_SIZE && slots.length < quantity; index += 1) {
      if (!taken.has(index)) slots.push(index);
    }
    for (const slot of slots) {
      await tx.execute(
        'insert into cart_items (cart_id, slot_index, flavour) values ($1, $2, $3)',
        [cartId, slot, flavour],
      );
    }
    await writeLedgerEvent(tx, flavour, 'reserved', quantity);

    // One hold per crate: it starts at the first reservation and is never extended.
    const holdExpiresAt =
      fresh.hold_expires_at ??
      new Date(now.getTime() + env.timing.holdSeconds * 1000);
    await tx.execute(
      'update carts set hold_expires_at = $2, hold_expired = false where id = $1',
      [cartId, holdExpiresAt],
    );

    const nextRow: CartRow = { ...fresh, hold_expires_at: holdExpiresAt, hold_expired: false };
    const nextItems = [
      ...items,
      ...slots.map((slot) => ({ slot_index: slot, flavour: flavour as string })),
    ].sort((left, right) => left.slot_index - right.slot_index);

    return {
      crate: toCrate(nextRow, nextItems, now),
      result: { granted: true, slots, stockLeft: stockLeft - quantity },
    };
  });
}

export interface RemoveOutcome {
  crate: Crate;
  flavour: FlavourSlug;
  stockLeft: number;
}

export async function releaseCan(
  cartId: string,
  slotIndex: number,
): Promise<RemoveOutcome | 'empty_slot' | null> {
  return transaction(async (tx) => {
    const row = await readCart(tx, cartId);
    if (row === null) return null;
    const now = new Date();
    const fresh = await releaseIfExpired(tx, row, now);
    const items = await readItems(tx, cartId);
    const found = items.find((item) => item.slot_index === slotIndex);
    if (found === undefined) return 'empty_slot';

    const flavour = found.flavour as FlavourSlug;
    await tx.execute('delete from cart_items where cart_id = $1 and slot_index = $2', [
      cartId,
      slotIndex,
    ]);
    await writeLedgerEvent(tx, flavour, 'released', 1);

    const remaining = items.filter((item) => item.slot_index !== slotIndex);
    const nextRow: CartRow =
      remaining.length === 0
        ? { ...fresh, hold_expires_at: null, hold_expired: false, subscribe: false }
        : fresh;
    if (remaining.length === 0) {
      await tx.execute(
        'update carts set hold_expires_at = null, hold_expired = false, subscribe = false where id = $1',
        [cartId],
      );
    }

    const figures = await lockedStockFigures(tx);
    return {
      crate: toCrate(nextRow, remaining, now),
      flavour,
      stockLeft: figures.get(flavour)!.available,
    };
  });
}

/**
 * Turns a crate's held cans into sold stock at checkout. The reservation is
 * consumed, so the hold ends and the crate empties.
 */
export async function sellCrate(
  tx: Transaction,
  cartId: string,
): Promise<Array<{ flavour: FlavourSlug; quantity: number }>> {
  const items = await readItems(tx, cartId);
  const counts = new Map<FlavourSlug, number>();
  for (const item of items) {
    const flavour = item.flavour as FlavourSlug;
    counts.set(flavour, (counts.get(flavour) ?? 0) + 1);
  }
  for (const [flavour, quantity] of counts) {
    await writeLedgerEvent(tx, flavour, 'released', quantity);
    await writeLedgerEvent(tx, flavour, 'sold', quantity);
  }
  await tx.execute('delete from cart_items where cart_id = $1', [cartId]);
  await tx.execute(
    'update carts set hold_expires_at = null, hold_expired = false, subscribe = false where id = $1',
    [cartId],
  );
  return [...counts].map(([flavour, quantity]) => ({ flavour, quantity }));
}


/**
 * Releases every hold that has passed its expiry, whether or not a page is open.
 * Claiming is the update itself, so one process does each crate exactly once.
 */
export async function releaseExpiredHolds(): Promise<FlavourSlug[]> {
  return transaction(async (tx) => {
    const expired = await tx.query<{ id: string }>(
      `select id from carts
        where hold_expires_at is not null and hold_expires_at <= now()
        order by hold_expires_at
        for update skip locked`,
    );
    const touched: FlavourSlug[] = [];
    for (const cart of expired) {
      const items = await readItems(tx, cart.id);
      for (const item of items) {
        await writeLedgerEvent(tx, item.flavour as FlavourSlug, 'released', 1);
        touched.push(item.flavour as FlavourSlug);
      }
      await tx.execute('delete from cart_items where cart_id = $1', [cart.id]);
      await tx.execute(
        'update carts set hold_expires_at = null, hold_expired = true, subscribe = false where id = $1',
        [cart.id],
      );
    }
    return touched;
  });
}

export async function attachCartToUser(cartId: string, userId: string): Promise<void> {
  await query('update carts set user_id = $2 where id = $1', [cartId, userId]);
}
