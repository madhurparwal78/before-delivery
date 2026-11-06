import { config } from '../config.js';
import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { PLANS, PLAN_IDS, type PlanId } from '../../shared/domain.js';
import type { BillingObject, ServerStatus } from '../../shared/types.js';
import { instant, money, zoneDate, zoneLabel } from '../util.js';
import * as kb from '../services/killbill.js';
import { link, queueMail, attemptMail } from '../services/mail.js';
import { appendEvent } from './events.js';
import {
  type ServerRow,
  STATUS_WORDS,
  loadServerById,
  serverObject,
  suspendsAtLabel,
} from './servers.js';
import { cascadeSuspension, finishCascade, resumeRuns } from './suspension.js';

/** The billing status machine, in one place. Kill Bill alone decides it. */

export const PAYMENT_TIMEOUT_MS = 5000;
const PLAN_INVOICE_WAIT_MS = 10000;

const planOfRecurring = (invoice: kb.KbInvoice): PlanId | null => {
  for (const item of invoice.items) {
    if (item.itemType !== 'RECURRING') continue;
    for (const planId of PLAN_IDS) {
      if (item.planName === PLANS[planId].killbillPlan) return planId;
    }
  }
  return null;
};

const carriesPlan = (invoice: kb.KbInvoice, plan: PlanId): boolean =>
  planOfRecurring(invoice) === plan;

interface Decision {
  readonly status: ServerStatus;
  readonly plan: PlanId;
  readonly pendingPlan: PlanId | null;
  readonly pastDueSince: Date | null;
  readonly suspendsAt: Date | null;
  readonly balance: number;
}

/**
 * The published status table, decided only from what Kill Bill shows and the
 * server's own clock.
 */
export function decide(server: ServerRow, state: kb.KbAccountState, now: Date): Decision {
  const graceMs = config().billingGraceSeconds * 1000;
  let plan = server.plan;
  let pendingPlan = server.pending_plan;

  const awaited = pendingPlan;
  if (awaited !== null) {
    /* The change is confirmed once Kill Bill shows an invoice carrying the new
       plan's charge and a balance of zero or less. The invoice's own balance is
       read too, so that an invoice still being assembled never counts. */
    const planInvoice = state.invoices.find((invoice) => carriesPlan(invoice, awaited));
    if (planInvoice !== undefined && planInvoice.balance <= 0 && state.balance <= 0) {
      plan = awaited;
      pendingPlan = null;
    }
  }

  const pending = pendingPlan;
  const unpaid = state.invoices.filter(
    (invoice) =>
      invoice.balance > 0 && !(pending !== null && carriesPlan(invoice, pending)),
  );

  let status = server.status;
  let pastDueSince = server.past_due_since;
  let suspendsAt = server.suspends_at;

  if (status === 'pending_approval') {
    const planInvoiced = state.invoices.some((invoice) => planOfRecurring(invoice) !== null);
    if (planInvoiced && state.balance <= 0) {
      status = 'active';
      pastDueSince = null;
      suspendsAt = null;
    }
  } else if (status === 'active') {
    if (unpaid.length > 0) {
      status = 'past_due';
      pastDueSince = server.past_due_since ?? now;
      suspendsAt = new Date(pastDueSince.getTime() + graceMs);
    }
  } else if (status === 'past_due') {
    if (state.balance <= 0) {
      status = 'active';
      pastDueSince = null;
      suspendsAt = null;
    } else if (suspendsAt !== null && now.getTime() >= suspendsAt.getTime()) {
      status = 'suspended';
    }
  } else if (status === 'suspended') {
    if (state.balance <= 0) {
      status = 'active';
      pastDueSince = null;
      suspendsAt = null;
    }
  }

  return { status, plan, pendingPlan, pastDueSince, suspendsAt, balance: state.balance };
}

/** past_due becomes suspended on the server's clock alone, with no provider read. */
export function decideByClock(server: ServerRow, now: Date): ServerStatus {
  if (
    server.status === 'past_due' &&
    server.suspends_at !== null &&
    now.getTime() >= server.suspends_at.getTime()
  ) {
    return 'suspended';
  }
  return server.status;
}

async function persist(server: ServerRow, decision: Decision): Promise<ServerRow> {
  const changed =
    decision.status !== server.status ||
    decision.plan !== server.plan ||
    decision.pendingPlan !== server.pending_plan ||
    money(decision.balance) !== money(server.balance) ||
    String(decision.suspendsAt?.getTime() ?? '') !== String(server.suspends_at?.getTime() ?? '');

  const suspending = decision.status === 'suspended' && server.status !== 'suspended';
  const reactivating = decision.status === 'active' && server.status === 'suspended';

  const applied = await tx(async (client) => {
    const locked = await client.query<ServerRow>('SELECT * FROM servers WHERE id = $1 FOR UPDATE', [
      server.id,
    ]);
    const current = locked.rows[0];
    if (current === undefined) return { server, cascade: null };

    const rows = await client.query<ServerRow>(
      `UPDATE servers
          SET status = $2, plan = $3, pending_plan = $4, past_due_since = $5,
              suspends_at = $6, balance = $7, provider_reachable = true, checked_at = now(),
              revision = revision + $8
        WHERE id = $1 RETURNING *`,
      [
        server.id,
        decision.status,
        decision.plan,
        decision.pendingPlan,
        decision.pastDueSince,
        decision.suspendsAt,
        money(decision.balance),
        changed ? 1 : 0,
      ],
    );
    const next = rows.rows[0] ?? server;

    const cascade =
      suspending && current.status !== 'suspended'
        ? await cascadeSuspension(client, server.id)
        : null;
    if (reactivating) await resumeRuns(client, server.id);
    return { server: next, cascade };
  });

  if (applied.cascade !== null) await finishCascade(applied.cascade);
  if (changed) await publishServer(applied.server);
  return applied.server;
}

export async function publishServer(server: ServerRow): Promise<void> {
  const object = await serverObject(server, server.owner_id);
  await appendEvent({
    serverId: server.id,
    stream: 'server',
    scopeId: server.id,
    kind: 'server',
    payload: object,
  });
}

async function markUnreachable(server: ServerRow): Promise<ServerRow> {
  const byClock = decideByClock(server, new Date());
  if (byClock === server.status) {
    const rows = await query<ServerRow>(
      'UPDATE servers SET provider_reachable = false, checked_at = now() WHERE id = $1 RETURNING *',
      [server.id],
    );
    return rows[0] ?? server;
  }
  const applied = await tx(async (client) => {
    const rows = await client.query<ServerRow>(
      `UPDATE servers SET status = $2, provider_reachable = false, checked_at = now(),
              revision = revision + 1
        WHERE id = $1 RETURNING *`,
      [server.id, byClock],
    );
    const cascade = await cascadeSuspension(client, server.id);
    return { server: rows.rows[0] ?? server, cascade };
  });
  await finishCascade(applied.cascade);
  await publishServer(applied.server);
  return applied.server;
}

/**
 * Re-reads Kill Bill and applies the status machine. With Kill Bill
 * unreachable, the last confirmed state stands and only the clock is applied.
 */
export async function refresh(server: ServerRow): Promise<ServerRow> {
  if (server.kb_account_id === null) return server;
  let state: kb.KbAccountState;
  try {
    state = await kb.accountState(server.kb_account_id);
  } catch {
    return markUnreachable(server);
  }
  const updated = await persist(server, decide(server, state, new Date()));
  await noticeMail(updated, state);
  return updated;
}

/** The overdue warning and each payment receipt, each sent exactly once. */
async function noticeMail(server: ServerRow, state: kb.KbAccountState): Promise<void> {
  const owner = await one<{ handle: string; email: string }>(
    'SELECT handle, email FROM users WHERE id = $1',
    [server.owner_id],
  );
  if (owner === null) return;

  if (server.status === 'past_due' || server.status === 'suspended') {
    const label = suspendsAtLabel(server) ?? '';
    for (const invoice of state.invoices) {
      if (invoice.balance <= 0) continue;
      if (server.pending_plan !== null && carriesPlan(invoice, server.pending_plan)) continue;
      await send({
        serverId: server.id,
        kind: 'overdue_warning',
        toHandle: owner.handle,
        toEmail: owner.email,
        subject: `Invoice overdue for ${server.name}`,
        lines: [
          `An invoice for ${server.name} is overdue. The server will be suspended at ${label} unless the payment is approved.`,
          `Billing: ${link(`/s/${server.slug}/billing`)}`,
        ],
        dedupeKey: `overdue:${server.id}:${invoice.invoiceId}`,
      });
    }
  }

  for (const payment of state.payments) {
    if (!kb.paymentSucceeded(payment)) continue;
    await send({
      serverId: server.id,
      kind: 'payment_receipt',
      toHandle: owner.handle,
      toEmail: owner.email,
      subject: `Payment confirmed for ${server.name}`,
      lines: [
        `The billing provider confirmed a payment of ${money(payment.purchasedAmount)} USD for ${server.name}. Plan: ${PLANS[server.plan].name}.`,
      ],
      dedupeKey: `receipt:${server.id}:${payment.paymentId}`,
    });
  }
}

async function send(draft: Parameters<typeof queueMail>[0]): Promise<void> {
  const id = await queueMail(draft);
  if (id !== null) await attemptMail(id);
}

export async function paymentPendingFor(serverId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `SELECT id FROM pending_payments WHERE server_id = $1 AND kind = 'server' AND state = 'pending' LIMIT 1`,
    [serverId],
  );
  return row !== null;
}

export async function billingObject(server: ServerRow): Promise<BillingObject> {
  const pending = await paymentPendingFor(server.id);
  return {
    server_id: server.id,
    status: server.status,
    status_word: pending ? 'PAYMENT PENDING' : STATUS_WORDS[server.status],
    plan: server.plan,
    pending_plan: server.pending_plan,
    payment_pending: pending,
    balance: money(server.balance),
    currency: 'USD',
    past_due_since: server.past_due_since === null ? null : instant(server.past_due_since),
    suspends_at: server.suspends_at === null ? null : instant(server.suspends_at),
    suspends_at_label: suspendsAtLabel(server),
    killbill_account_id: server.kb_account_id,
    provider_reachable: server.provider_reachable,
    checked_at: server.checked_at === null ? null : instant(server.checked_at),
  };
}

export type ApproveOutcome =
  | { readonly kind: 'confirmed'; readonly server: ServerRow }
  | { readonly kind: 'pending'; readonly server: ServerRow };

/**
 * Approve payment: wait for the plan invoice when it is still coming, then ask
 * Kill Bill for an external payment of every unpaid invoice's full balance.
 */
export async function approve(server: ServerRow): Promise<ApproveOutcome> {
  if (server.kb_account_id === null) throw fail('billing_unavailable');
  const accountId = server.kb_account_id;

  if (await paymentPendingFor(server.id)) throw fail('payment_pending');

  let state = await kb.accountState(accountId);
  if (server.status === 'pending_approval') {
    const deadline = Date.now() + PLAN_INVOICE_WAIT_MS;
    while (
      !state.invoices.some((invoice) => planOfRecurring(invoice) !== null) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await kb.accountState(accountId);
    }
  }

  const unpaid = state.invoices.filter((invoice) => invoice.balance > 0);
  if (unpaid.length === 0 && state.balance <= 0) throw fail('nothing_due');

  let slow = false;
  for (const invoice of unpaid) {
    const externalKey = `pw-pay-${invoice.invoiceId}`;
    const already = await kb.paymentByExternalKey(externalKey);
    if (already !== null) continue;

    const claimed = await claimPendingPayment(
      server.id,
      'server',
      externalKey,
      accountId,
      invoice.balance,
      null,
    );
    if (!claimed) {
      slow = true;
      continue;
    }
    try {
      await kb.payInvoice(
        accountId,
        invoice.invoiceId,
        invoice.balance,
        externalKey,
        PAYMENT_TIMEOUT_MS,
      );
      await query(`UPDATE pending_payments SET state = 'done' WHERE external_key = $1`, [
        externalKey,
      ]);
    } catch {
      slow = true;
    }
  }

  if (slow) {
    const refreshed = (await loadServerById(server.id)) ?? server;
    return { kind: 'pending', server: refreshed };
  }

  const updated = await refresh((await loadServerById(server.id)) ?? server);
  return { kind: 'confirmed', server: updated };
}

/** Records a payment attempt so that one key is only ever used once. */
export async function claimPendingPayment(
  serverId: string,
  kind: 'server' | 'coins',
  externalKey: string,
  accountId: string,
  amount: number,
  purchaseId: string | null,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO pending_payments (id, server_id, kind, purchase_id, invoice_id, kb_account_id,
                                   external_key, amount, state)
     VALUES (gen_random_uuid()::text, $1, $2, $3, NULL, $4, $5, $6, 'pending')
     ON CONFLICT (external_key) DO NOTHING
     RETURNING id`,
    [serverId, kind, purchaseId, accountId, externalKey, money(amount)],
  );
  return rows.length > 0;
}

/** A plan change is allowed only while the server is active and none is pending. */
export async function requestPlanChange(server: ServerRow, plan: PlanId): Promise<ServerRow> {
  if (server.status !== 'active') throw fail('server_not_active');
  if (server.pending_plan !== null) throw fail('plan_change_pending');
  if (server.plan === plan) throw fail('same_plan');
  if (server.kb_account_id === null) throw fail('billing_unavailable');

  const subscription = await kb.findSubscription(`plotwright-${server.id}-plan`);
  if (subscription === null) throw fail('billing_unavailable');
  await kb.changePlan(subscription.subscriptionId, plan);

  const rows = await query<ServerRow>(
    'UPDATE servers SET pending_plan = $2, revision = revision + 1 WHERE id = $1 RETURNING *',
    [server.id, plan],
  );
  const updated = rows[0] ?? server;
  await publishServer(updated);

  /* Kill Bill invoices the prorated difference on its own bus, so the new
     plan's invoice is waited for before the status machine reads the account. */
  const accountId = server.kb_account_id;
  const deadline = Date.now() + PLAN_INVOICE_WAIT_MS;
  while (Date.now() < deadline) {
    const state = await kb.accountState(accountId);
    if (state.invoices.some((invoice) => carriesPlan(invoice, plan) && invoice.balance > 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return refresh(updated);
}

/* The billing statement. */

interface StatementRow {
  readonly date: string;
  readonly kind: 'plan_change' | 'invoice' | 'credit' | 'payment';
  readonly plan: string;
  readonly amount: string;
  readonly kbId: string;
}

const csvField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.split('"').join('""')}"` : value;

/** CSV following RFC 4180, byte-identical when nothing has changed. */
export async function statementCsv(server: ServerRow): Promise<string> {
  if (server.kb_account_id === null) throw fail('billing_unavailable');
  const state = await kb.accountState(server.kb_account_id);
  const subscription = await kb.findSubscription(`plotwright-${server.id}-plan`);

  const changeEvents = (subscription?.events ?? []).filter(
    (event) => event.eventType === 'CHANGE' && event.plan !== null,
  );
  const changeFor = (plan: PlanId): { id: string; date: string } | null => {
    const event = changeEvents.find((entry) => entry.plan === PLANS[plan].killbillPlan);
    return event === undefined ? null : { id: event.eventId, date: event.effectiveDate };
  };

  const seenPlans = new Set<PlanId>();
  const rows: StatementRow[] = [];
  let lastPlan: PlanId = 'hamlet';

  for (const invoice of state.invoices) {
    const invoicePlan = planOfRecurring(invoice);
    if (invoicePlan !== null) lastPlan = invoicePlan;
    const planName = PLANS[invoicePlan ?? lastPlan].name;

    if (invoicePlan !== null && !seenPlans.has(invoicePlan)) {
      seenPlans.add(invoicePlan);
      const change = changeFor(invoicePlan);
      if (change !== null) {
        rows.push({
          date: change.date.slice(0, 10),
          kind: 'plan_change',
          plan: planName,
          amount: '0.00',
          kbId: change.id,
        });
      }
    }

    rows.push({
      date: invoice.invoiceDate,
      kind: 'invoice',
      plan: planName,
      amount: money(invoice.amount),
      kbId: invoice.invoiceId,
    });

    for (const item of invoice.items) {
      const addsCredit =
        (item.itemType === 'CBA_ADJ' || item.itemType === 'CREDIT_ADJ') && item.amount < 0;
      if (!addsCredit) continue;
      rows.push({
        date: invoice.invoiceDate,
        kind: 'credit',
        plan: planName,
        amount: money(-Math.abs(item.amount)),
        kbId: item.invoiceItemId,
      });
    }

    /* Kill Bill does not name the target invoice on an account's payments, so
       each payment is matched by the external key it was made with. */
    const payments = state.payments
      .filter((payment) => payment.paymentExternalKey === `pw-pay-${invoice.invoiceId}`)
      .flatMap((payment) =>
        payment.transactions
          .filter(
            (transaction) =>
              transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
          )
          .map((transaction) => ({ payment, transaction })),
      )
      .sort((a, b) => a.transaction.effectiveDate.localeCompare(b.transaction.effectiveDate));

    for (const entry of payments) {
      rows.push({
        date: zoneDate(entry.transaction.effectiveDate, server.time_zone),
        kind: 'payment',
        plan: planName,
        amount: money(-Math.abs(entry.transaction.amount)),
        kbId: entry.payment.paymentId,
      });
    }
  }

  let running = 0;
  const lines = ['date,kind,plan,amount,balance_after,kb_id'];
  for (const row of rows) {
    running = Math.round((running + Number(row.amount)) * 100) / 100;
    lines.push(
      [row.date, row.kind, row.plan, row.amount, money(running), row.kbId]
        .map(csvField)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export const statementFilename = (slug: string): string => `${slug}-statement.csv`;

