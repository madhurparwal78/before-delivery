import type { CreditPackPurchase, CreditsResponse, PlanResponse, PlanSummary } from '../../shared/api.js';
import { isUniqueViolation, LOCK_NAMESPACE, lockKey, query, transaction } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { creditBalances } from '../domain/ledger.js';
import { CREDIT_PACK, isPlanCode, type PlanCode } from '../../shared/plans.js';
import { canMovePlan, type PlanState } from '../domain/states.js';
import {
  cancelSubscription,
  chargeAndPay,
  createSubscription,
  ensureAccount,
  KillBillUnavailable,
} from '../providers/killbill.js';
import type { Principal } from '../auth/identity.js';
import { reconcileCreditPack, reconcilePlan } from './billing.js';

interface PlanRow {
  id: string;
  code: PlanCode;
  state: PlanState;
  ends_on: Date | null;
  killbill_subscription_id: string | null;
}

function toPlanSummary(row: PlanRow): PlanSummary {
  return {
    code: row.code,
    state: row.state,
    ends_on: row.ends_on ? row.ends_on.toISOString().slice(0, 10) : null,
  };
}

async function loadLivePlan(userId: string): Promise<PlanRow | null> {
  const result = await query<PlanRow>(
    `SELECT id, code, state, ends_on, killbill_subscription_id
     FROM creator_plans WHERE user_id = $1
     ORDER BY CASE WHEN state IN ('pending_payment','active','cancelling') THEN 0 ELSE 1 END,
              created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function getPlan(creator: Principal): Promise<PlanResponse> {
  const row = await loadLivePlan(creator.id);
  return { plan: row ? toPlanSummary(row) : null };
}

async function killbillAccountFor(creator: Principal): Promise<string> {
  const accountId = await ensureAccount({
    id: creator.id,
    displayName: creator.displayName,
    email: creator.email,
  });
  await query(
    `INSERT INTO killbill_accounts (user_id, account_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET account_id = EXCLUDED.account_id`,
    [creator.id, accountId],
  );
  return accountId;
}

/** Subscribes the creator and leaves the plan awaiting Kill Bill's confirmation. */
export async function choosePlan(creator: Principal, body: unknown): Promise<PlanResponse> {
  const code = (body as { plan?: unknown } | null)?.plan;
  if (!isPlanCode(code)) {
    throw ApiError.validation({ plan: 'Choose the Studio or Pro plan.' });
  }

  const existing = await loadLivePlan(creator.id);
  if (existing && existing.state !== 'ended') {
    throw new ApiError(409, 'plan_exists', 'You already have a plan.');
  }

  const planId = await transaction(async (client) => {
    await lockKey(client, LOCK_NAMESPACE.plan, creator.id);
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO creator_plans (user_id, code, state) VALUES ($1, $2, 'pending_payment')
         RETURNING id`,
        [creator.id, code],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Plan insert returned no id');
      return id;
    } catch (error) {
      if (isUniqueViolation(error, 'creator_plans_live_idx')) {
        throw new ApiError(409, 'plan_exists', 'You already have a plan.');
      }
      throw error;
    }
  });

  try {
    const accountId = await killbillAccountFor(creator);
    const subscriptionId = await createSubscription(accountId, code);
    await query(
      'UPDATE creator_plans SET killbill_account_id = $2, killbill_subscription_id = $3 WHERE id = $1',
      [planId, accountId, subscriptionId],
    );
  } catch (error) {
    await query('DELETE FROM creator_plans WHERE id = $1', [planId]);
    if (error instanceof KillBillUnavailable) throw ApiError.paymentsUnavailable();
    throw error;
  }

  void reconcilePlan(planId);

  const row = await loadLivePlan(creator.id);
  return { plan: row ? toPlanSummary(row) : null };
}

/** Cancelling uses end of term; `ends_on` is the date Kill Bill reports. */
export async function cancelPlan(creator: Principal): Promise<PlanResponse> {
  const plan = await loadLivePlan(creator.id);
  if (!plan || plan.state === 'ended') {
    throw ApiError.invalidTransition('You have no plan to cancel.');
  }
  if (plan.state === 'pending_payment') {
    throw new ApiError(
      409,
      'plan_not_confirmed',
      'Your plan can be cancelled once Kill Bill confirms it.',
    );
  }
  if (!canMovePlan(plan.state, 'cancelling') || !plan.killbill_subscription_id) {
    throw ApiError.invalidTransition('That plan cannot be cancelled.');
  }

  let endsOn: string;
  try {
    const dates = await cancelSubscription(plan.killbill_subscription_id);
    const reported = dates.billingEndDate ?? dates.chargedThroughDate;
    if (!reported) throw new KillBillUnavailable('Kill Bill reported no billing end date');
    endsOn = reported.slice(0, 10);
  } catch (error) {
    if (error instanceof KillBillUnavailable) throw ApiError.paymentsUnavailable();
    throw error;
  }

  await query("UPDATE creator_plans SET state = 'cancelling', ends_on = $2 WHERE id = $1", [
    plan.id,
    endsOn,
  ]);

  const row = await loadLivePlan(creator.id);
  return { plan: row ? toPlanSummary(row) : null };
}

/** A cancelling plan has ended once its end date has passed. */
export async function endDuePlans(): Promise<void> {
  await query(
    "UPDATE creator_plans SET state = 'ended' WHERE state = 'cancelling' AND ends_on <= (now() AT TIME ZONE 'UTC')::date",
  );
}

export async function getCredits(creator: Principal): Promise<CreditsResponse> {
  const balances = await transaction((client) => creditBalances(client, creator.id));
  const entries = await query<{
    id: string;
    kind: CreditsResponse['entries'][number]['kind'];
    render_id: string | null;
    created_at: Date;
    rows: { account: string; amount: number }[];
  }>(
    `SELECT e.id, e.kind, e.render_id, e.created_at,
            COALESCE(json_agg(json_build_object('account', r.account, 'amount', r.amount)
                              ORDER BY r.id), '[]'::json) AS rows
     FROM credit_entries e
     JOIN credit_rows r ON r.entry_id = e.id
     WHERE e.user_id = $1
     GROUP BY e.id, e.kind, e.render_id, e.created_at
     ORDER BY e.created_at DESC, e.id`,
    [creator.id],
  );

  return {
    available: balances.available,
    held: balances.held,
    entries: entries.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      render_id: row.render_id,
      created_at: row.created_at.toISOString(),
      rows: row.rows,
    })),
  };
}

/** Buys a credit pack. The credits land only when Kill Bill confirms the payment. */
export async function buyCreditPack(creator: Principal, body: unknown): Promise<CreditPackPurchase> {
  const pack = (body as { pack?: unknown } | null)?.pack;
  if (pack !== CREDIT_PACK.code) {
    throw ApiError.validation({ pack: 'Choose the 500 credit pack.' });
  }

  const purchaseId = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO credit_pack_purchases (user_id, pack, state, credits, price_cents)
       VALUES ($1, $2, 'paying', $3, $4)
       RETURNING id`,
      [creator.id, CREDIT_PACK.code, CREDIT_PACK.credits, CREDIT_PACK.priceCents],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('Credit pack insert returned no id');
    return id;
  });

  try {
    const accountId = await killbillAccountFor(creator);
    const charge = await chargeAndPay(accountId, CREDIT_PACK.priceCents, CREDIT_PACK.description);
    await query(
      'UPDATE credit_pack_purchases SET killbill_invoice_id = $2, killbill_payment_id = $3 WHERE id = $1',
      [purchaseId, charge.invoiceId, charge.paymentId],
    );
  } catch (error) {
    await query('DELETE FROM credit_pack_purchases WHERE id = $1', [purchaseId]);
    if (error instanceof KillBillUnavailable) throw ApiError.paymentsUnavailable();
    throw error;
  }

  void reconcileCreditPack(purchaseId);

  return {
    id: purchaseId,
    state: 'paying',
    credits: CREDIT_PACK.credits,
    price_cents: CREDIT_PACK.priceCents,
  };
}

export async function getCreditPack(
  creator: Principal,
  purchaseId: string,
): Promise<CreditPackPurchase> {
  if (!/^[0-9a-f-]{36}$/.test(purchaseId)) throw ApiError.notFound();
  const result = await query<{
    id: string;
    user_id: string;
    state: CreditPackPurchase['state'];
    credits: number;
    price_cents: number;
  }>('SELECT id, user_id, state, credits, price_cents FROM credit_pack_purchases WHERE id = $1', [
    purchaseId,
  ]);
  const row = result.rows[0];
  if (!row || row.user_id !== creator.id) throw ApiError.notFound();
  return { id: row.id, state: row.state, credits: row.credits, price_cents: row.price_cents };
}
