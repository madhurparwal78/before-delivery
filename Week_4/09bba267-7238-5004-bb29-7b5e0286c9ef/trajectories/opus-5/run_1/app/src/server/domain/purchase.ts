import type { Order } from '../../shared/api';
import { seatFeeCents } from '../../shared/money';
import { type Db, first, withTransaction } from '../db';
import { buyerTopic, offerTopic, performanceTopic, recordChange } from '../live';
import { recordPurchase } from '../services/killbill';
import { loadCart } from './cart';
import {
  cancelOrder,
  createPendingOrder,
  issueOrder,
  loadOrder,
  publicOrder,
  recordPaymentTransaction,
  setKillbillAccount,
  type NewTicketLine,
} from './orders';
import { SALES_OPEN_SQL } from './rules';
import { freeSeat, lockSeatRows, markPaymentPending, releaseExpiredHolds } from './seats';

export type PurchaseResult =
  | { readonly kind: 'paid'; readonly order: Order }
  | { readonly kind: 'sales_closed' }
  | { readonly kind: 'cart_empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'offer_closed' }
  | { readonly kind: 'offer_expired' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unavailable' };

async function salesOpen(db: Db, performanceId: string): Promise<boolean> {
  const row = await first<{ sales_open: boolean }>(
    db,
    `select (${SALES_OPEN_SQL}) as sales_open from performances p where p.id = $1`,
    [performanceId],
  );
  return row?.sales_open === true;
}

async function purchaseOrder(input: {
  readonly orderId: string;
  readonly totalCents: number;
  readonly email: string;
  readonly name: string;
}): Promise<'confirmed' | 'declined' | 'unavailable'> {
  const outcome = await recordPurchase({
    email: input.email,
    name: input.name,
    paymentExternalKey: input.orderId,
    transactionExternalKey: `${input.orderId}-purchase`,
    amountCents: input.totalCents,
  });
  if (outcome.kind !== 'confirmed') return outcome.kind === 'declined' ? 'declined' : 'unavailable';
  await withTransaction(async (db) => {
    await recordPaymentTransaction(db, {
      orderId: input.orderId,
      kind: 'purchase',
      paymentExternalKey: input.orderId,
      killbillPaymentId: outcome.killbillPaymentId,
      amountCents: input.totalCents,
    });
    await setKillbillAccount(db, input.orderId, outcome.killbillAccountId);
  });
  return 'confirmed';
}

export async function checkout(input: {
  readonly performanceId: string;
  readonly buyerId: string;
  readonly name: string;
  readonly email: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
}): Promise<PurchaseResult> {
  const { performanceId, buyerId } = input;
  await withTransaction((db) => releaseExpiredHolds(db, performanceId));

  const prepared = await withTransaction(async (db) => {
    if (!(await salesOpen(db, performanceId))) return { kind: 'sales_closed' } as const;
    const cart = await loadCart(db, performanceId, buyerId);
    if (cart.seats.length === 0) return { kind: 'cart_empty' } as const;
    if (Object.keys(input.fieldErrors).length > 0) return { kind: 'invalid' } as const;
    const seatIds = cart.seats.map((line) => line.seatId);
    await lockSeatRows(db, performanceId, seatIds);
    const lines: NewTicketLine[] = cart.seats.map((line) => ({
      seatId: line.seatId,
      tierId: line.tierId,
      tierName: line.tierName,
      faceCents: line.faceCents,
      seatFeeCents: line.seatFeeCents,
    }));
    const order = await createPendingOrder(db, {
      performanceId,
      buyerId,
      name: input.name,
      email: input.email,
      lines,
    });
    await markPaymentPending(db, performanceId, seatIds, order.id);
    await recordChange(db, [buyerTopic(buyerId)]);
    return { kind: 'prepared', orderId: order.id, totalCents: order.totalCents, seatIds } as const;
  });
  if (prepared.kind !== 'prepared') return prepared;

  const outcome = await purchaseOrder({
    orderId: prepared.orderId,
    totalCents: prepared.totalCents,
    email: input.email,
    name: input.name,
  });

  return withTransaction(async (db) => {
    await lockSeatRows(db, performanceId, prepared.seatIds);
    await markPaymentPending(db, performanceId, prepared.seatIds, null);
    if (outcome === 'confirmed') {
      await issueOrder(db, prepared.orderId);
      await recordChange(db, [performanceTopic(performanceId), buyerTopic(buyerId)]);
      const order = await loadOrder(db, prepared.orderId, buyerId);
      return order ? ({ kind: 'paid', order: publicOrder(order) } as const) : ({ kind: 'unavailable' } as const);
    }
    await cancelOrder(db, prepared.orderId);
    if (outcome === 'declined') {
      for (const seatId of prepared.seatIds) await freeSeat(db, performanceId, seatId);
      await recordChange(db, [performanceTopic(performanceId), buyerTopic(buyerId)]);
      return { kind: 'declined' } as const;
    }
    await recordChange(db, [buyerTopic(buyerId)]);
    return { kind: 'unavailable' } as const;
  });
}

interface OfferClaim {
  token: string;
  performance_id: string;
  tier_id: string;
  seat_id: string;
  status: string;
  expired: boolean;
  entry_id: string;
  buyer_id: string;
  name: string;
  email: string;
  tier_name: string;
  face_cents: number;
}

export async function acceptOffer(token: string): Promise<PurchaseResult | undefined> {
  const prepared = await withTransaction(async (db) => {
    const offer = await first<OfferClaim>(
      db,
      `select f.token, f.performance_id, f.tier_id, f.seat_id, f.status,
              (f.expires_at <= now()) as expired, f.entry_id,
              w.buyer_id, w.name, w.email, t.name as tier_name, t.face_cents
       from offers f
       join waitlist_entries w on w.id = f.entry_id
       join tiers t on t.performance_id = f.performance_id and t.tier_id = f.tier_id
       where f.token = $1
       for update of f`,
      [token],
    );
    if (!offer) return undefined;
    if (offer.status !== 'open') {
      return { kind: offer.status === 'expired' ? 'offer_expired' : 'offer_closed' } as const;
    }
    if (offer.expired) {
      await db.query(`update offers set status = 'expired' where token = $1`, [offer.token]);
      await db.query(`update waitlist_entries set status = 'expired' where id = $1`, [offer.entry_id]);
      await lockSeatRows(db, offer.performance_id, [offer.seat_id]);
      await freeSeat(db, offer.performance_id, offer.seat_id);
      await recordChange(db, [offerTopic(token), buyerTopic(offer.buyer_id)]);
      return { kind: 'offer_expired' } as const;
    }
    if (!(await salesOpen(db, offer.performance_id))) return { kind: 'sales_closed' } as const;
    const order = await createPendingOrder(db, {
      performanceId: offer.performance_id,
      buyerId: offer.buyer_id,
      name: offer.name,
      email: offer.email,
      lines: [
        {
          seatId: offer.seat_id,
          tierId: offer.tier_id,
          tierName: offer.tier_name,
          faceCents: offer.face_cents,
          seatFeeCents: seatFeeCents(offer.face_cents),
        },
      ],
    });
    await db.query(`update offers set pending_order_id = $2 where token = $1`, [token, order.id]);
    await recordChange(db, [buyerTopic(offer.buyer_id)]);
    return {
      kind: 'prepared',
      offer,
      orderId: order.id,
      totalCents: order.totalCents,
    } as const;
  });
  if (prepared === undefined || prepared.kind !== 'prepared') return prepared;

  const { offer } = prepared;
  const outcome = await purchaseOrder({
    orderId: prepared.orderId,
    totalCents: prepared.totalCents,
    email: offer.email,
    name: offer.name,
  });

  return withTransaction(async (db) => {
    await db.query(`update offers set pending_order_id = null where token = $1`, [token]);
    await lockSeatRows(db, offer.performance_id, [offer.seat_id]);
    const topics = [performanceTopic(offer.performance_id), buyerTopic(offer.buyer_id), offerTopic(token)];
    if (outcome === 'confirmed') {
      await db.query(`update offers set status = 'accepted' where token = $1`, [token]);
      await db.query(`update waitlist_entries set status = 'accepted' where id = $1`, [offer.entry_id]);
      await issueOrder(db, prepared.orderId);
      await recordChange(db, topics);
      const order = await loadOrder(db, prepared.orderId, offer.buyer_id);
      return order ? ({ kind: 'paid', order: publicOrder(order) } as const) : ({ kind: 'unavailable' } as const);
    }
    await cancelOrder(db, prepared.orderId);
    if (outcome === 'declined') {
      await db.query(`update offers set status = 'declined' where token = $1`, [token]);
      await db.query(`update waitlist_entries set status = 'declined' where id = $1`, [offer.entry_id]);
      await freeSeat(db, offer.performance_id, offer.seat_id);
      await recordChange(db, topics);
      return { kind: 'declined' } as const;
    }
    await recordChange(db, [buyerTopic(offer.buyer_id)]);
    return { kind: 'unavailable' } as const;
  });
}
