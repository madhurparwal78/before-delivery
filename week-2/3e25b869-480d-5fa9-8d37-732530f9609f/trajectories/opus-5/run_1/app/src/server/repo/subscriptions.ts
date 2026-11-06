import { trioPrice } from '../../shared/money.js';
import type {
  Cadence,
  Locale,
  ShippingAddress,
  Subscription,
  SubscriptionState,
} from '../../shared/types.js';
import type { Queryable } from '../db/pool.js';
import { isLocked, lockInstant } from '../domain/subscriptions.js';
import { orderedShipping, orderedTaxLines } from './normalize.js';

export type SubscriptionRow = {
  number: string;
  customer_id: string;
  locale: Locale;
  state: SubscriptionState;
  scent: string;
  cadence: Cadence;
  pending_cadence: Cadence | null;
  started_on: string;
  next_bill_date: string | null;
  skipped_bill_date: string | null;
  paused_from: string | null;
  bill_anchor: string;
  shipping: ShippingAddress;
  version: number;
  killbill_subscription_id: string;
};

const SUBSCRIPTION_COLUMNS = `number, customer_id, locale, state, scent, cadence, pending_cadence,
  started_on, next_bill_date, skipped_bill_date, paused_from, bill_anchor, shipping, version,
  killbill_subscription_id`;

export async function loadSubscription(
  client: Queryable,
  number: string,
  options: { forUpdate?: boolean } = {},
): Promise<SubscriptionRow | null> {
  const result = await client.query<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE number = $1${
      options.forUpdate ? ' FOR UPDATE' : ''
    }`,
    [number],
  );
  return result.rows[0] ?? null;
}

export async function loadLiveSubscriptionOf(
  client: Queryable,
  customerId: string,
): Promise<SubscriptionRow | null> {
  const result = await client.query<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
      WHERE customer_id = $1 AND state IN ('active', 'paused')`,
    [customerId],
  );
  return result.rows[0] ?? null;
}

export function serializeSubscription(row: SubscriptionRow, now: Date): Subscription {
  const price = trioPrice(row.shipping.province);
  return {
    number: row.number,
    state: row.state,
    scent: row.scent,
    cadence: row.cadence,
    pending_cadence: row.pending_cadence,
    started_on: row.started_on,
    next_bill_date: row.next_bill_date,
    skipped_bill_date: row.skipped_bill_date,
    paused_from: row.paused_from,
    locks_at: row.next_bill_date === null ? null : lockInstant(row.next_bill_date).toISOString(),
    locked: isLocked(row.next_bill_date, now),
    shipping: orderedShipping(row.shipping),
    price: {
      subtotal: price.subtotal,
      discount: price.discount,
      pre_tax: price.pre_tax,
      taxes: orderedTaxLines(price.taxes),
      total: price.total,
    },
    version: row.version,
  };
}
