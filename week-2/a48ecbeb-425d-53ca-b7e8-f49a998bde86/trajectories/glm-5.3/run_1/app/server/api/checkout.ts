import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { withClient } from '../db.js';
import { databaseName, env } from '../env.js';
import * as kb from '../services/killbill.js';
import { S3Unavailable } from '../services/s3.js';
import { requireUser, type SessionInfo } from './session.js';
import { cartFromRequest } from './catalog.js';
import * as cartDomain from '../domain/cart.js';
import { quoteFor } from '../domain/quote.js';
import { luhnValid, toStoredCard, expiryValid, chargeApproved, markCardUsed, type CardInput } from '../domain/card.js';
import { torontoNow } from '../domain/geo.js';
import * as ordersDomain from '../domain/orders.js';
import * as subsDomain from '../domain/subscriptions.js';
import * as emails from '../domain/emails.js';
import { pushStockLevels } from '../domain/catalogue.js';
import { orderJson, listRefunds } from './accounts.js';
import type { ApiResult } from './respond.js';

const router = Router();

async function bodyHash(body: unknown): Promise<string> {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

interface CheckoutBody {
  address_id: string;
  subscribe: boolean;
  cadence: string | null;
  card: CardInput;
}

export type IdemOutcome =
  | { kind: 'mismatch' }
  | { kind: 'replay'; status: number; body: Record<string, unknown> }
  | { kind: 'waiting' }
  | { kind: 'fresh' };

async function lookupIdemOutcome(
  kind: 'checkout' | 'refund',
  key: string,
  userId: string,
  hash: string
): Promise<IdemOutcome> {
  return withClient(async (client) => {
    const existing = await client.query(
      `select * from idempotency_keys where key = $1 and kind = $2 and created_at > now() - interval '24 hours'`,
      [key, kind]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.user_id !== userId || row.request_hash !== hash) {
        return { kind: 'mismatch' } satisfies IdemOutcome;
      }
      if (row.status === 'finished') {
        return {
          kind: 'replay',
          status: Number(row.response_status),
          body: (row.response_body ?? {}) as Record<string, unknown>,
        } satisfies IdemOutcome;
      }
      return { kind: 'waiting' } satisfies IdemOutcome;
    }
    await client.query(
      `insert into idempotency_keys (kind, key, user_id, request_hash, status) values ($1, $2, $3, $4, 'running')
       on conflict (kind, key) do nothing`,
      [kind, key, userId, hash]
    );
    return { kind: 'fresh' } satisfies IdemOutcome;
  });
}

async function checkoutWithKey(req: Request, info: SessionInfo, key: string, body: CheckoutBody): Promise<ApiResult> {
  const hash = await bodyHash(body);
  const idem: IdemOutcome = await lookupIdemOutcome('checkout', key, info.user.id, hash);
  if (idem.kind === 'mismatch') {
    return { status: 409, body: { error: 'idempotency_mismatch', message: 'That checkout key was used for a different basket.' } };
  }
  if (idem.kind === 'replay') {
    return { status: idem.status, body: idem.body };
  }
  if (idem.kind === 'waiting') {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const row = await withClient(async (client) =>
        (await client.query(
          `select status, response_status, response_body from idempotency_keys where kind = 'checkout' and key = $1`,
          [key]
        )).rows[0]
      );
      if (row && row.status === 'finished') {
        return { status: Number(row.response_status), body: (row.response_body ?? {}) as Record<string, unknown> };
      }
    }
    return { status: 409, body: { error: 'idempotency_mismatch', message: 'That checkout is still running.' } };
  }
  const result = await runCheckout(req, info, body);
  if (result.status === 503) {
    await withClient(async (client) => {
      await client.query(`delete from idempotency_keys where kind = 'checkout' and key = $1`, [key]);
    });
  } else {
    await withClient(async (client) => {
      await client.query(
        `update idempotency_keys set status = 'finished', response_status = $1, response_body = $2 where kind = 'checkout' and key = $3`,
        [result.status, JSON.stringify(result.body), key]
      );
    });
  }
  return result;
}

async function runCheckout(req: Request, info: SessionInfo, body: CheckoutBody): Promise<ApiResult> {
  const cartId = await cartFromRequest(req, res_proxy(req));
  const cartData = await cartDomain.takeCartForCheckout(cartId);
  if (!cartData) {
    const state = await withClient((client) => cartDomain.cartState(cartId, client));
    if (state.count < 12) {
      return { status: 409, body: { error: 'crate_not_full', message: 'Your crate needs 12 cans to check out.' } };
    }
    return { status: 409, body: { error: 'hold_expired', message: 'Your hold ended and the cans went back on the shelf.' } };
  }
  const { getAddress } = await import('../services/pocketbase.js');
  const found = await getAddress(body.address_id);
  const address = found && found.user === info.user.id ? found : null;
  if (!address) {
    return { status: 404, body: { error: 'not_found', message: "We couldn't find that address." } };
  }
  const counts = new Map<string, number>();
  for (const slot of cartData.slots) {
    counts.set(slot.flavour, (counts.get(slot.flavour) ?? 0) + 1);
  }
  let subscribe = body.subscribe === true;
  let planId: string | null = null;
  if (subscribe) {
    planId = cartDomain.planFor(counts, cartData.cadence);
    if (!planId) subscribe = false;
  }
  if (body.subscribe === true && !subscribe) {
    return { status: 409, body: { error: 'not_subscribable', message: 'Subscriptions come as 12 of one flavour or 4 of each.' } };
  }
  const cardDigits = body.card.number.replace(/\s+/g, '');
  const fields: Record<string, string> = {};
  if (!/^\d{13,19}$/.test(cardDigits) || !luhnValid(cardDigits)) {
    fields.card_number = 'Enter a valid card number.';
  }
  if (
    !Number.isInteger(body.card.expiry_month) ||
    body.card.expiry_month < 1 ||
    body.card.expiry_month > 12 ||
    !Number.isInteger(body.card.expiry_year) ||
    body.card.expiry_year < 1000 ||
    !expiryValid(body.card.expiry_month, body.card.expiry_year, torontoNow())
  ) {
    fields.expiry = 'Enter a future expiry date as MM/YY.';
  }
  if (!/^\d{3}$/.test(body.card.cvc)) {
    fields.cvc = 'Enter the 3-digit security code.';
  }
  if (Object.keys(fields).length > 0) {
    return { status: 422, body: { error: 'validation', message: 'Check the highlighted fields.', fields } };
  }
  const storedCard = toStoredCard({ number: cardDigits, expiry_month: body.card.expiry_month, expiry_year: body.card.expiry_year, cvc: body.card.cvc });
  const quote = await withClient((client) =>
    quoteFor(client, {
      province: address.province,
      subscribe,
      cans: [...counts.entries()].map(([flavour, quantity]) => ({ flavour, quantity })),
    })
  );

  let kbAccount;
  let paymentMethodId: string;
  try {
    kbAccount = await kb.ensureAccount(info.user.name, info.user.id);
    paymentMethodId = await kb.ensurePaymentMethod(kbAccount.accountId);
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      return { status: 503, body: { error: 'billing_unavailable', message: 'Payments are paused for a moment. Your crate is still held, so try again shortly.' } };
    }
    throw e;
  }

  const number = await withClient(async (client) => ordersDomain.nextOrderNumber(client));
  const paymentKey = `${databaseName()}/${number}`;
  const order = await withClient(async (client) =>
    ordersDomain.insertOrder(client, {
      number,
      user_id: info.user.id,
      province: address.province,
      subscription_id: null,
      lines: quote.lines,
      goods_cents: quote.goods_cents,
      discount_cents: quote.discount_cents,
      discounted_goods_cents: quote.discounted_goods_cents,
      shipping_cents: quote.shipping_cents,
      deposit_cents: quote.deposit_cents,
      taxes: quote.taxes,
      total_cents: quote.total_cents,
      ship_to: {
        name: address.name,
        line1: address.line1,
        line2: address.line2 ?? '',
        city: address.city,
        province: address.province,
        postal_code: address.postal_code,
      },
      card: { brand: storedCard.brand, last4: storedCard.last4 },
      kb_account_id: kbAccount.accountId,
      kb_invoice_id: null,
      email: info.user.email,
    })
  );

  // Freeze the hold so the expiry job cannot release it mid-checkout.
  await withClient(async (client) => {
    await client.query("update holds set status = 'ended' where id = $1 and status = 'active'", [cartData.holdId]);
  });

  let subscriptionId: string | null = null;
  let boxInvoiceId: string | null = null;
  if (subscribe && planId) {
    try {
      const created = await kb.createSubscription(kbAccount.accountId, planId);
      subscriptionId = created.subscriptionId;
      const plan = subsDomain.getPlan(planId)!;
      const startYmd = new Date().toISOString().slice(0, 10);
      const nextCycle = addMonthsLocal(startYmd, cartData.cadence === 'monthly' ? 1 : 2);
      const boxQuote = await withClient((client) =>
        quoteFor(client, {
          province: address.province,
          subscribe: true,
          cans: Object.entries(plan.flavourBox).map(([flavour, quantity]) => ({ flavour, quantity })),
        })
      );
      const chargeItems: { amount: number; description: string }[] = [
        { amount: boxQuote.discounted_goods_cents, description: `${plan.label} (plan charge)` },
        { amount: boxQuote.deposit_cents, description: 'Deposit for 12 cans' },
      ];
      if (boxQuote.shipping_cents > 0) chargeItems.push({ amount: boxQuote.shipping_cents, description: 'Shipping' });
      for (const tax of boxQuote.taxes) {
        chargeItems.push({ amount: tax.cents, description: `${tax.name} (${tax.rate}%)` });
      }
      const items = await kb.addCharges(kbAccount.accountId, chargeItems);
      boxInvoiceId = items[0]?.invoiceId ?? null;
      if (boxInvoiceId) {
        await kb.commitInvoice(boxInvoiceId);
      }
      await withClient(async (client) => {
        await client.query(
          `insert into subscriptions (id, user_id, kb_account_id, plan, plan_label, cadence, address, card, next_cycle)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
          [
            subscriptionId,
            info.user.id,
            kbAccount.accountId,
            planId,
            plan.label,
            cartData.cadence,
            JSON.stringify({
              name: address.name,
              line1: address.line1,
              line2: address.line2 ?? '',
              city: address.city,
              province: address.province,
              postal_code: address.postal_code,
            }),
            JSON.stringify(storedCard),
            nextCycle,
          ]
        );
        await client.query('update orders set subscription_id = $2, kb_invoice_id = $3 where number = $1', [
          number,
          subscriptionId,
          boxInvoiceId,
        ]);
      });
      order.subscription_id = subscriptionId;
      order.kb_invoice_id = boxInvoiceId;
    } catch (e) {
      if (e instanceof kb.KillBillUnavailable) {
        await restoreHold(cartData.holdId);
        await ordersDomain.deleteOrderRow(number);
        return { status: 503, body: { error: 'billing_unavailable', message: 'Payments are paused for a moment. Your crate is still held, so try again shortly.' } };
      }
      throw e;
    }
  }

  try {
    await ordersDomain.writeOrderPdfs(order);
  } catch (e) {
    if (e instanceof S3Unavailable) {
      await restoreHold(cartData.holdId);
      await ordersDomain.deleteOrderRow(number);
      return { status: 503, body: { error: 'files_unavailable', message: "Receipts can't be saved right now, so we haven't charged you. Try again shortly." } };
    }
    throw e;
  }

  const approved = chargeApproved(storedCard);
  markCardUsed(storedCard);
  if (subscriptionId) {
    await withClient(async (client) => {
      await client.query('update subscriptions set card = $2 where id = $1', [subscriptionId, JSON.stringify(storedCard)]);
    });
  }
  if (!approved) {
    await restoreHold(cartData.holdId);
    await ordersDomain.deleteOrderRow(number);
    return { status: 402, body: { error: 'card_declined', message: 'Your card was declined. No money was taken.' } };
  }

  try {
    if (subscriptionId && boxInvoiceId) {
      await kb.invoicePurchase(kbAccount.accountId, paymentMethodId, boxInvoiceId, quote.total_cents, paymentKey);
    } else {
      await kb.accountPurchase(kbAccount.accountId, paymentMethodId, quote.total_cents, paymentKey, `${paymentKey}-txn`);
    }
  } catch (e) {
    await restoreHold(cartData.holdId);
    if (e instanceof kb.KillBillUnavailable) {
      await ordersDomain.deleteOrderRow(number);
      return { status: 503, body: { error: 'billing_unavailable', message: 'Payments are paused for a moment. Your crate is still held, so try again shortly.' } };
    }
    throw e;
  }

  await withClient(async (client) => {
    for (const slot of cartData.slots) {
      await ordersDomain.sellHeldCans(cartData.holdId, number, slot.flavour, 1);
    }
    await client.query("update orders set status = 'paid' where number = $1", [number]);
  });
  await cartDomain.clearCart(cartId);
  await pushStockLevels();
  const finalOrder = (await ordersDomain.getOrder(number))!;
  await emails.queueOrderConfirmation(
    {
      number: finalOrder.number,
      email: finalOrder.email,
      lines: finalOrder.lines,
      deposit_cents: finalOrder.deposit_cents,
      shipping_cents: finalOrder.shipping_cents,
      taxes: finalOrder.taxes,
      total_cents: finalOrder.total_cents,
    },
    env.appPublicUrl
  );
  return {
    status: 201,
    body: { order: orderJson(finalOrder, env.appPublicUrl, await listRefunds(number)), ...(subscriptionId ? { subscription_id: subscriptionId } : {}) },
  };
}

async function restoreHold(holdId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query("update holds set status = 'active' where id = $1 and status = 'ended'", [holdId]);
  });
}

function res_proxy(req: Request): Response {
  // cartFromRequest needs a Response to set the cookie; re-use the real one via the request's bound res.
  return (req as unknown as { __res: Response }).__res;
}

router.post('/checkout', async (req, res) => {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
    res.status(422).json({
      error: 'validation',
      message: 'Check the highlighted fields.',
      fields: { idempotency_key: 'Send a checkout key of 8 to 128 characters.' },
    });
    return;
  }
  try {
    const info = await requireUser(req);
    const body = req.body as Record<string, unknown>;
    const card = body.card as { number?: unknown; expiry_month?: unknown; expiry_year?: unknown; cvc?: unknown } | undefined;
    if (
      !card ||
      typeof card.number !== 'string' ||
      typeof card.expiry_month !== 'number' ||
      typeof card.expiry_year !== 'number' ||
      typeof card.cvc !== 'string'
    ) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { card: 'Enter your card details.' } });
      return;
    }
    if (typeof body.address_id !== 'string') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { address_id: 'Pick a shipping address.' } });
      return;
    }
    (req as unknown as { __res: Response }).__res = res;
    const result = await checkoutWithKey(req, info, key, {
      address_id: body.address_id,
      subscribe: body.subscribe === true,
      cadence: typeof body.cadence === 'string' ? body.cadence : null,
      card: { number: card.number, expiry_month: card.expiry_month, expiry_year: card.expiry_year, cvc: card.cvc },
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    if ((e as { kind?: string }).kind === 'unauthenticated') {
      res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
      return;
    }
    if ((e as { kind?: string }).kind === 'store') {
      res.status(503).json({ error: 'store_unavailable', message: "The shop can't take orders right now. You haven't been charged." });
      return;
    }
    throw e;
  }
});

export { router as checkoutRouter };

function addMonthsLocal(ymdStr: string, months: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day, 12)).toISOString().slice(0, 10);
}
