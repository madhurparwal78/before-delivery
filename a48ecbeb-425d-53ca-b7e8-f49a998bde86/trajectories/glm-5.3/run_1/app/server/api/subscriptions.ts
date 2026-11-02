import { Router } from 'express';
import { withClient } from '../db.js';
import { env } from '../env.js';
import * as kb from '../services/killbill.js';
import { requireUser } from './session.js';
import { handleSession } from './accounts.js';
import * as subsDomain from '../domain/subscriptions.js';
import { luhnValid, toStoredCard, expiryValid } from '../domain/card.js';
import { torontoNow, torontoYmd } from '../domain/geo.js';
import { clearDunning, clearShipmentsHeld } from '../domain/dunning.js';
import { chargeBoxInvoice } from '../domain/renewal.js';
import { advanceNextCycle, periodMonthsOf } from '../domain/subscriptions.js';
import type { ApiResult } from './respond.js';

const router = Router();

function changeJson(change: subsDomain.ChangeRequestRow): Record<string, unknown> {
  return {
    id: change.id,
    kind: change.kind,
    status: change.status,
    effective_date: subsDomain.ymd(change.effective_date),
    requested_at: change.requested_at.toISOString(),
  };
}

export async function subscriptionJson(row: subsDomain.SubscriptionRow): Promise<Record<string, unknown>> {
  const kbNow = await kb.getClock();
  const { pending, lastChange } = await subsDomain.readChanges(row.id);
  const dunning = await subsDomain.readDunning(row.id);
  const view = await subsDomain.subscriptionView(row, kbNow, dunning, pending, lastChange, env.changeCutoffHours);
  return {
    id: view.id,
    plan: view.plan,
    plan_label: view.plan_label,
    cadence: view.cadence,
    state: view.state,
    next_renewal_date: view.next_renewal_date,
    billing_end_date: view.billing_end_date,
    pause: view.pause,
    skip: view.skip,
    change_cutoff: view.change_cutoff,
    changes_apply_to: view.changes_apply_to,
    pending_change: view.pending_change ? changeJson(view.pending_change) : null,
    last_change: view.last_change ? changeJson(view.last_change) : null,
    dunning: view.dunning,
    card: view.card,
  };
}

router.get('/subscriptions', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const rows = await subsDomain.listSubscriptionRows(info.user.id);
    const out = [];
    for (const row of rows) {
      out.push(await subscriptionJson(row));
    }
    res.json({ subscriptions: out });
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      res.status(503).json({ error: 'billing_unavailable', message: 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.' });
      return;
    }
    handleSession(e, res);
  }
});

router.get('/subscriptions/:id', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const row = await subsDomain.loadSubscriptionRow(req.params.id);
    if (!row || row.user_id !== info.user.id) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that subscription." });
      return;
    }
    res.json({ subscription: await subscriptionJson(row) });
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      res.status(503).json({ error: 'billing_unavailable', message: 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.' });
      return;
    }
    handleSession(e, res);
  }
});

router.get('/subscriptions/:id/changes/:changeId', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const row = await subsDomain.loadSubscriptionRow(req.params.id);
    if (!row || row.user_id !== info.user.id) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that subscription." });
      return;
    }
    const change = await withClient(async (client) => {
      const q = await client.query('select * from change_requests where id = $1 and subscription_id = $2', [
        req.params.changeId,
        req.params.id,
      ]);
      return (q.rows[0] as unknown as subsDomain.ChangeRequestRow) ?? null;
    });
    if (!change) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that change." });
      return;
    }
    res.json({ change: changeJson(change) });
  } catch (e) {
    handleSession(e, res);
  }
});

router.post('/subscriptions/:id/changes', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const row = await subsDomain.loadSubscriptionRow(req.params.id);
    if (!row || row.user_id !== info.user.id) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that subscription." });
      return;
    }
    const body = req.body as { kind?: unknown; cycles?: unknown; plan?: unknown };
    if (typeof body.kind !== 'string') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { kind: 'Pick a change.' } });
      return;
    }
    const kind = body.kind;
    if (!['pause', 'resume', 'skip', 'swap', 'cancel'].includes(kind)) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { kind: 'Pick a change.' } });
      return;
    }
    if (kind === 'pause') {
      if (typeof body.cycles !== 'number' || !Number.isInteger(body.cycles) || body.cycles < 1 || body.cycles > 3) {
        res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { cycles: 'Pause for 1 to 3 boxes.' } });
        return;
      }
    }
    if (kind === 'swap') {
      const plan = subsDomain.getPlan(typeof body.plan === 'string' ? body.plan : '');
      if (!plan) {
        res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { plan: 'Pick one of the listed boxes.' } });
        return;
      }
      const currentPlan = subsDomain.getPlan(row.plan)!;
      if (plan.cadence !== currentPlan.cadence) {
        res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { plan: 'Pick a box with the same delivery rhythm.' } });
        return;
      }
    }
    const kbNow = await kb.getClock();
    const { pending, lastChange } = await subsDomain.readChanges(row.id);
    if (pending) {
      res.status(409).json({ error: 'change_pending', message: 'A change is already waiting for confirmation.' });
      return;
    }
    const dunning = await subsDomain.readDunning(row.id);
    const view = await subsDomain.subscriptionView(row, kbNow, dunning, pending, lastChange, env.changeCutoffHours);
    if (kind === 'cancel') {
      if (view.state === 'cancel_pending' || view.state === 'cancelled') {
        res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
        return;
      }
    } else if (view.state === 'cancel_pending' || view.state === 'cancelled' || view.state === 'past_due') {
      res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
      return;
    }
    if (kind === 'pause' && (view.state !== 'active' || view.pause !== null)) {
      res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
      return;
    }
    if (kind === 'resume' && view.pause === null) {
      res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
      return;
    }
    if (kind === 'skip' && (view.state !== 'active' || view.skip !== null)) {
      res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
      return;
    }
    if (kind === 'swap' && body.plan === row.plan) {
      res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
      return;
    }
    const changeId = crypto.randomUUID();
    const effective = kind === 'resume' ? torontoYmd(new Date()) : view.changes_apply_to;
    await withClient(async (client) => {
      await client.query(
        `insert into change_requests (id, subscription_id, kind, status, effective_date, payload)
         values ($1, $2, $3, 'pending_provider', $4, $5)`,
        [changeId, row.id, kind, effective, JSON.stringify({ cycles: body.cycles ?? null, plan: body.plan ?? null })]
      );
    });
    res.status(202).json({
      change: {
        id: changeId,
        kind,
        status: 'pending_provider',
        effective_date: effective,
        requested_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      res.status(503).json({ error: 'billing_unavailable', message: 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.' });
      return;
    }
    handleSession(e, res);
  }
});

router.put('/subscriptions/:id/card', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const row = await subsDomain.loadSubscriptionRow(req.params.id);
    if (!row || row.user_id !== info.user.id) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that subscription." });
      return;
    }
    const kbNow = await kb.getClock();
    const dunning = await subsDomain.readDunning(row.id);
    const { pending, lastChange } = await subsDomain.readChanges(row.id);
    const view = await subsDomain.subscriptionView(row, kbNow, dunning, pending, lastChange, env.changeCutoffHours);
    if (view.state === 'cancel_pending' || view.state === 'cancelled') {
      res.status(409).json({ error: 'illegal_change', message: "That change isn't possible right now." });
      return;
    }
    const card = req.body as { number?: unknown; expiry_month?: unknown; expiry_year?: unknown; cvc?: unknown };
    if (typeof card.number !== 'string' || typeof card.expiry_month !== 'number' || typeof card.expiry_year !== 'number' || typeof card.cvc !== 'string') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { card: 'Enter your card details.' } });
      return;
    }
    const cardDigits = card.number.replace(/\s+/g, '');
    const fields: Record<string, string> = {};
    if (!/^\d{13,19}$/.test(cardDigits) || !luhnValid(cardDigits)) fields.number = 'Enter a valid card number.';
    if (!expiryValid(card.expiry_month, card.expiry_year, torontoNow())) fields.expiry = 'Enter a future expiry date as MM/YY.';
    if (!/^\d{3}$/.test(card.cvc)) fields.cvc = 'Enter the 3-digit security code.';
    if (Object.keys(fields).length > 0) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields });
      return;
    }
    const stored = toStoredCard({ number: cardDigits, expiry_month: card.expiry_month, expiry_year: card.expiry_year, cvc: card.cvc });
    let message = 'Card updated.';
    if (view.state === 'past_due') {
      const openInvoiceId = await withClient(async (client) => {
        const q = await client.query('select invoice_id from dunning_steps where subscription_id = $1 order by due_at limit 1', [row.id]);
        return (q.rows[0]?.invoice_id as string | null) ?? null;
      });
      const result = await chargeBoxInvoice(row, openInvoiceId ?? '', stored);
      if (!result.approved) {
        res.status(402).json({ error: 'card_declined', message: 'Your card was declined. No money was taken.' });
        return;
      }
      await clearDunning(row.id);
      await clearShipmentsHeld(row);
      await advanceNextCycle(row.id, periodMonthsOf(row));
      message = 'Card updated. Your renewal is paid and your boxes are back on.';
    }
    await withClient(async (client) => {
      await client.query('update subscriptions set card = $2 where id = $1', [row.id, JSON.stringify(stored)]);
    });
    const sub = await subscriptionJson(row);
    res.json({ ...sub, message });
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      res.status(503).json({ error: 'billing_unavailable', message: 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.' });
      return;
    }
    handleSession(e, res);
  }
});

export { router as subscriptionsRouter };
export type { ApiResult };
