// Billing events, charge posting and invoice issue. A charge state, an issued state, a number and a
// balance are written only from a Kill Bill reply that supplies them.
import { randomUUID } from "node:crypto";
import { portStamp } from "../../shared/portTime.js";
import type { Invoice, Move } from "../../shared/types.js";
import type { App } from "../app.js";
import { ProviderError } from "../providers/providerError.js";
import type { BillingEventKind, InvoiceRecord, MoveRecord, Store } from "../store.js";
import { boardingInstant, detentionSeconds } from "./moveClock.js";
import { permits } from "./moveRules.js";
import { subjectOf } from "./plan.js";
import { billedHalfHours, billingEventLines, estimateFor, revisionInForce } from "./tariff.js";

/**
 * A billing event: lines computed once, by the revision in force at the boarding instant, stored with
 * a pending invoice. Counted late amendments are billed; the move comes back with the counter at 0.
 */
export function raiseBillingEvent(app: App, move: MoveRecord, event: BillingEventKind, now: number): MoveRecord {
  const instant = boardingInstant(move);
  const revision = revisionInForce(app.store, instant);
  const halfHours = billedHalfHours(revision, detentionSeconds(move, now), app.config.detentionUnitSeconds);
  const lines = billingEventLines(revision, event, subjectOf(move), instant, halfHours, move.late_amendments);
  const seq = app.store.next("invoice", 5001);
  app.store.invoices.put({
    id: `INV-${seq}`,
    seq,
    move_ref: move.ref,
    agency_code: move.agency_code,
    event,
    revision_id: revision.id,
    lines,
    total_cents: lines.reduce((sum, l) => sum + l.amount_cents, 0),
    charge_state: "pending",
    charge_attempts: [],
    killbill_invoice_id: null,
    issue_requested_by: null,
    state: "pending",
    number: null,
    balance_cents: null,
    balance_confirmed_at: null,
  });
  return { ...move, late_amendments: 0 };
}

const invoicesOf = (store: Store, ref: string): InvoiceRecord[] =>
  store.invoices.by("move_ref", ref).sort((a, b) => a.seq - b.seq);

/**
 * What prices a move on every surface: the revision and total of its newest billing event, or before
 * any event the revision in force at its boarding instant and the estimate total.
 */
export function pricedBy(store: Store, move: MoveRecord): { tariff_revision: string; total_cents: number } {
  const newest = invoicesOf(store, move.ref).pop();
  if (newest) {
    return { tariff_revision: store.tariffRevisions.get(newest.revision_id)?.label ?? "", total_cents: newest.total_cents };
  }
  const estimate = estimateFor(store, subjectOf(move), boardingInstant(move));
  return { tariff_revision: estimate.tariff_revision, total_cents: estimate.total_cents };
}

export function billingView(store: Store, ref: string): Pick<Move, "billing" | "lines"> {
  const invoices = invoicesOf(store, ref);
  const newest = invoices[invoices.length - 1];
  return {
    billing: {
      state: newest ? newest.charge_state : "none",
      invoice_id: newest?.id ?? null,
      invoice_ids: invoices.map((i) => i.id),
    },
    lines: invoices.flatMap((i) => i.lines),
  };
}

export function invoiceView(invoice: InvoiceRecord): Invoice {
  return {
    id: invoice.id,
    move_ref: invoice.move_ref,
    agency_code: invoice.agency_code,
    state: invoice.state,
    number: invoice.number,
    balance_cents: invoice.balance_cents,
    balance_confirmed_at: invoice.balance_confirmed_at === null ? null : portStamp(invoice.balance_confirmed_at),
    lines: invoice.lines,
    total_cents: invoice.total_cents,
    charge_state: invoice.charge_state,
  };
}

async function accountOf(app: App, code: string): Promise<string> {
  const agency = app.store.agencies.get(code);
  if (!agency) throw new RangeError(`unknown agency ${code}`);
  if (agency.killbill_account_id) return agency.killbill_account_id;
  const accountId = await app.killbill.accountFor(agency.code, agency.name);
  app.store.agencies.put({ ...agency, killbill_account_id: accountId });
  return accountId;
}

/**
 * The charge-posting step. Each attempt is recorded before the call; after an attempt whose reply was
 * lost, the account's invoices are read back and a DRAFT from that attempt is adopted, never doubled.
 */
export async function postCharges(app: App, invoiceId: string): Promise<void> {
  const invoice = app.store.invoices.get(invoiceId);
  if (!invoice || invoice.charge_state === "posted") return;
  const accountId = await accountOf(app, invoice.agency_code);
  const adopted = invoice.charge_attempts.length
    ? await app.killbill.draftFromAttempts(accountId, invoice.charge_attempts)
    : null;
  if (adopted) {
    app.store.invoices.put({ ...invoice, charge_state: "posted", killbill_invoice_id: adopted });
    return;
  }
  const attempt = randomUUID();
  const attempted = { ...invoice, charge_attempts: [...invoice.charge_attempts, attempt] };
  app.store.invoices.put(attempted);
  const posted = await app.killbill.postCharges(
    accountId,
    invoice.lines.map((l) => ({ description: `${invoice.move_ref} ${l.label}`, amount_cents: l.amount_cents })),
    attempt,
  );
  app.store.invoices.put({ ...attempted, charge_state: "posted", killbill_invoice_id: posted });
}

const committing = new Map<string, Promise<boolean>>();

/**
 * Commits an invoice in Kill Bill at most once. Callers arriving while a commit runs wait for it and
 * share its outcome. Resolves true once the invoice is issued.
 */
export function commitInvoice(app: App, invoiceId: string): Promise<boolean> {
  const inFlight = committing.get(invoiceId);
  if (inFlight) return inFlight;
  const run = (async (): Promise<boolean> => {
    const invoice = app.store.invoices.get(invoiceId);
    if (!invoice) return false;
    if (invoice.state === "issued") return true;
    if (invoice.charge_state !== "posted" || !invoice.killbill_invoice_id) return false;
    try {
      const confirmed = await app.killbill.commit(invoice.killbill_invoice_id);
      const now = Date.now();
      app.store.transaction(() => {
        app.store.invoices.put({
          ...invoice,
          state: "issued",
          number: confirmed.number,
          balance_cents: confirmed.balance_cents,
          balance_confirmed_at: now,
        });
        const move = app.store.moves.get(invoice.move_ref);
        if (move && invoice.event === "Completed" && permits("invoice", move)) {
          app.store.moves.put({
            ...move,
            status: "Invoiced",
            version: move.version + 1,
            history: [...move.history, { at: portStamp(now), status: "Invoiced", by: invoice.issue_requested_by ?? "Kill Bill" }],
          });
        }
      });
      return true;
    } catch (error) {
      if (error instanceof ProviderError) return false;
      throw error;
    }
  })();
  committing.set(invoiceId, run);
  void run.finally(() => committing.delete(invoiceId));
  return run;
}

/** Re-reads an issued invoice's balance when Kill Bill answers; otherwise the last confirmed value stands. */
export async function refreshBalance(app: App, invoice: InvoiceRecord): Promise<InvoiceRecord> {
  if (invoice.state !== "issued" || !invoice.killbill_invoice_id || !app.services.up("billing")) return invoice;
  try {
    const read = await app.killbill.invoice(invoice.killbill_invoice_id);
    const refreshed = { ...invoice, balance_cents: read.balance_cents, balance_confirmed_at: Date.now() };
    app.store.invoices.put(refreshed);
    return refreshed;
  } catch (error) {
    if (error instanceof ProviderError) return invoice;
    throw error;
  }
}
