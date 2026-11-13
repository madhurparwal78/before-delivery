import { Db, tx } from '../db/pool';
import { Location } from './constants';
import { publishStockFor } from './events';
import { holdActive, holdExpiresAt } from './rules';
import { availableByLocation, lockVariants, pickLocation, writeMovement } from './stock';

export type CheckoutLine = {
  sku: string;
  variant_id: string;
  quantity: number;
  price: number | null;
  location: Location | null;
};

export type CheckoutRow = {
  id: string;
  user_id: string;
  step: string;
  email: string | null;
  phone: string | null;
  address: Record<string, unknown> | null;
  shipping_method: string;
  shipping_chosen: boolean;
  gift: boolean;
  gift_message: string;
  discount_code: string | null;
  gift_card_code: string | null;
  lines: CheckoutLine[];
  hold_reserved_at: Date | null;
  hold_released_at: Date | null;
  order_number: string | null;
  payment_state: string | null;
  version: number;
};

export async function releaseHold(client: Db, checkout: CheckoutRow, reason: 'hold_released' | 'hold_lapsed'): Promise<void> {
  if (checkout.hold_reserved_at === null || checkout.hold_released_at !== null) return;
  const marked = await client.one<{ id: string }>(
    `UPDATE checkouts SET hold_released_at = now()
     WHERE id = $1 AND hold_reserved_at IS NOT NULL AND hold_released_at IS NULL RETURNING id`,
    [checkout.id]
  );
  if (marked === null) return;
  await lockVariants(client, checkout.lines.map((line) => line.variant_id));
  for (const line of checkout.lines) {
    const location: Location = line.location ?? 'bhiwandi';
    await writeMovement(client, line.variant_id, reason, checkout.id, location, line.quantity);
  }
  await publishStockFor(client, checkout.lines.map((line) => line.variant_id));
}

export function parseCheckoutRow(row: Record<string, unknown>): CheckoutRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    step: String(row.step),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    address: (row.address as Record<string, unknown> | null) ?? null,
    shipping_method: String(row.shipping_method),
    shipping_chosen: Boolean(row.shipping_chosen),
    gift: Boolean(row.gift),
    gift_message: String(row.gift_message ?? ''),
    discount_code: (row.discount_code as string | null) ?? null,
    gift_card_code: (row.gift_card_code as string | null) ?? null,
    lines: (row.lines as CheckoutLine[]) ?? [],
    hold_reserved_at: (row.hold_reserved_at as Date | null) ?? null,
    hold_released_at: (row.hold_released_at as Date | null) ?? null,
    order_number: (row.order_number as string | null) ?? null,
    payment_state: (row.payment_state as string | null) ?? null,
    version: Number(row.version)
  };
}

export async function sweepLapsedHolds(): Promise<void> {
  await tx(async (client) => {
    const rows = await client.query<Record<string, unknown>>(
      `SELECT * FROM checkouts
       WHERE hold_reserved_at IS NOT NULL AND hold_released_at IS NULL AND order_number IS NULL
       ORDER BY hold_reserved_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED`
    );
    const now = new Date();
    for (const row of rows) {
      const checkout = parseCheckoutRow(row);
      if (checkout.hold_reserved_at === null) continue;
      if (now.getTime() < holdExpiresAt(checkout.hold_reserved_at).getTime()) continue;
      await releaseHold(client, checkout, 'hold_lapsed');
    }
  });
}

export function startHoldSweeper(): void {
  setInterval(() => {
    void sweepLapsedHolds().catch(() => undefined);
  }, 5000);
}

export type ReserveFailure = { sku: string; variantId: string; available: number };

export async function reserveLines(
  client: Db,
  checkout: CheckoutRow
): Promise<{ ok: true } | { ok: false; failure: ReserveFailure }> {
  await lockVariants(client, checkout.lines.map((line) => line.variant_id));
  const allocations: Array<{ line: CheckoutLine; location: Location }> = [];
  for (const line of checkout.lines) {
    const byLocation = await availableByLocation(client, line.variant_id);
    const total = byLocation.bhiwandi + byLocation.gurugram;
    if (total < line.quantity) {
      return { ok: false, failure: { sku: line.sku, variantId: line.variant_id, available: total } };
    }
    const location = pickLocation(byLocation);
    if (byLocation[location] < line.quantity) {
      const other: Location = location === 'bhiwandi' ? 'gurugram' : 'bhiwandi';
      if (byLocation[other] >= line.quantity) allocations.push({ line, location: other });
      else allocations.push({ line, location });
    } else {
      allocations.push({ line, location });
    }
  }
  for (const allocation of allocations) {
    await writeMovement(
      client,
      allocation.line.variant_id,
      'hold_placed',
      checkout.id,
      allocation.location,
      allocation.line.quantity
    );
    allocation.line.location = allocation.location;
  }
  return { ok: true };
}

export function holdStatus(
  checkout: CheckoutRow,
  now: Date
): { status: 'none' | 'active' | 'expired'; expires_at: string | null; seconds_left: number } {
  if (checkout.hold_reserved_at === null) return { status: 'none', expires_at: null, seconds_left: 0 };
  const expiresAt = holdExpiresAt(checkout.hold_reserved_at);
  if (holdActive(checkout.hold_reserved_at, checkout.hold_released_at, now)) {
    return {
      status: 'active',
      expires_at: expiresAt.toISOString(),
      seconds_left: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
    };
  }
  return { status: 'expired', expires_at: expiresAt.toISOString(), seconds_left: 0 };
}
