import { query } from "./db";
import { errors, HttpError } from "./http";
import * as billing from "./killbill";
import { PLAN_NAMES, type Invoice, type InvoiceKind, type PlanId } from "../shared/domain";
import { toAmount } from "../shared/money";

// Invoices are read from Kill Bill on every request; the ledger only says which order each belongs to.

interface Ledger {
  orders: Map<string, { id: string; plan: PlanId }>;
  subscriptions: Map<string, { orderId: string; number: string }>;
  firstCare: Set<string>;
  stored: Set<string>;
}

async function ledgerFor(accountId: string): Promise<Ledger> {
  const [orders, plans, payments, pdfs] = await Promise.all([
    query<{ id: string; number: string; plan: PlanId }>("SELECT id, number, plan FROM orders WHERE account_id = $1", [accountId]),
    query<{ kb_subscription_id: string; order_id: string; number: string }>(
      "SELECT cp.kb_subscription_id, cp.order_id, o.number FROM care_plans cp JOIN orders o ON o.id = cp.order_id WHERE cp.account_id = $1",
      [accountId],
    ),
    query<{ kb_invoice_id: string }>(
      "SELECT pay.kb_invoice_id FROM payments pay JOIN orders o ON o.id = pay.order_id WHERE o.account_id = $1 AND pay.kind = 'care'",
      [accountId],
    ),
    query<{ kb_invoice_id: string }>(
      "SELECT d.kb_invoice_id FROM invoice_pdfs d JOIN orders o ON o.id = d.order_id WHERE o.account_id = $1 AND d.stored_at IS NOT NULL",
      [accountId],
    ),
  ]);
  return {
    orders: new Map(orders.map((o) => [o.number, { id: o.id, plan: o.plan }])),
    subscriptions: new Map(plans.map((p) => [p.kb_subscription_id, { orderId: p.order_id, number: p.number }])),
    firstCare: new Set(payments.map((p) => p.kb_invoice_id)),
    stored: new Set(pdfs.map((p) => p.kb_invoice_id)),
  };
}

function tierName(planName: string | null): string {
  return planName?.startsWith("care-plus") ? PLAN_NAMES["care-plus"] : PLAN_NAMES["care-lite"];
}

/** Which order and kind a Kill Bill invoice belongs to; invoices of no order (credit grants) are left out. */
function classify(inv: billing.KbInvoice, ledger: Ledger): { kind: InvoiceKind; orderId: string; description: string } | null {
  const charge = inv.items.find((item) => item.itemType === "EXTERNAL_CHARGE" && item.description);
  if (charge?.description) {
    const match = /^(PB-\d{4}) (deposit|launch balance)$/.exec(charge.description);
    const order = match ? ledger.orders.get(match[1]!) : undefined;
    if (!match || !order) return null;
    return { kind: match[2] === "deposit" ? "deposit" : "balance", orderId: order.id, description: charge.description };
  }
  const subscribed = inv.items.find((item) => item.subscriptionId && ledger.subscriptions.has(item.subscriptionId));
  if (!subscribed) return null;
  const plan = ledger.subscriptions.get(subscribed.subscriptionId!)!;
  const recurring = inv.items.find((item) => item.itemType === "RECURRING");
  const name = tierName(recurring?.planName ?? subscribed.planName);
  if (inv.items.some((item) => item.itemType === "REPAIR_ADJ")) {
    return { kind: "change", orderId: plan.orderId, description: `${plan.number} change to ${name}` };
  }
  const period = recurring?.startDate && recurring.endDate ? `, ${recurring.startDate} to ${recurring.endDate}` : "";
  return ledger.firstCare.has(inv.invoiceId)
    ? { kind: "care", orderId: plan.orderId, description: `${plan.number} ${name} first month${period}` }
    : { kind: "renewal", orderId: plan.orderId, description: `${plan.number} ${name} renewal${period}` };
}

export function invoiceBody(inv: billing.KbInvoice, kind: InvoiceKind, orderId: string | null, description: string, pdf: boolean): Invoice {
  const amount = billing.kbMinor(inv.amount);
  const balance = billing.kbMinor(inv.balance);
  const status = inv.status === "VOID" ? "void" : amount < 0n ? "credit" : balance > 0n ? "open" : "paid";
  return {
    id: inv.invoiceId,
    number: inv.invoiceNumber,
    date: inv.invoiceDate,
    kind,
    description,
    amount: toAmount(amount),
    balance: toAmount(balance > 0n ? balance : 0n),
    currency: inv.currency,
    status,
    orderId,
    pdf,
  };
}

async function billingId(accountId: string): Promise<string | null> {
  const [account] = await query<{ kb_account_id: string | null }>("SELECT kb_account_id FROM client_accounts WHERE id = $1", [accountId]);
  return account?.kb_account_id ?? null;
}

export async function listInvoices(accountId: string): Promise<Invoice[]> {
  const kbAccountId = await billingId(accountId);
  if (!kbAccountId) return [];
  const [invoices, ledger] = await Promise.all([billing.accountInvoices(kbAccountId), ledgerFor(accountId)]);
  return invoices
    .flatMap((inv) => {
      const found = classify(inv, ledger);
      return found ? [invoiceBody(inv, found.kind, found.orderId, found.description, ledger.stored.has(inv.invoiceId))] : [];
    })
    .sort((a, b) => (a.date === b.date ? Number(b.number) - Number(a.number) : a.date < b.date ? 1 : -1));
}

/** One invoice of the caller's account; any other id gets the uniform 404. */
export async function accountInvoice(accountId: string, invoiceId: string): Promise<{ invoice: Invoice; orderId: string }> {
  const kbAccountId = await billingId(accountId);
  if (!kbAccountId) throw errors.notFound();
  const inv = await billing.invoice(invoiceId);
  if (!inv || inv.accountId !== kbAccountId) throw errors.notFound();
  const ledger = await ledgerFor(accountId);
  const found = classify(inv, ledger);
  if (!found) throw errors.notFound();
  return { invoice: invoiceBody(inv, found.kind, found.orderId, found.description, ledger.stored.has(inv.invoiceId)), orderId: found.orderId };
}

export function pdfPending(): HttpError {
  return new HttpError(409, "pdf_pending", "The PDF for this invoice is still being prepared. Try again in a moment.");
}
