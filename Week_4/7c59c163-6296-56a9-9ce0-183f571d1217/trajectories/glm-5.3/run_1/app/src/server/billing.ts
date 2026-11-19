import type { AppConfig } from './config.js';
import type { Pool, PoolClient } from './db.js';
import { AppError, conflict, notFound, unavailable, validationError } from './errors.js';
import type { KillBillClient } from './killbill.js';
import { overdueToPlanState, planRatePerSecond } from './domain.js';
import { memberAccount, memberBalancesWithClient, postJournalEntry, venueAccount } from './ledger.js';
import { enqueue } from './queue.js';
import type { RateLimiter } from './valkey.js';

export type PlanName = 'sandbox' | 'builder' | 'desk';

export interface MemberRow {
  id: string;
  venue_id: string;
  keycloak_id: string | null;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
  killbill_account_id: string | null;
}

export interface DepositRow {
  id: string;
  venue_id: string;
  member_id: string;
  amount_cents: number;
  refunded_cents: number;
  status: 'succeeded' | 'declined';
  card_last4: string;
  killbill_payment_id: string | null;
  created_at: Date;
}

export interface RefundRow {
  id: string;
  deposit_id: string;
  venue_id: string;
  member_id: string;
  amount_cents: number;
  killbill_transaction_id: string | null;
  created_at: Date;
}

export interface BillingSnapshot {
  plan: PlanName;
  effective_plan: PlanName;
  state: 'active' | 'payment_failed' | 'downgraded';
  overdue_state: string | null;
  rate_per_second: number;
  pending_plan: PlanName | null;
  pending_effective_date: string | null;
  provider: 'ok' | 'unavailable';
  invoices: {
    id: string;
    number: string;
    invoice_date: string;
    amount_cents: number;
    balance_cents: number;
    items: { description: string; amount_cents: number; start_date: string; end_date: string }[];
  }[];
}

export class Billing {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly killbill: KillBillClient,
    private readonly limiter: RateLimiter
  ) {}

  async ensureKillBillAccount(client: PoolClient, member: MemberRow): Promise<string> {
    if (member.killbill_account_id) return member.killbill_account_id;
    const externalKey = `${await this.venueSlug(client, member.venue_id)}:${member.id}`;
    const account = await this.killbill.ensureAccount(externalKey, member.display_name, member.email);
    await client.query(`UPDATE members SET killbill_account_id = $2 WHERE id = $1`, [member.id, account.accountId]);
    return account.accountId;
  }

  private async venueSlug(client: PoolClient, venueId: string): Promise<string> {
    const res = await client.query(`SELECT slug FROM venues WHERE id = $1`, [venueId]);
    return (res.rows[0] as { slug: string }).slug;
  }

  async createDeposit(input: {
    venueId: string;
    memberId: string;
    amountCents: number;
    cardNumber: string;
  }): Promise<DepositRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM members WHERE id = $1 FOR UPDATE`, [input.memberId]);
      const member = (await client.query(`SELECT * FROM members WHERE id = $1`, [input.memberId])).rows[0] as MemberRow;
      const last4 = input.cardNumber.replace(/\D/g, '').slice(-4);
      const accountId = await this.ensureKillBillAccount(client, member);

      const depositId = crypto.randomUUID();
      await client.query(
        `INSERT INTO deposits (id, venue_id, member_id, amount_cents, status, card_last4)
         VALUES ($1,$2,$3,$4,'pending',$5)`,
        [depositId, input.venueId, input.memberId, input.amountCents, last4]
      );

      let paymentId = '';
      try {
        const payment = await this.killbill.createPurchase(
          accountId,
          `deposit-${depositId}`,
          `deposit-${depositId}`,
          (input.amountCents / 100).toFixed(2),
          last4
        );
        paymentId = payment.paymentId;
        const success = payment.transactions.some((t) => t.status === 'SUCCESS' && t.transactionType === 'PURCHASE');
        if (!success) {
          await client.query(`UPDATE deposits SET status = 'declined', killbill_payment_id = $2 WHERE id = $1`, [depositId, paymentId]);
          await client.query('COMMIT');
          throw new AppError(402, { error: 'payment_declined', deposit_id: depositId });
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        await client.query('ROLLBACK');
        throw unavailable('payments_unavailable');
      }

      await client.query(`UPDATE deposits SET status = 'succeeded', killbill_payment_id = $2 WHERE id = $1`, [depositId, paymentId]);
      await postJournalEntry(client, input.venueId, {
        kind: 'deposit',
        referenceId: depositId,
        legs: [
          { account: memberAccount(input.memberId, 'available'), amountCents: input.amountCents },
          { account: venueAccount('card_clearing'), amountCents: -input.amountCents },
        ],
      });
      await enqueue(client, {
        kind: 'email',
        venueId: input.venueId,
        payload: { template: 'deposit_receipt', member_id: input.memberId, deposit_id: depositId },
      });
      await client.query('COMMIT');
      const row = (await this.pool.query(`SELECT * FROM deposits WHERE id = $1`, [depositId])).rows[0] as DepositRow;
      return row;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async refundDeposit(input: {
    venueId: string;
    depositId: string;
    adminId: string;
    amountCents: number;
  }): Promise<RefundRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the member row via the deposit to serialise refunds per member.
      const depositRes = await client.query(
        `SELECT d.* FROM deposits d WHERE d.id = $1 AND d.venue_id = $2 FOR UPDATE`,
        [input.depositId, input.venueId]
      );
      const deposit = depositRes.rows[0] as DepositRow | undefined;
      if (!deposit) {
        await client.query('ROLLBACK');
        throw notFound();
      }
      await client.query(`SELECT id FROM members WHERE id = $1 FOR UPDATE`, [deposit.member_id]);

      if (deposit.status !== 'succeeded') {
        await client.query('ROLLBACK');
        throw conflict('deposit_not_refundable');
      }
      const balances = await memberBalancesWithClient(client, input.venueId, deposit.member_id);
      const refundable = Math.min(deposit.amount_cents - deposit.refunded_cents, balances.available);
      if (input.amountCents > refundable) {
        await client.query('ROLLBACK');
        throw validationError({ amount_cents: 'exceeds_refundable' });
      }

      const refundId = crypto.randomUUID();
      let transactionId = '';
      try {
        const payment = await this.killbill.createRefund(
          deposit.killbill_payment_id ?? '',
          `refund-${refundId}`,
          (input.amountCents / 100).toFixed(2)
        );
        const tx = payment.transactions.find((t) => t.transactionType === 'REFUND');
        transactionId = tx?.transactionId ?? '';
        const success = payment.transactions.some((t) => t.status === 'SUCCESS' && t.transactionType === 'REFUND');
        if (!success) {
          await client.query('ROLLBACK');
          throw unavailable('payments_unavailable');
        }
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof AppError) throw err;
        throw unavailable('payments_unavailable');
      }

      await client.query(`UPDATE deposits SET refunded_cents = refunded_cents + $2 WHERE id = $1`, [input.depositId, input.amountCents]);
      await client.query(
        `INSERT INTO refunds (id, deposit_id, venue_id, member_id, amount_cents, killbill_transaction_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [refundId, input.depositId, input.venueId, deposit.member_id, input.amountCents, transactionId]
      );
      await postJournalEntry(client, input.venueId, {
        kind: 'refund',
        referenceId: refundId,
        legs: [
          { account: memberAccount(deposit.member_id, 'available'), amountCents: -input.amountCents },
          { account: venueAccount('card_clearing'), amountCents: input.amountCents },
        ],
      });
      await enqueue(client, {
        kind: 'email',
        venueId: input.venueId,
        payload: { template: 'refund_issued', member_id: deposit.member_id, refund_id: refundId },
      });
      await client.query('COMMIT');
      const row = (await this.pool.query(`SELECT * FROM refunds WHERE id = $1`, [refundId])).rows[0] as RefundRow;
      void input.adminId;
      return row;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async billingSnapshot(member: MemberRow): Promise<BillingSnapshot> {
    const base = await this.pool.query(`SELECT * FROM builder_billing WHERE member_id = $1`, [member.id]);
    const row = base.rows[0] as { plan: PlanName; state: string; overdue_state: string | null; state_recorded_at: Date | null; final_notice_sent_at: Date | null } | undefined;
    let plan: PlanName = row?.plan ?? 'sandbox';
    let state: 'active' | 'payment_failed' | 'downgraded' = (row?.state as 'active' | 'payment_failed' | 'downgraded') ?? 'active';
    let overdueState: string | null = row?.overdue_state ?? null;
    let provider: 'ok' | 'unavailable' = 'ok';
    let pendingPlan: PlanName | null = null;
    let pendingDate: string | null = null;
    let invoices: BillingSnapshot['invoices'] = [];

    try {
      const accountId = member.killbill_account_id ?? (await this.ensureAccount(member));
      const overdue = await this.killbill.accountOverdueState(accountId);
      const kbState = overdueToPlanState(overdue);
      if (kbState !== state) {
        await this.recordStateChange(member, plan, state, kbState, overdue);
        state = kbState;
      }
      overdueState = overdue;
      const kbInvoices = await this.killbill.invoicesForAccount(accountId);
      invoices = kbInvoices.map((inv) => ({
        id: inv.invoiceId,
        number: String(inv.invoiceNumber),
        invoice_date: inv.invoiceDate,
        amount_cents: Math.round((inv.amount ?? 0) * 100),
        balance_cents: Math.round((inv.balance ?? 0) * 100),
        items: (inv.items ?? []).map((item) => ({
          description: item.description ?? '',
          amount_cents: Math.round(item.amount * 100),
          start_date: item.startDate,
          end_date: item.endDate,
        })),
      }));
      const subs = await this.killbill.subscriptionsForAccount(accountId);
      const sub = subs.find((s) => s.bundleExternalKey === `plan-${member.id}`) ?? null;
      if (sub) {
        const subPlan = planFromKillBillPlan(sub.planName);
        const recorded = await this.pool.query(`SELECT plan FROM builder_billing WHERE member_id = $1`, [member.id]);
        const recordedPlan = (recorded.rows[0] as { plan?: PlanName } | undefined)?.plan ?? null;
        // A downgrade takes effect at end of term: Kill Bill keeps the old plan
        // active with the change scheduled, so the difference is the pending plan.
        if (subPlan && recordedPlan && subPlan !== recordedPlan) {
          pendingPlan = subPlan;
          pendingDate = sub.chargedThroughDate ?? null;
        } else if (subPlan) {
          plan = subPlan;
        }
      }
    } catch (err) {
      if (err instanceof AppError && err.body['error'] === 'billing_unavailable') {
        provider = 'unavailable';
      } else {
        throw err;
      }
    }

    const effective: PlanName = state === 'downgraded' ? 'sandbox' : plan;
    return {
      plan,
      effective_plan: effective,
      state,
      overdue_state: overdueState,
      rate_per_second: planRatePerSecond(effective),
      pending_plan: pendingPlan,
      pending_effective_date: pendingDate,
      provider,
      invoices,
    };
  }

  private async ensureAccount(member: MemberRow): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const id = await this.ensureKillBillAccount(client, member);
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async recordStateChange(member: MemberRow, plan: PlanName, fromState: string, toState: 'active' | 'payment_failed' | 'downgraded', overdue: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO builder_billing (member_id, plan, state, overdue_state, state_recorded_at, updated_at)
         VALUES ($1,$2,$3,$4,now(),now())
         ON CONFLICT (member_id) DO UPDATE SET plan = $2, state = $3, overdue_state = $4, state_recorded_at = now(), updated_at = now()`,
        [member.id, plan, toState, overdue]
      );
      if (toState !== fromState) {
        await enqueue(client, {
          kind: 'email',
          venueId: member.venue_id,
          payload: { template: `plan_${toState}`, member_id: member.id },
        });
        if (toState === 'downgraded') {
          await this.setKeyRates(client, member.id, planRatePerSecond('sandbox'));
        } else if (toState === 'active') {
          await this.setKeyRates(client, member.id, planRatePerSecond(plan));
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async setKeyRates(client: PoolClient, memberId: string, rate: number): Promise<void> {
    const res = await client.query(`SELECT id FROM api_keys WHERE member_id = $1 AND revoked_at IS NULL`, [memberId]);
    for (const row of res.rows as { id: string }[]) {
      await this.limiter.setRate(row.id, rate).catch(() => undefined);
    }
  }

  async changePlan(member: MemberRow, plan: PlanName): Promise<BillingSnapshot> {
    const current = await this.billingSnapshot(member);
    if (current.state !== 'active') {
      if (current.plan === plan) throw conflict('already_on_plan');
      throw conflict('plan_locked');
    }
    if (current.plan === plan) throw conflict('already_on_plan');
    const accountId = await this.ensureAccount(member);
    const subs = await this.killbill.subscriptionsForAccount(accountId);
    const sub = subs.find((s) => s.bundleExternalKey === `plan-${member.id}`) ?? null;
    const targetPlan = `${plan === 'sandbox' ? 'sandbox' : plan}-monthly`;

    if (!sub) {
      await this.killbill.createSubscription(accountId, `plan-${member.id}`, targetPlan);
    } else {
      const currentPlan = planFromKillBillPlan(sub.planName) ?? 'sandbox';
      const upgrade = planOrder(plan) > planOrder(currentPlan);
      if (upgrade) {
        await this.killbill.changePlan(sub.subscriptionId, targetPlan);
      } else {
        const chargedThrough = sub.chargedThroughDate ?? nextMonthDate();
        await this.killbill.changePlan(sub.subscriptionId, targetPlan, chargedThrough);
      }
    }
    await this.pool.query(
      `INSERT INTO builder_billing (member_id, plan, state, updated_at) VALUES ($1,$2,'active',now())
       ON CONFLICT (member_id) DO UPDATE SET plan = $2, updated_at = now()`,
      [member.id, plan]
    );
    await this.setKeyRatesOnPool(member.id, planRatePerSecond(plan));
    return this.billingSnapshot(member);
  }

  private async setKeyRatesOnPool(memberId: string, rate: number): Promise<void> {
    const res = await this.pool.query(`SELECT id FROM api_keys WHERE member_id = $1 AND revoked_at IS NULL`, [memberId]);
    for (const row of res.rows as { id: string }[]) {
      await this.limiter.setRate(row.id, rate);
    }
  }

  async payOutstanding(member: MemberRow): Promise<BillingSnapshot> {
    const accountId = await this.ensureAccount(member);
    const unpaid = await this.killbill.unpaidInvoices(accountId);
    if (unpaid.length === 0) throw conflict('nothing_due');
    for (const invoice of unpaid) {
      await this.killbill.payInvoice(accountId, invoice.invoiceId, `pay-${invoice.invoiceId}-${Date.now()}`);
    }
    return this.billingSnapshot(member);
  }

  async pollOverdue(): Promise<void> {
    const res = await this.pool.query(
      `SELECT m.* FROM members m JOIN builder_billing b ON b.member_id = m.id WHERE 'builder' = ANY(m.roles)`
    );
    for (const member of res.rows as MemberRow[]) {
      try {
        const snapshot = await this.billingSnapshot(member);
        await this.maybeSendFinalNotice(member, snapshot);
      } catch {
        // provider down; keep last recorded state
      }
    }
  }

  private async maybeSendFinalNotice(member: MemberRow, snapshot: BillingSnapshot): Promise<void> {
    if (snapshot.state !== 'payment_failed') return;
    const res = await this.pool.query(
      `SELECT state_recorded_at, final_notice_sent_at FROM builder_billing WHERE member_id = $1`,
      [member.id]
    );
    const row = res.rows[0] as { state_recorded_at: Date | null; final_notice_sent_at: Date | null } | undefined;
    if (!row?.state_recorded_at || row.final_notice_sent_at) return;
    const elapsed = Date.now() - row.state_recorded_at.getTime();
    if (elapsed >= this.config.dunningFinalNoticeSeconds * 1000) {
      await this.pool.query(`UPDATE builder_billing SET final_notice_sent_at = now() WHERE member_id = $1`, [member.id]);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await enqueue(client, {
          kind: 'email',
          venueId: member.venue_id,
          payload: { template: 'plan_final_notice', member_id: member.id },
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }
  }
}

export function planFromKillBillPlan(planName: string): PlanName | null {
  if (planName.startsWith('sandbox')) return 'sandbox';
  if (planName.startsWith('builder')) return 'builder';
  if (planName.startsWith('desk')) return 'desk';
  return null;
}

export function planOrder(plan: PlanName): number {
  switch (plan) {
    case 'sandbox': return 0;
    case 'builder': return 1;
    case 'desk': return 2;
  }
}

function nextMonthDate(): string {
  const now = new Date();
  const next = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return next.toISOString().slice(0, 10);
}
