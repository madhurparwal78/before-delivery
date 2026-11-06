import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { afterCommit, one, query, rows, tx, type Client } from "../db.js";
import { storeDocuments } from "../documents.js";
import { changeApplied, dunningMail, refundApplied, renewalPaid } from "../emails.js";
import { ApiError } from "../http.js";
import {
  accountInvoices,
  blockAccount,
  blockSubscription,
  cancelAtEndOfTerm,
  cancelNow,
  changePlan,
  completeBoxInvoice,
  invoice,
  KillBillError,
  payInvoice,
  payment,
  planByName,
  type InvoiceJson,
} from "../killbill.js";
import { approves } from "./card.js";
import { DUNNING_STEPS, HOLD_DAY, CANCEL_DAY, stepInstant, type DunningRow } from "./dunning.js";
import { insertOrder, loadOrders, paymentKey, type FullOrder, type RefundRow } from "./orders.js";
import { buildQuote, loadPricing, type Quote } from "./quote.js";
import { ledgerEvent, stockChanged } from "./stock.js";
import {
  addMonths,
  cycleMonths,
  derive,
  subscriptionRow,
  type ChangeRow,
  type Derived,
  type SubscriptionRow,
} from "./subscriptions.js";

export const cardDeclined = (): ApiError => new ApiError(402, "card_declined", "Your card was declined. No money was taken.");

const manageUrl = (subscriptionId: string): string => `/account/subscriptions/${subscriptionId}`;

/** The box's charges beyond the plan's recurring price: deposit, shipping and each tax line. */
export function boxCharges(q: Quote): { description: string; cents: number }[] {
  return [
    { description: "Can deposit", cents: q.depositCents },
    { description: "Shipping", cents: q.shippingCents },
    ...q.taxes.map((t) => ({ description: t.name, cents: t.cents })),
  ];
}

/** A subscription's box quoted for its shipping address with the plan's goods. */
async function boxQuote(sub: SubscriptionRow, planName: string): Promise<Quote> {
  const plan = planByName(planName);
  if (!plan) throw new Error(`unknown plan ${planName}`);
  return buildQuote(await loadPricing(), sub.province, true, plan.box);
}

/** Waits for Kill Bill to raise the draft invoice carrying a new subscription's first period. */
export async function firstInvoice(accountId: string, subscriptionId: string): Promise<InvoiceJson> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const listed of await accountInvoices(accountId)) {
      if (listed.status === "VOID") continue;
      const full = await invoice(listed.invoiceId);
      if (full.items.some((i) => i.itemType === "RECURRING" && i.subscriptionId === subscriptionId)) return full;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new KillBillError(504, "no first invoice");
}

/** Sells a paid order's cans: the ledger records them as sold from on-hand stock. */
export async function sellOrder(client: Client, full: FullOrder): Promise<void> {
  for (const line of full.lines) await ledgerEvent(client, line.flavour, "sold", line.quantity, `order:${full.order.number}`);
  afterCommit(client, () => stockChanged(full.lines.map((l) => l.flavour)));
}

async function fullOrder(number: string): Promise<FullOrder> {
  const [full] = await loadOrders([number]);
  return full;
}

// ---- renewals -----------------------------------------------------------------------------

/** Finishes a renewal Kill Bill has been paid for: PDFs first, then the order becomes paid. */
export async function completeRenewal(number: string): Promise<void> {
  const full = await fullOrder(number);
  if (full.order.status !== "pending_payment" || !full.order.kb_payment_id) return;
  await storeDocuments(full);
  await tx(async (client) => {
    const [locked] = await rows<{ status: string }>(client, "SELECT status FROM orders WHERE number = $1 FOR UPDATE", [number]);
    if (locked.status !== "pending_payment") return;
    await rows(client, "UPDATE orders SET status = 'paid', paid_at = now(), documents_stored = true WHERE number = $1", [number]);
    await sellOrder(client, full);
    await renewalPaid(client, { ...full, order: { ...full.order, status: "paid" } });
  });
}

async function renewalOrder(sub: SubscriptionRow, invoiceId: string, q: Quote): Promise<string> {
  const existing = await one<{ number: string }>("SELECT number FROM orders WHERE renewal_invoice_id = $1", [invoiceId]);
  if (existing) return existing.number;
  return tx((client) =>
    insertOrder(client, {
      userId: sub.user_id,
      email: sub.email,
      customerName: sub.customer_name,
      kind: "renewal",
      subscriptionId: sub.id,
      quote: q,
      shipTo: sub.ship_to,
      renewalInvoiceId: invoiceId,
    }),
  );
}

/** Pays an open renewal invoice once with the order's payment key, then completes the order. */
async function payRenewal(sub: SubscriptionRow, invoiceId: string, number: string): Promise<void> {
  const full = await fullOrder(number);
  const paymentId = await payInvoice(
    sub.account_id,
    invoiceId,
    sub.payment_method_id,
    full.order.total_cents,
    paymentKey(config.database, number),
  );
  await query("UPDATE orders SET kb_payment_id = $2 WHERE number = $1", [number, paymentId]);
  await completeRenewal(number).catch(() => undefined);
}

/** Charges a new renewal invoice to the card on file; a decline starts dunning at this instant. */
export async function chargeRenewal(sub: SubscriptionRow, inv: InvoiceJson): Promise<void> {
  const item = inv.items.find((i) => i.itemType === "RECURRING" && i.subscriptionId === sub.id);
  const planName = item?.planName ?? (await derive(sub)).plan;
  const q = await boxQuote(sub, planName);
  await completeBoxInvoice(sub.account_id, inv.invoiceId, boxCharges(q));
  const number = await renewalOrder(sub, inv.invoiceId, q);
  if (approves(sub.card_behaviour, false)) {
    await payRenewal(sub, inv.invoiceId, number);
    await query("UPDATE renewals SET status = 'paid', claimed_until = NULL WHERE invoice_id = $1", [inv.invoiceId]);
    return;
  }
  await tx(async (client) => {
    const id = randomUUID();
    const [started] = await rows<{ failed_at: Date }>(
      client,
      `INSERT INTO dunning (id, subscription_id, invoice_id, failed_at, status) VALUES ($1, $2, $3, now(), 'open')
       ON CONFLICT DO NOTHING RETURNING failed_at`,
      [id, sub.id, inv.invoiceId],
    );
    await rows(client, "UPDATE renewals SET status = 'failed', claimed_until = NULL WHERE invoice_id = $1", [inv.invoiceId]);
    if (!started) return;
    for (const step of DUNNING_STEPS) {
      await rows(client, "INSERT INTO dunning_steps (dunning_id, day, due_at) VALUES ($1, $2, $3)", [
        id,
        step.day,
        stepInstant(started.failed_at, step.day),
      ]);
    }
    await dunningMail(client, sub.email, sub.customer_name, { kind: "failed" }, manageUrl(sub.id));
  });
}

/** Ends dunning after a successful charge: pays the open invoice, lifts any hold, sends the renewal. */
export async function recover(sub: SubscriptionRow, dunning: DunningRow): Promise<void> {
  const [order] = await query<{ number: string }>("SELECT number FROM orders WHERE renewal_invoice_id = $1", [dunning.invoice_id]);
  const paymentId = await payInvoice(
    sub.account_id,
    dunning.invoice_id,
    sub.payment_method_id,
    (await fullOrder(order.number)).order.total_cents,
    paymentKey(config.database, order.number),
  );
  await blockAccount(sub.account_id, "CEIBO_CLEAR");
  await tx(async (client) => {
    await rows(
      client,
      "UPDATE dunning SET status = 'recovered', ended_by = 'payment', shipments_held = false, ended_at = now() WHERE id = $1",
      [dunning.id],
    );
    await rows(client, "UPDATE dunning_steps SET dropped = true WHERE dunning_id = $1 AND done_at IS NULL", [dunning.id]);
    await rows(client, "UPDATE orders SET kb_payment_id = $2 WHERE number = $1", [order.number, paymentId]);
    await rows(client, "UPDATE renewals SET status = 'paid' WHERE invoice_id = $1", [dunning.invoice_id]);
  });
  await completeRenewal(order.number).catch(() => undefined);
}

/** Runs one due dunning step (claimed by the caller). Steps run in order, each once. */
export async function runDunningStep(dunningId: string, day: number): Promise<void> {
  const dunning = await one<DunningRow>("SELECT * FROM dunning WHERE id = $1", [dunningId]);
  if (!dunning || dunning.status !== "open") return;
  const sub = await subscriptionRow(dunning.subscription_id);
  if (!sub) return;
  const step = DUNNING_STEPS.find((s) => s.day === day);
  if (!step) return;
  const done = (client: Client) =>
    rows(client, "UPDATE dunning_steps SET done_at = now(), claimed_until = NULL WHERE dunning_id = $1 AND day = $2", [dunningId, day]);
  if (step.kind === "retry") {
    if (approves(sub.card_behaviour, false)) {
      await recover(sub, dunning);
      await tx(done);
      return;
    }
    await tx(async (client) => {
      await done(client);
      await rows(client, "UPDATE dunning SET step_day = $2 WHERE id = $1", [dunningId, day]);
      await dunningMail(client, sub.email, sub.customer_name, { kind: "retry", retry: step.retry ?? 0 }, manageUrl(sub.id));
    });
    return;
  }
  if (step.kind === "hold") {
    await blockAccount(sub.account_id, "CEIBO_OVERDUE");
    await tx(async (client) => {
      await done(client);
      await rows(client, "UPDATE dunning SET step_day = $2, shipments_held = true WHERE id = $1", [dunningId, HOLD_DAY]);
      await dunningMail(client, sub.email, sub.customer_name, { kind: "hold" }, manageUrl(sub.id));
    });
    return;
  }
  await cancelNow(sub.id);
  await tx(async (client) => {
    await done(client);
    await rows(
      client,
      "UPDATE dunning SET step_day = $2, status = 'cancelled', ended_by = 'schedule', ended_at = now() WHERE id = $1",
      [dunningId, CANCEL_DAY],
    );
    await dunningMail(client, sub.email, sub.customer_name, { kind: "cancel" }, manageUrl(sub.id));
  });
}

// ---- change confirmation ------------------------------------------------------------------

/** Writes a requested change into Kill Bill (once). */
async function writeChange(sub: SubscriptionRow, change: ChangeRow, d: Derived): Promise<void> {
  const cycle = cycleMonths(d.plan);
  const date = change.effective_date;
  switch (change.kind) {
    case "pause":
      await blockSubscription(sub.id, "CEIBO_PAUSED", date);
      await blockSubscription(sub.id, "CEIBO_ACTIVE", addMonths(date, (change.cycles ?? 1) * cycle));
      return;
    case "skip":
      await blockSubscription(sub.id, "CEIBO_SKIPPED", date);
      await blockSubscription(sub.id, "CEIBO_ACTIVE", addMonths(date, cycle));
      return;
    case "resume":
      await blockSubscription(sub.id, "CEIBO_ACTIVE", null);
      if (d.pause && d.pause.from > date) await blockSubscription(sub.id, "CEIBO_ACTIVE", d.pause.from);
      return;
    case "swap":
      await changePlan(sub.id, change.plan ?? "", date);
      return;
    case "cancel":
      await cancelAtEndOfTerm(sub.id);
      return;
  }
}

/**
 * Applies a pending change: writes it into Kill Bill once, then reads Kill Bill back and marks
 * the change applied only when Kill Bill's records show it.
 */
export async function confirmChange(change: ChangeRow): Promise<void> {
  const sub = await subscriptionRow(change.subscription_id);
  if (!sub) return;
  let d = await derive(sub);
  if (!change.written) {
    try {
      await writeChange(sub, change, d);
    } catch (error) {
      if (!(error instanceof KillBillError)) throw error;
      await query("UPDATE change_requests SET status = 'rejected', decided_at = now(), claimed_until = NULL WHERE id = $1", [change.id]);
      return;
    }
    await query("UPDATE change_requests SET written = true WHERE id = $1", [change.id]);
    d = await derive(sub);
  }
  const shown = (() => {
    switch (change.kind) {
      case "pause":
        return d.pause !== null && d.pause.from === change.effective_date;
      case "skip":
        return d.skip !== null && d.skip.date === change.effective_date;
      case "resume":
        return d.pause === null;
      case "swap":
        return d.kb.events.some(
          (e) => e.eventType === "CHANGE" && e.plan === change.plan && e.effectiveDate.slice(0, 10) === change.effective_date,
        );
      case "cancel":
        return d.billingEndDate !== null;
    }
  })();
  const stale = Date.now() - change.requested_at.getTime() > 60_000;
  if (!shown && !stale) {
    await query("UPDATE change_requests SET claimed_until = NULL WHERE id = $1", [change.id]);
    return;
  }
  await tx(async (client) => {
    const [updated] = await rows<{ id: string }>(
      client,
      `UPDATE change_requests SET status = $2, decided_at = now(), claimed_until = NULL
       WHERE id = $1 AND status = 'pending_provider' RETURNING id`,
      [change.id, shown ? "applied" : "rejected"],
    );
    if (!updated || !shown) return;
    if (change.kind === "cancel") {
      await rows(
        client,
        "UPDATE dunning SET status = 'cancelled', ended_by = 'customer', ended_at = now() WHERE subscription_id = $1 AND status = 'open'",
        [sub.id],
      );
      await rows(
        client,
        `UPDATE dunning_steps SET dropped = true WHERE done_at IS NULL
         AND dunning_id IN (SELECT id FROM dunning WHERE subscription_id = $1)`,
        [sub.id],
      );
    }
    const mail =
      change.kind === "pause" && d.pause
        ? ({ kind: "pause", resumesOn: d.pause.resumes_on } as const)
        : change.kind === "skip"
          ? ({ kind: "skip", date: change.effective_date } as const)
          : change.kind === "swap" && change.plan
            ? ({ kind: "swap", planLabel: planByName(change.plan)?.label ?? change.plan, date: change.effective_date } as const)
            : change.kind === "cancel" && d.billingEndDate
              ? ({ kind: "cancel", endDate: d.billingEndDate } as const)
              : null;
    if (mail) await changeApplied(client, sub.email, sub.customer_name, mail);
  });
}

// ---- refund confirmation ------------------------------------------------------------------

const REFUSED = ["PAYMENT_FAILURE", "PLUGIN_FAILURE", "PAYMENT_SYSTEM_OFF"];

/** Reads the refund transaction back from Kill Bill; only then does the order change. */
export async function confirmRefund(refund: RefundRow): Promise<void> {
  const full = await fullOrder(refund.order_number);
  const kb = await payment(full.order.kb_payment_id ?? "");
  const transaction = kb.transactions.find((t) => t.transactionType === "REFUND" && t.transactionExternalKey === refund.id);
  // Kill Bill writes the transaction before it settles (UNKNOWN, then PENDING or a final status);
  // only SUCCESS or a failure status decides the refund.
  if (!transaction || !["SUCCESS", ...REFUSED].includes(transaction.status)) {
    await query("UPDATE refunds SET claimed_until = NULL WHERE id = $1", [refund.id]);
    return;
  }
  const accepted = transaction.status === "SUCCESS";
  await tx(async (client) => {
    await rows(client, "SELECT number FROM orders WHERE number = $1 FOR UPDATE", [full.order.number]);
    const [updated] = await rows<RefundRow>(
      client,
      `UPDATE refunds SET status = $2, decided_at = now(), claimed_until = NULL WHERE id = $1 AND status = 'pending_provider' RETURNING *`,
      [refund.id, accepted ? "applied" : "rejected"],
    );
    if (!updated || !accepted) return;
    const [after] = await loadOrders([full.order.number], client);
    if (updated.full_refund) {
      if (["paid", "picking", "packed"].includes(after.order.status)) {
        for (const line of after.lines) await ledgerEvent(client, line.flavour, "returned", line.quantity, `refund:${refund.id}`);
        afterCommit(client, () => stockChanged(after.lines.map((l) => l.flavour)));
      }
      await rows(client, "UPDATE orders SET status = 'refunded', refund_status = 'refunded' WHERE number = $1", [full.order.number]);
    } else {
      await rows(client, "UPDATE orders SET refund_status = 'partially_refunded' WHERE number = $1", [full.order.number]);
    }
    await refundApplied(client, after, updated);
  });
}
