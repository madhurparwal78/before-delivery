/** The billing statement: CSV following RFC 4180, rows following Kill Bill exactly. */

import type { Pool } from "../db/pool.js";
import * as kb from "./killbill.js";
import { zoneDate } from "../time.js";

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowOf(cells: string[]): string {
  return cells.map(csvEscape).join(",");
}

export interface StatementRow {
  date: string;
  kind: string;
  plan: string;
  amount: string;
  balanceAfter: string;
  kbId: string;
}

/** Builds the statement rows from Kill Bill's own order, then the CSV bytes. */
export async function buildStatement(pool: Pool, serverId: string, slug: string): Promise<string | null> {
  const server = (await pool.query<{ killbill_account_id: string | null; time_zone: string; id: string }>(
    "SELECT killbill_account_id, time_zone, id FROM servers WHERE id = $1",
    [serverId]
  )).rows[0];
  if (server === undefined || server.killbill_account_id === null) return null;

  let invoices: kb.KbInvoice[];
  try {
    invoices = await kb.getInvoicesForAccount(server.killbill_account_id);
  } catch {
    return null;
  }
  invoices.sort((a, b) => a.invoiceNumber - b.invoiceNumber);

  const subscriptionKey = (await pool.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [
    `plotwright-${serverId}-sub`,
  ])).rows[0];
  const subscriptionId = subscriptionKey?.account_id ?? null;
  let changeEvents: { eventId: string; effectiveDate: string; plan: string | null; eventType: string }[] = [];
  if (subscriptionId !== null) {
    try {
      const sub = await kb.getSubscription(subscriptionId);
      changeEvents = sub.events.filter((e) => e.eventType === "CHANGE");
    } catch {
      return null;
    }
  }

  const confirmedPlans = new Set<string>();
  const rows: StatementRow[] = [];
  let running = 0;
  for (const invoice of invoices) {
    const recurring = invoice.items.find((i) => i.itemType === "RECURRING");
    const planName = recurring?.planName?.startsWith("hamlet") ? "Hamlet" : recurring?.planName?.startsWith("borough") ? "Borough" : "Hamlet";
    const planSlug = recurring?.planName?.startsWith("borough") ? "borough" : "hamlet";

    // A plan_change row comes first when this is the first invoice carrying the confirmed new plan's charge.
    if (planName !== "Hamlet" || invoices.length > 0) {
      if (recurring !== undefined && recurring.planName !== null && !confirmedPlans.has(recurring.planName) && confirmedPlans.size > 0) {
        const event = changeEvents.find((e) => (e.plan ?? "").startsWith(planSlug));
        confirmedPlans.add(recurring.planName);
        rows.push({
          date: (event?.effectiveDate ?? invoice.invoiceDate).slice(0, 10),
          kind: "plan_change",
          plan: planName,
          amount: "0.00",
          balanceAfter: running.toFixed(2),
          kbId: event?.eventId ?? invoice.invoiceId,
        });
      } else if (recurring !== undefined && recurring.planName !== null) {
        confirmedPlans.add(recurring.planName);
      }
    }

    running += invoice.amount;
    rows.push({
      date: invoice.invoiceDate,
      kind: "invoice",
      plan: planName,
      amount: invoice.amount.toFixed(2),
      balanceAfter: running.toFixed(2),
      kbId: invoice.invoiceId,
    });

    for (const item of invoice.items) {
      if (item.amount < 0) {
        running += item.amount;
        rows.push({
          date: invoice.invoiceDate,
          kind: "credit",
          plan: planName,
          amount: item.amount.toFixed(2),
          balanceAfter: running.toFixed(2),
          kbId: item.invoiceItemId,
        });
      }
    }

    let payments: kb.KbInvoicePayment[] = [];
    try {
      payments = await kb.getInvoicePayments(invoice.invoiceId);
    } catch {
      return null;
    }
    const purchases = payments
      .map((p) => {
        const purchase = p.transactions.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
        return purchase === undefined ? null : { p, purchase };
      })
      .filter((x): x is { p: kb.KbInvoicePayment; purchase: kb.KbPaymentTransaction } => x !== null);
    purchases.sort((a, b) => new Date(a.purchase.effectiveDate).getTime() - new Date(b.purchase.effectiveDate).getTime());
    for (const { p, purchase } of purchases) {
      const amount = -purchase.amount;
      running += amount;
      rows.push({
        date: zoneDate(new Date(purchase.effectiveDate), server.time_zone),
        kind: "payment",
        plan: planName,
        amount: amount.toFixed(2),
        balanceAfter: running.toFixed(2),
        kbId: p.paymentId,
      });
    }
  }

  const header = rowOf(["date", "kind", "plan", "amount", "balance_after", "kb_id"]);
  const body = rows.map((r) => rowOf([r.date, r.kind, r.plan, r.amount, r.balanceAfter, r.kbId])).join("\r\n");
  void slug;
  return `${header}\r\n${body}\r\n`;
}
