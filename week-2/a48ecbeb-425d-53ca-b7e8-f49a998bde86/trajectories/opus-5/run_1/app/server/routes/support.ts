import { DEFAULT_PROVINCE, type ProvinceCode, findProvince } from '../../shared/catalogue.js';
import type { UserRole } from '../services/pocketbase.js';
import { createCart, type Crate } from '../db/cart.js';
import { CART_COOKIE } from '../db/sessions.js';
import type { OrderRecord } from '../db/orders.js';
import { listAddresses } from '../services/pocketbase.js';
import type { RequestContext, SetCookie } from '../http/router.js';

export const CUSTOMER_ONLY: readonly UserRole[] = ['customer'];
export const FULFILMENT_ROLES: readonly UserRole[] = ['fulfilment', 'support', 'owner'];
export const TRANSITION_ROLES: readonly UserRole[] = ['fulfilment', 'owner'];
export const REFUND_ROLES: readonly UserRole[] = ['support', 'owner'];
export const OWNER_ONLY: readonly UserRole[] = ['owner'];

export interface CartHandle {
  id: string;
  cookies: SetCookie[];
}

/** The crate's province defaults to the customer's default address province. */
async function startingProvince(ctx: RequestContext): Promise<ProvinceCode> {
  if (ctx.user === null || ctx.user.role !== 'customer') return DEFAULT_PROVINCE;
  try {
    const addresses = await listAddresses(ctx.user.id);
    const code = addresses.find((address) => address.is_default)?.province;
    return findProvince(code ?? '')?.code ?? DEFAULT_PROVINCE;
  } catch {
    return DEFAULT_PROVINCE;
  }
}

/** Identifies the crate, creating one and its cookie on the first cart request. */
export async function openCart(ctx: RequestContext): Promise<CartHandle> {
  if (ctx.cartId !== null) return { id: ctx.cartId, cookies: [] };
  const id = await createCart(ctx.user?.id ?? null, await startingProvince(ctx));
  return { id, cookies: [{ name: CART_COOKIE, value: id, maxAgeSeconds: 60 * 60 * 24 * 7 }] };
}

export function crateBody(crate: Crate): unknown {
  return {
    slots: crate.slots,
    count: crate.count,
    province: crate.province,
    subscribe: crate.subscribe,
    cadence: crate.cadence,
    hold: crate.hold,
    server_time: crate.server_time,
  };
}

export function orderBody(order: OrderRecord): unknown {
  return {
    number: order.number,
    status: order.status,
    refund_status: order.refund_status,
    placed_at: order.placed_at,
    province: order.province,
    subscription_id: order.subscription_id,
    lines: order.lines,
    goods_cents: order.goods_cents,
    discount_cents: order.discount_cents,
    discounted_goods_cents: order.discounted_goods_cents,
    shipping_cents: order.shipping_cents,
    deposit_cents: order.deposit_cents,
    taxes: order.taxes,
    total_cents: order.total_cents,
    refunded_cents: order.refunded_cents,
    refundable_cents: order.refundable_cents,
    ship_to: order.ship_to,
    refunds: order.refunds.map((refund) => ({
      id: refund.id,
      status: refund.status,
      amount_cents: refund.amount_cents,
      reason: refund.reason,
      split: refund.split,
      created_at: refund.created_at,
    })),
    thank_you_url: `/orders/${order.number}/thanks`,
    invoice_url: `/api/orders/${order.number}/invoice.pdf`,
  };
}

