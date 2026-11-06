import { Router, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { withClient } from '../db.js';
import * as pb from '../services/pocketbase.js';
import { getObject, S3Unavailable } from '../services/s3.js';
import { requireRole } from './session.js';
import { handleSession } from './accounts.js';
import { orderJson, listRefunds } from './accounts.js';
import * as ordersDomain from '../domain/orders.js';
import * as subsDomain from '../domain/subscriptions.js';
import { stockForAll } from '../domain/catalogue.js';
import { refundableCents, splitRefund, mergeRefundedSplits, type RefundSplit } from '../domain/refund.js';
import * as emails from '../domain/emails.js';
import { serviceStatus } from './middleware.js';
import { flushOutbox } from '../services/mail.js';
import { flavourName } from "../domain/catalogue.js";

const router = Router();

const FULFILMENT = ['fulfilment', 'support', 'owner'];
const SUPPORT = ['support', 'owner'];

router.get('/staff/status', async (_req, res) => {
  res.json({ services: serviceStatus });
});

router.get('/staff/queue', async (req, res) => {
  try {
    await requireRole(req, FULFILMENT);
    const orders = await withClient(async (client) => {
      const q = await client.query(
        "select * from orders where status in ('paid','picking','packed') order by placed_at"
      );
      return q.rows as unknown as ordersDomain.OrderRow[];
    });
    const out = [];
    for (const order of orders) {
      out.push(orderJson(order, '', await listRefunds(order.number)));
    }
    res.json({ orders: out });
  } catch (e) {
    handleSessionRole(e, res);
  }
});

function handleSessionRole(e: unknown, res: Response): void {
  if ((e as { kind?: string }).kind === 'role') {
    res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
    return;
  }
  if ((e as { kind?: string }).kind === 'unauthenticated') {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }
  if ((e as { kind?: string }).kind === 'store') {
    res.status(503).json({ error: 'store_unavailable', message: "The shop can't update right now. Try again in a moment." });
    return;
  }
  handleSession(e, res);
}

router.post('/staff/orders/:number/transitions', async (req, res) => {
  try {
    const info = await requireRole(req, ['fulfilment', 'owner']);
    void info;
    const to = (req.body as { to?: unknown }).to;
    if (to !== 'picking' && to !== 'packed' && to !== 'shipped') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { to: 'Pick the next status.' } });
      return;
    }
    const order = await ordersDomain.getOrder(req.params.number);
    if (!order) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    if (!ordersDomain.transitionAllowed(order.status, to)) {
      res.status(409).json({ error: 'illegal_transition', message: `Order ${order.number} can't move to ${to} from here.` });
      return;
    }
    await withClient(async (client) => {
      await client.query('update orders set status = $2 where number = $1', [order.number, to]);
    });
    const updated = (await ordersDomain.getOrder(order.number))!;
    res.json({ order: orderJson(updated, '', await listRefunds(order.number)) });
  } catch (e) {
    handleSessionRole(e, res);
  }
});

router.get('/staff/orders/:number', async (req, res) => {
  try {
    await requireRole(req, FULFILMENT);
    const order = await ordersDomain.getOrder(req.params.number);
    if (!order) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    let customer = { name: '', email: '' };
    try {
      const user = await pb.getUser(order.user_id);
      customer = { name: user.name, email: user.email };
    } catch {
      // Accounts unreachable; order detail still loads.
    }
    res.json({ order: orderJson(order, '', await listRefunds(order.number)), customer });
  } catch (e) {
    handleSessionRole(e, res);
  }
});

router.get('/staff/orders/:number/packing-slip.pdf', async (req, res) => {
  try {
    await requireRole(req, FULFILMENT);
    const order = await ordersDomain.getOrder(req.params.number);
    if (!order) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    const obj = await getObject(`orders/${order.number}/packing-slip.pdf`);
    if (!obj) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that packing slip." });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.send(obj.data);
  } catch (e) {
    if (e instanceof S3Unavailable) {
      res.status(503).json({ error: 'files_unavailable', message: 'File storage is unreachable right now.' });
      return;
    }
    handleSessionRole(e, res);
  }
});

router.get('/staff/stock', async (req, res) => {
  try {
    await requireRole(req, FULFILMENT);
    const figures = await stockForAll();
    const out = [];
    for (const f of figures) {
      out.push({
        flavour: await flavourName(f.flavour),
        received: f.received,
        sold: f.sold,
        returned: f.returned,
        on_hand: f.on_hand,
        reserved: f.reserved,
        available: f.available,
        released: f.released,
      });
    }
    res.json({ flavours: out });
  } catch (e) {
    handleSessionRole(e, res);
  }
});

router.get('/staff/search', async (req, res) => {
  try {
    await requireRole(req, FULFILMENT);
    const q = String(req.query.q ?? '').trim();
    if (q === '') {
      res.json({ orders: [], subscriptions: [] });
      return;
    }
    const lower = q.toLowerCase();
    const orders = await withClient(async (client) => {
      const result = await client.query('select * from orders where lower(number) = $1', [lower]);
      return result.rows as unknown as ordersDomain.OrderRow[];
    });
    let subscriptionRows: subsDomain.SubscriptionRow[] = [];
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
      try {
        const user = await pb.findUserByEmail(q);
        if (user) {
          subscriptionRows = await subsDomain.listSubscriptionRows(user.id);
        }
      } catch {
        // PocketBase down: subscriptions just won't match.
      }
    }
    const outOrders = [];
    for (const order of orders) {
      outOrders.push(orderJson(order, '', await listRefunds(order.number)));
    }
    const outSubs = [];
    const { subscriptionJson } = await import('./subscriptions.js');
    for (const row of subscriptionRows) {
      try {
        outSubs.push(await subscriptionJson(row));
      } catch {
        // Billing unreachable: skip this subscription's live view.
      }
    }
    res.json({ orders: outOrders, subscriptions: outSubs });
  } catch (e) {
    handleSessionRole(e, res);
  }
});

type RefundIdemOutcome =
  | { kind: 'mismatch' }
  | { kind: 'replay'; status: number; body: Record<string, unknown> }
  | { kind: 'waiting' }
  | { kind: 'fresh' };

router.post('/staff/orders/:number/refunds', async (req, res) => {
  try {
    const info = await requireRole(req, SUPPORT);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      res.status(422).json({
        error: 'validation',
        message: 'Check the highlighted fields.',
        fields: { idempotency_key: 'Send a refund key of 8 to 128 characters.' },
      });
      return;
    }
    const body = req.body as { amount_cents?: unknown; reason?: unknown };
    if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents) || body.amount_cents < 1) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { amount_cents: 'Enter an amount to refund.' } });
      return;
    }
    if (typeof body.reason !== 'string' || body.reason.trim().length < 1 || body.reason.trim().length > 500) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { reason: 'Enter a reason.' } });
      return;
    }
    const order = await ordersDomain.getOrder(req.params.number);
    if (!order) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    if (order.status === 'pending_payment' || order.refund_status === 'refunded') {
      res.status(409).json({ error: 'not_refundable', message: 'This order has nothing left to refund.' });
      return;
    }
    const refunds = await withClient(async (client) => {
      const q = await client.query(
        `select * from refunds where order_number = $1 and status in ('pending_provider','applied') order by created_at`,
        [order.number]
      );
      return q.rows as { amount_cents: number; split: RefundSplit }[];
    });
    const refundedSplits = refunds.map((r) => r.split);
    const merged = mergeRefundedSplits(refundedSplits);
    const left = refundableCents(order, merged);
    if (left <= 0) {
      res.status(409).json({ error: 'not_refundable', message: 'This order has nothing left to refund.' });
      return;
    }
    if (body.amount_cents > left) {
      res.status(422).json({
        error: 'validation',
        message: 'Check the highlighted fields.',
        fields: { amount_cents: `Only $${(left / 100).toFixed(2)} is left to refund on this order.` },
      });
      return;
    }
    const hash = createHash('sha256').update(JSON.stringify({ a: body.amount_cents, r: body.reason.trim() })).digest('hex');
    const idem: RefundIdemOutcome = await withClient(async (client) => {
      const existing = await client.query(
        `select * from idempotency_keys where kind = 'refund' and key = $1 and created_at > now() - interval '24 hours'`,
        [key]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.user_id !== info.user.id || row.request_hash !== hash) {
          return { kind: 'mismatch' } satisfies RefundIdemOutcome;
        }
        if (row.status === 'finished') {
          return {
            kind: 'replay',
            status: Number(row.response_status),
            body: (row.response_body ?? {}) as Record<string, unknown>,
          } satisfies RefundIdemOutcome;
        }
        return { kind: 'waiting' } satisfies RefundIdemOutcome;
      }
      await client.query(
        `insert into idempotency_keys (kind, key, user_id, request_hash, status) values ('refund', $1, $2, $3, 'running')
         on conflict (kind, key) do nothing`,
        [key, info.user.id, hash]
      );
      return { kind: 'fresh' } satisfies RefundIdemOutcome;
    });
    if (idem.kind === 'mismatch') {
      res.status(409).json({ error: 'idempotency_mismatch', message: 'That refund key was used for a different refund.' });
      return;
    }
    if (idem.kind === 'replay') {
      res.status(idem.status).json(idem.body);
      return;
    }
    if (idem.kind === 'waiting') {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 400));
        const row = await withClient(async (client) =>
          (await client.query(`select status, response_status, response_body from idempotency_keys where kind = 'refund' and key = $1`, [key])).rows[0]
        );
        if (row && row.status === 'finished') {
          res.status(row.response_status as number).json((row.response_body ?? {}) as Record<string, unknown>);
          return;
        }
      }
      res.status(409).json({ error: 'idempotency_mismatch', message: 'That refund is still running.' });
      return;
    }
    const split = splitRefund(order, merged, body.amount_cents as number);
    const refundId = randomUUID();
    await withClient(async (client) => {
      await client.query(
        `insert into refunds (id, order_number, status, amount_cents, reason, split)
         values ($1, $2, 'pending_provider', $3, $4, $5)`,
        [refundId, order.number, body.amount_cents as number, (body.reason as string).trim(), JSON.stringify(split)]
      );
    });
    const result = {
      status: 202,
      body: {
        refund: {
          id: refundId,
          status: 'pending_provider',
          amount_cents: body.amount_cents,
          reason: body.reason.trim(),
          split,
          created_at: new Date().toISOString(),
        },
        order: orderJson(order, '', await listRefunds(order.number)),
      },
    };
    await withClient(async (client) => {
      await client.query(
        `update idempotency_keys set status = 'finished', response_status = $1, response_body = $2 where kind = 'refund' and key = $3`,
        [result.status, JSON.stringify(result.body), key]
      );
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    handleSessionRole(e, res);
  }
});

router.post('/staff/orders/:number/resend-receipt', async (req, res) => {
  try {
    await requireRole(req, SUPPORT);
    const order = await ordersDomain.getOrder(req.params.number);
    if (!order) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    const { env } = await import('../env.js');
    await emails.queueReceiptCopy({ number: order.number, email: order.email }, env.appPublicUrl);
    void flushOutbox;
    res.status(202).json({ queued: true });
  } catch (e) {
    handleSessionRole(e, res);
  }
});

export { router as staffRouter };
