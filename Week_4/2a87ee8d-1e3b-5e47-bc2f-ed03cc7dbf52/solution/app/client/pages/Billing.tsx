import { useEffect, useState } from "react";
import { api, ApiFailure, failureText, opId } from "../api.js";
import { AccountShell, BillingBanner, useBilling, useFacilitator } from "../account.js";
import { euro, formatDate, instantDateTime } from "../format.js";
import { Meter, useTitle } from "../ui.js";
import { PLANS, PLAN_LABELS, TERM_LABELS, type Plan, type Term } from "../../shared/plans.js";
import { TermToggle } from "./Landing.js";
import type { Billing as BillingData, Invoice } from "../types.js";

type Message = { kind: "ok" | "error"; text: string };

function changeMessage(before: BillingData, after: BillingData, invoice: Invoice | null, plan: Plan, term: Term): string {
  const label = `${PLAN_LABELS[plan]} (${TERM_LABELS[term]})`;
  if (before.pendingChange && plan === before.plan && term === before.term) return `Scheduled change cancelled. You stay on ${label}.`;
  if (after.pendingChange) return `${label} starts on ${formatDate(after.pendingChange.effectiveDate)}.`;
  return invoice ? `Plan changed to ${label}. Invoice ${invoice.number} for ${euro(invoice.amount)}.` : `Plan changed to ${label}.`;
}

export function Billing() {
  useTitle("Plan and billing");
  const me = useFacilitator();
  const [billing, setBilling, reload] = useBilling();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [term, setTerm] = useState<Term | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (billing && plan === null) {
      setPlan(billing.plan);
      setTerm(billing.term);
    }
  }, [billing, plan]);

  const zone = me?.timeZone ?? "UTC";
  const chosenPlan = plan ?? billing?.plan;
  const chosenTerm = term ?? billing?.term;
  const differs = billing !== null && (chosenPlan !== billing.plan || chosenTerm !== billing.term);
  const canChange = billing !== null && (differs || billing.pendingChange !== null);

  const change = async () => {
    if (!billing || !chosenPlan || !chosenTerm || busy) return;
    setBusy(true);
    try {
      const r = await api<{ billing: BillingData; invoice: Invoice | null }>("POST", "/api/billing/plan", { clientOpId: opId(), plan: chosenPlan, term: chosenTerm });
      setMessage({ kind: "ok", text: changeMessage(billing, r.billing, r.invoice, chosenPlan, chosenTerm) });
      setBilling(r.billing);
      setPlan(r.billing.plan);
      setTerm(r.billing.term);
    } catch (e) {
      const outage = "Billing is unavailable. Your plan hasn't changed — try again shortly.";
      setMessage({ kind: "error", text: e instanceof ApiFailure && e.code === "billing_unavailable" ? outage : failureText(e, outage) });
      void reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountShell>
      <main className="column">
        {me && (
          <BillingBanner
            billing={billing}
            zone={zone}
            onBilling={(b) => setBilling(b)}
            report={(kind, text) => {
              setMessage({ kind, text });
              void reload();
            }}
          />
        )}
        <h1 className="display-sm">Plan and billing</h1>
        <div role="status" aria-label="Billing activity" className={message?.kind === "ok" ? "message message-ok" : "message idle"}>
          {message?.kind === "ok" ? message.text : ""}
        </div>
        <div role="alert" aria-label="Billing problems" className={message?.kind === "error" ? "message message-error" : "message idle"}>
          {message?.kind === "error" ? message.text : ""}
        </div>
        {billing === null ? (
          <p className="muted">Loading your plan…</p>
        ) : (
          <>
            <section className="ruled-section">
              <p className="current-plan">
                {PLAN_LABELS[billing.plan]} ({TERM_LABELS[billing.term]}) — renews on {formatDate(billing.renewsOn)}
              </p>
              {billing.pendingChange && (
                <p className="pending-change">
                  Changes on {formatDate(billing.pendingChange.effectiveDate)} to {PLAN_LABELS[billing.pendingChange.plan]} ({TERM_LABELS[billing.pendingChange.term]})
                </p>
              )}
              {billing.stale && billing.syncedAt && <p className="muted">Showing your plan as of {instantDateTime(billing.syncedAt, zone)} — billing is unavailable.</p>}
              <div className="choosers">
                <div className="chooser">
                  <span className="chooser-label" aria-hidden="true">
                    Plan
                  </span>
                <div role="radiogroup" aria-label="Plan" className="choice-list">
                  {PLANS.map((p) => (
                    <label key={p} className="choice">
                      <input type="radio" name="plan" checked={chosenPlan === p} onChange={() => setPlan(p)} />
                      <span>{PLAN_LABELS[p]}</span>
                    </label>
                  ))}
                </div>
                </div>
                <div className="chooser">
                  <span className="chooser-label" aria-hidden="true">
                    Billing term
                  </span>
                  {chosenTerm && <TermToggle name="term" term={chosenTerm} onChange={setTerm} />}
                </div>
              </div>
              <button type="button" className="btn btn-primary" disabled={!canChange} onClick={() => void change()}>
                {busy ? "Changing…" : "Change plan"}
              </button>
            </section>
            <section className="ruled-section">
              <h2 className="h3">Usage</h2>
              <ul aria-label="Usage" className="meters">
                <li>
                  <Meter label="Active workshops" used={billing.usage.activeWorkshops} cap={billing.entitlements.activeWorkshops} />
                </li>
                <li>
                  <Meter label="Invites today" used={billing.usage.invitesToday} cap={billing.entitlements.invitesPerDay} />
                </li>
              </ul>
            </section>
            <section className="ruled-section">
              <h2 className="h3">Invoices</h2>
              <ul aria-label="Invoices" className="ruled-list">
                {billing.invoices.map((i) => (
                  <li key={i.id} className="ruled-row">
                    <span className="mono">{formatDate(i.date)}</span> — Invoice <span className="mono">{i.number}</span> — <span className="mono">{euro(i.amount)}</span> —{" "}
                    {i.status === "paid" ? "Paid" : "Unpaid"}
                  </li>
                ))}
              </ul>
              {billing.invoices.length === 0 && <p className="empty">No invoices yet.</p>}
            </section>
          </>
        )}
      </main>
    </AccountShell>
  );
}
