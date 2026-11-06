// Billing: plan, change-plan form, proration preview, seats, card form and invoices.
import { useEffect, useState } from "preact/hooks";
import type { Invoice, Payment, Period, Plan, Subscription } from "../../shared/api-types.js";
import { dollars, localDate, localTime } from "../../shared/format.js";
import { PLAN_CATALOG } from "../../shared/plans.js";
import { ApiError, get, newKey, post } from "../api.js";
import { Button, Dialog, Field, Status, useBusy } from "../ui.js";
import { OUTAGE_COPY, allowed, readOnlyCopy, useSession } from "./shell.js";

interface BillingState { subscription: Subscription; card: { last4: string } | null }
interface Ledger { invoices: Invoice[]; payments: Payment[] }

const PERIOD_LABEL: Record<Period, string> = { monthly: "Monthly", annual: "Annual" };

function cardFrom(number: string, expiry: string, cvc: string) {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{2})\s*$/.exec(expiry);
  return { number: number.replace(/\s+/g, ""), expMonth: m ? Number(m[1]) : 0, expYear: m ? 2000 + Number(m[2]) : 0, cvc: cvc.trim() };
}

export function Billing() {
  const { session, refresh } = useSession();
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [plan, setPlan] = useState<Plan>("team");
  const [period, setPeriod] = useState<Period>("monthly");
  const [extraSeats, setExtraSeats] = useState("0");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState("");
  const [cancelling, setCancelling] = useState<HTMLElement | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const tz = session.workspace.timeZone;

  const load = async (first = false) => {
    const state = await get<BillingState>("/api/billing");
    if (first) {
      setPlan(state.subscription.plan);
      setPeriod(state.subscription.period);
      setExtraSeats(String(state.subscription.extraSeats));
    }
    setBilling(state);
    try { setLedger(await get<Ledger>("/api/billing/invoices")); } catch { setLedger(null); }
  };
  useEffect(() => { load(true).catch(() => undefined); }, []);

  const fail = (error: unknown) => {
    if (!(error instanceof ApiError)) { setStatus("Something went wrong. Try again."); return; }
    const body = error.body;
    if (error.status === 503) setStatus(body.service === "billing" ? OUTAGE_COPY.billing : OUTAGE_COPY.file_storage);
    else if (error.code === "card_declined") setStatus("Your card was declined. Nothing was charged.");
    else if (error.code === "seats_in_use") setStatus(`You have ${String(body.seatsUsed)} people and invitations, more than the ${String(body.seatsAfter)} seats this choice includes.`);
    else if (error.code === "invoice_already_paid") setStatus("This invoice is already paid.");
    else if (error.code === "workspace_read_only" && billing) setStatus(readOnlyCopy(billing.subscription) ?? "The workspace is read-only.");
    else if (error.status === 422) {
      const fields = error.fieldErrors;
      setErrors(fields);
      if (fields.plan === "Already on this plan") setStatus("You are already on this plan.");
      else if (fields.amountCents) setStatus("That is more than the refundable balance.");
      else setStatus("Check the highlighted fields.");
    } else setStatus("The billing request could not be completed.");
  };

  const act = async (name: string, pending: string, work: () => Promise<string>) => {
    setBusyAction(name);
    setErrors({});
    setStatus(pending);
    try {
      setStatus(await work());
      await load();
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusyAction(null);
    }
  };

  if (!billing) return <div class="page"><h1>Billing</h1><p class="muted">Loading billing…</p></div>;
  const sub = billing.subscription;
  const canCheckout = sub.state === "trial" || (sub.state === "suspended" && !sub.graceEndsAt);
  const active = sub.state === "active";
  const card = () => cardFrom(number, expiry, cvc);
  const seatsChoice = Number(extraSeats);

  const checkout = () => act("checkout", "Processing payment…", async () => {
    const result = await post<{ invoice: Invoice }>("/api/billing/checkout", { plan, period, extraSeats: seatsChoice, card: card() }, { idempotencyKey: newKey() });
    return `Payment recorded for invoice ${result.invoice.number}. A receipt is on its way.`;
  });
  const runPreview = async () => {
    setBusyAction("preview");
    setPreview("Calculating…");
    try {
      const result = await get<{ change: "immediate" | "end_of_term"; amountCents: number; effectiveAt: string }>(`/api/billing/plan/preview?plan=${plan}&period=${period}`);
      setPreview(result.change === "immediate" ? `Due today: ${dollars(result.amountCents)}` : `No charge today. Your plan changes on ${localDate(result.effectiveAt, tz)}.`);
    } catch (error) {
      setPreview("");
      fail(error);
    } finally {
      setBusyAction(null);
    }
  };
  const changePlan = () => act("plan", "Processing payment…", async () => {
    const result = await post<{ change: "immediate" | "end_of_term"; invoice?: Invoice; effectiveAt?: string }>("/api/billing/plan", { plan, period }, { idempotencyKey: newKey() });
    setPreview("");
    const label = `${PLAN_CATALOG[plan].name} ${period}`;
    return result.change === "immediate"
      ? `Plan changed to ${label}. Charged ${dollars(result.invoice?.amountCents ?? 0)}.`
      : `Your plan changes to ${label} on ${localDate(result.effectiveAt ?? "", tz)}.`;
  });
  const updateSeats = () => act("seats", "Processing payment…", async () => {
    const result = await post<{ change: "immediate" | "end_of_term"; invoice?: Invoice; subscription: Subscription; effectiveAt?: string }>("/api/billing/seats", { extraSeats: seatsChoice }, { idempotencyKey: newKey() });
    return result.change === "immediate"
      ? `Seats updated to ${result.subscription.seatsPurchased}. Charged ${dollars(result.invoice?.amountCents ?? 0)}.`
      : `Seats drop to ${PLAN_CATALOG[sub.plan].includedSeats + seatsChoice} on ${localDate(result.effectiveAt ?? "", tz)}.`;
  });
  const pay = (invoice: Invoice) => act(`pay-${invoice.id}`, "Processing payment…", async () => {
    await post(`/api/billing/invoices/${invoice.id}/pay`, { card: card() }, { idempotencyKey: newKey() });
    return `Payment recorded for invoice ${invoice.number}. A receipt is on its way.`;
  });
  const refund = (invoice: Invoice, payment: Payment) => act(`refund-${invoice.id}`, "Processing refund…", async () => {
    const amount = payment.amountCents - payment.refundedCents;
    await post(`/api/billing/payments/${payment.id}/refund`, {}, { idempotencyKey: newKey() });
    return `Refunded ${dollars(amount)} for invoice ${invoice.number}.`;
  });

  const refundable = (invoice: Invoice) => ledger?.payments.find((p) => p.invoiceId === invoice.id && p.amountCents > p.refundedCents);

  return (
    <div class="page">
      <div class="page-head"><h1>Billing</h1></div>
      <Status label="Billing status" text={status} />
      <div class="billing-grid">
        <div class="stack">
          <section class="panel" aria-label="Plan">
            <div class="panel-title"><h2 id="plan-title">Current plan</h2><span class="badge">{sub.state === "past_due" ? "Past due" : sub.state[0].toUpperCase() + sub.state.slice(1)}</span></div>
            <div class="panel-body">
              <p class="price">{sub.state === "trial" ? "Trial · Team" : `${PLAN_CATALOG[sub.plan].name} ${sub.period}`}</p>
              <p><span class="num">{sub.seatsPurchased}</span> seats purchased{sub.extraSeats > 0 ? <> (<span class="num">{sub.extraSeats}</span> extra)</> : null}</p>
              {sub.trialEndsAt && sub.state === "trial" ? <p>Trial ends <span class="num">{localTime(sub.trialEndsAt, tz)}</span></p> : null}
              {sub.graceEndsAt && sub.state === "past_due" ? <p class="field-error">Grace period ends <span class="num">{localTime(sub.graceEndsAt, tz)}</span></p> : null}
              {sub.pendingChange ? <p>Changes to {PLAN_CATALOG[sub.pendingChange.plan].name} {sub.pendingChange.period} with <span class="num">{sub.pendingChange.extraSeats}</span> extra seats on <span class="num">{localDate(sub.pendingChange.effectiveAt, tz)}</span>.</p> : null}
              {billing.card ? <p class="muted">Card ending <span class="num">{billing.card.last4}</span></p> : null}
            </div>
          </section>
          <section class="panel" aria-labelledby="change-title">
            <div class="panel-title"><h2 id="change-title">{canCheckout ? "Choose a plan" : "Change plan or seats"}</h2></div>
            <div class="panel-body">
              <div role="radiogroup" aria-label="Plan" class="choices">
                {(["team", "business"] as const).map((p) => (
                  <label class="choice" key={p}><input type="radio" name="plan" checked={plan === p} onChange={() => setPlan(p)} />{PLAN_CATALOG[p].name}</label>
                ))}
              </div>
              <div role="radiogroup" aria-label="Billing period" class="choices">
                {(["monthly", "annual"] as const).map((p) => (
                  <label class="choice" key={p}><input type="radio" name="billing-period" checked={period === p} onChange={() => setPeriod(p)} />{PERIOD_LABEL[p]}</label>
                ))}
              </div>
              <p class="muted small">{PLAN_CATALOG[plan].name}: <span class="num">{dollars(PLAN_CATALOG[plan].prices[period].base)}</span> per {period === "monthly" ? "month" : "year"}, <span class="num">{PLAN_CATALOG[plan].includedSeats}</span> seats included, extra seats <span class="num">{dollars(PLAN_CATALOG[plan].prices[period].seat)}</span> each.</p>
              <Field label="Extra seats" type="number" min={0} max={500} value={extraSeats} onInput={(e) => setExtraSeats(e.currentTarget.value)} error={errors.extraSeats} />
              <div class="row-actions" style={{ justifyContent: "flex-start" }}>
                {canCheckout ? <Button variant="primary" busy={busyAction === "checkout"} onClick={() => { void checkout(); }}>Start paid plan</Button> : null}
                {active ? <Button busy={busyAction === "preview"} onClick={() => { void runPreview(); }}>Preview change</Button> : null}
                {active ? <Button variant="primary" busy={busyAction === "plan"} onClick={() => { void changePlan(); }}>Change plan</Button> : null}
                {active ? <Button busy={busyAction === "seats"} onClick={() => { void updateSeats(); }}>Update seats</Button> : null}
              </div>
              <div role="region" aria-label="Proration preview" aria-live="polite" class="notice" hidden={!preview}>{preview}</div>
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="panel" aria-labelledby="card-title">
            <div class="panel-title"><h2 id="card-title">Card</h2></div>
            <div class="panel-body">
              <div class="card-fields">
                <Field label="Card number" inputMode="numeric" autocomplete="cc-number" value={number} onInput={(e) => setNumber(e.currentTarget.value)} error={errors["card.number"]} />
                <Field label="Expiry (MM/YY)" autocomplete="cc-exp" placeholder="MM/YY" value={expiry} onInput={(e) => setExpiry(e.currentTarget.value)} error={errors["card.expMonth"] ?? errors["card.expYear"]} />
                <Field label="CVC" inputMode="numeric" autocomplete="cc-csc" value={cvc} onInput={(e) => setCvc(e.currentTarget.value)} error={errors["card.cvc"]} />
              </div>
              {errors.card ? <p class="field-error">{errors.card}</p> : null}
              <p class="muted small">Only the last four digits are kept. The card number and CVC never reach our records or emails.</p>
            </div>
          </section>
          <section class="panel" aria-labelledby="invoices-title">
            <div class="panel-title"><h2 id="invoices-title">Invoices</h2></div>
            <div class="table-wrap">
              <table class="ruled cards" aria-label="Invoices">
                <thead><tr><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Balance</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {ledger?.invoices.map((inv) => {
                    const payment = refundable(inv);
                    return (
                      <tr key={inv.id}>
                        <td data-label="Invoice" class="num">{inv.number}</td>
                        <td data-label="Date" class="num">{inv.date}</td>
                        <td data-label="Amount" class="num">{dollars(inv.amountCents)}</td>
                        <td data-label="Balance" class="num">{dollars(inv.balanceCents)}</td>
                        <td data-label="Status"><span class={`badge${inv.status === "unpaid" ? " alert" : ""}`}>{inv.status === "paid" ? "Paid" : "Unpaid"}</span></td>
                        <td data-label="Actions"><div class="row-actions">
                          {inv.status === "unpaid" ? <Button small variant="primary" busy={busyAction === `pay-${inv.id}`} onClick={() => { void pay(inv); }}>{`Pay invoice ${inv.number}`}</Button> : null}
                          {inv.pdfAvailable ? <a class="button small" href={`/api/billing/invoices/${inv.id}/pdf`} download={`invoice-${inv.number}.pdf`}>{`Download invoice ${inv.number}`}</a> : null}
                          {inv.status === "paid" && payment ? <Button small busy={busyAction === `refund-${inv.id}`} onClick={() => { void refund(inv, payment); }}>{`Refund invoice ${inv.number}`}</Button> : null}
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ledger && ledger.invoices.length === 0 ? <p class="panel-body muted">No invoices yet.</p> : null}
              {ledger === null ? <p class="panel-body muted">Invoices appear here when the billing gateway answers.</p> : null}
            </div>
          </section>
          {allowed(session, "subscription.cancel") && sub.state !== "cancelled" ? (
            <section class="panel" aria-labelledby="cancel-title">
              <div class="panel-title"><h2 id="cancel-title">Cancel</h2></div>
              <div class="panel-body">
                <p>Cancelling is final: the workspace becomes read-only and published embeds stop.</p>
                <div><Button variant="danger" onClick={(e) => setCancelling(e.currentTarget)}>Cancel subscription</Button></div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {cancelling ? (
        <Dialog title="Cancel subscription" alert initialFocus="[data-keep]" returnFocus={cancelling} onClose={() => setCancelling(null)}>
          {(close) => <CancelSubscription close={close} onConfirm={() => act("cancel", "Cancelling…", async () => {
            await post("/api/billing/cancel", undefined, { idempotencyKey: newKey() });
            return "Subscription cancelled. The workspace is now read-only.";
          })} />}
        </Dialog>
      ) : null}
    </div>
  );
}

function CancelSubscription({ close, onConfirm }: { close: () => void; onConfirm: () => Promise<void> }) {
  const [busy, run] = useBusy();
  return (
    <>
      <div class="dialog-body"><p>The workspace becomes read-only at once and embeds stop answering. This cannot be undone.</p></div>
      <footer>
        <Button data-keep onClick={close}>Keep subscription</Button>
        <Button variant="danger" busy={busy} onClick={() => { void run(async () => { await onConfirm(); close(); }); }}>Cancel subscription</Button>
      </footer>
    </>
  );
}
