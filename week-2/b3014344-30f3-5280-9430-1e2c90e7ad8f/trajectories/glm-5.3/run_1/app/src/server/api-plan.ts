import type { Router } from './http.js';
import { HttpError, sendJson } from './util.js';
import { PLAN_READ_OUTAGE_COPY, PLAN_CHANGE_OUTAGE_COPY, BillingUnavailable } from './billing.js';
import { requireClientOwner, isUuid, notFound } from './auth.js';
import { parseCareTier } from './domain.js';
import {
  cancelPlan,
  confirmChange,
  createPreview,
  loadPlanState,
  pausePlan,
  planStatus,
  planView,
  previewToJson,
  resumePlan,
} from './plans.js';
import { withIdempotency } from './api-orders.js';
import { validateCard, cardDecision, declineError } from './cards.js';
import { chargeInvoice, orderReceiptPath, queueEmail, receiptEmail, type ChargeContext } from './billing.js';
import { getAccount } from './auth.js';

export function registerPlanRoutes(router: Router): void {
  router.get('/api/plan', async (ctx) => {
    const user = requireClientOwner(ctx.session);
    const state = await readPlan(ctx, user.accountId!);
    if (!state) throw new HttpError(404, 'plan_not_found', 'Your account has no care plan.');
    sendJson(ctx.res, 200, { plan: planView(state) });
  });

  router.post('/api/plan/previews', async (ctx) => {
    const user = requireClientOwner(ctx.session);
    const body = await ctx.body<{ tier?: string }>();
    const tier = parseCareTier(String(body.tier ?? ''));
    const state = await changePlan(ctx, user.accountId!);
    if (!state) throw notFound();
    if (planStatus(state) !== 'active' || state.pauseOn) {
      throw new HttpError(409, 'invalid_transition', `This plan is ${planStatus(state).replace(/_/g, ' ')} and cannot change right now.`);
    }
    const preview = await createPreview(ctx.db, state, tier);
    sendJson(ctx.res, 201, previewToJson(preview));
  });

  router.post('/api/plan/changes', async (ctx) => {
    await withIdempotency(ctx, async (body) => {
      const user = requireClientOwner(ctx.session);
      const previewId = String(body.previewId ?? '');
      if (!isUuid(previewId)) throw notFound();
      await changePlan(ctx, user.accountId!);
      const result = await confirmChange(ctx.db, user.accountId!, previewId);
      return { status: 200, body: { plan: result.plan, invoice: result.invoice } };
    });
  });

  router.post('/api/plan/pause', async (ctx) => {
    await withIdempotency(ctx, async () => {
      const user = requireClientOwner(ctx.session);
      const state = await changePlan(ctx, user.accountId!);
      if (!state) throw notFound();
      const plan = await pausePlan(ctx.db, state);
      return { status: 200, body: { plan } };
    });
  });

  router.post('/api/plan/resume', async (ctx) => {
    await withIdempotency(ctx, async () => {
      const user = requireClientOwner(ctx.session);
      const state = await changePlan(ctx, user.accountId!);
      if (!state) throw notFound();
      const plan = await resumePlan(ctx.db, state);
      return { status: 200, body: { plan } };
    });
  });

  router.post('/api/plan/cancel', async (ctx) => {
    await withIdempotency(ctx, async () => {
      const user = requireClientOwner(ctx.session);
      const state = await changePlan(ctx, user.accountId!);
      if (!state) throw notFound();
      const plan = await cancelPlan(ctx.db, state);
      return { status: 200, body: { plan } };
    });
  });

  router.post('/api/plan/card', async (ctx) => {
    await withIdempotency(ctx, async (body) => {
      const user = requireClientOwner(ctx.session);
      const card = body.card as { number?: string; expiry?: string; cvc?: string } | undefined;
      if (!card) {
        throw new HttpError(422, 'invalid_card', 'Enter the card details.', { 'card.number': 'Enter a valid card number.' });
      }
      const validCard = validateCard({ number: String(card.number ?? ''), expiry: String(card.expiry ?? ''), cvc: String(card.cvc ?? '') });
      const account = await getAccount(ctx.db, user.accountId!);
      if (!account) throw notFound();
      await ctx.db.query('UPDATE accounts SET card_last4 = $1 WHERE id = $2', [validCard.last4, account.id]);

      const state = await changePlan(ctx, user.accountId!);
      if (state && cardDecision(validCard.last4) === 'approve' && planStatus(state) === 'past_due' && state.openRenewal) {
        // the open renewal is paid at once; retries are dropped
        await ctx.db.query('DELETE FROM dunning_attempts WHERE order_id = $1 AND attempted_at IS NULL', [state.order.id]);
        const ownerEmail = await accountOwnerEmail(ctx, user.accountId!);
        const chargeCtx: ChargeContext = {
          accountId: account.id,
          killbillAccountId: state.killbillAccountId,
          currency: account.currency,
          cardLast4: validCard.last4,
        };
        await chargeInvoice(chargeCtx, state.openRenewal.invoiceId, state.openRenewal.amount, `${state.openRenewal.invoiceId}-renewal`);
        await queueEmail(ctx.db, {
          ...receiptEmail(state.order.number, 'renewal', state.openRenewal.amount, orderReceiptPath(state.order.id)),
          to: ownerEmail,
        });
        const fresh = await readPlan(ctx, user.accountId!);
        return { status: 200, body: { plan: fresh ? planView(fresh) : null } };
      }
      if (cardDecision(validCard.last4) === 'decline') {
        throw declineError();
      }
      const fresh = state ? await readPlan(ctx, user.accountId!) : null;
      return { status: 200, body: { plan: fresh ? planView(fresh) : null } };
    });
  });
}

async function accountOwnerEmail(ctx: { db: import('./db.js').Db }, accountId: string): Promise<string> {
  const result = await ctx.db.query("SELECT email FROM users WHERE account_id = $1 AND role = 'client_owner' LIMIT 1", [accountId]);
  const row = result.rows[0] as { email: string } | undefined;
  return row?.email ?? 'client@pampero.test';
}


async function readPlan(ctx: { db: import('./db.js').Db }, accountId: string) {
  try {
    return await loadPlanState(ctx.db, accountId);
  } catch (err) {
    if (err instanceof BillingUnavailable) throw new HttpError(503, 'billing_unavailable', PLAN_READ_OUTAGE_COPY);
    throw err;
  }
}

async function changePlan(ctx: { db: import('./db.js').Db }, accountId: string) {
  try {
    return await loadPlanState(ctx.db, accountId);
  } catch (err) {
    if (err instanceof BillingUnavailable) throw new HttpError(503, 'billing_unavailable', PLAN_CHANGE_OUTAGE_COPY);
    throw err;
  }
}
