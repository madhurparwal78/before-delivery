// `/c/<commission id>/maintenance` — the monthly retainer, billed in advance by Kill Bill.
import { useState } from "react";
import { PLANS, type Plan } from "../../shared/catalog";
import { usd } from "../../shared/format";
import { HttpError, call } from "../lib/api";
import { toast } from "../lib/notices";
import { CommissionLinks, Failed, Missing, Skeleton, failureText, useLoad, useScene, type Commission } from "./common";

interface Invoice { killbillInvoiceId: string; invoiceNumber: string; items: { description: string; amountCents: number; startDate: string | null; endDate: string | null }[]; amountCents: number }
interface MaintenanceView { plan: Plan | null; chargedThroughDate: string | null; invoices: Invoice[] }

export function Maintenance({ id }: { id: string }) {
  useScene("working");
  const [load, reload] = useLoad<Commission>(`/api/commissions/${id}`);
  const [plan, reloadPlan] = useLoad<MaintenanceView>(`/api/commissions/${id}/maintenance`);
  const [choice, setChoice] = useState<Plan>("essential");
  const [proration, setProration] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  const current = plan.status === "ready" ? plan.data.plan : null;

  const act = async (): Promise<void> => {
    setBusy(true);
    try {
      if (current) {
        const result = await call<{ invoice: Invoice }>(`/api/commissions/${id}/maintenance`, { method: "PUT", json: { plan: choice } });
        setProration(result.invoice);
        toast(`Switched to the ${PLANS[choice].label} plan. Kill Bill's proration is below.`);
      } else {
        await call(`/api/commissions/${id}/maintenance`, { json: { plan: choice } });
        toast(`Maintenance started on the ${PLANS[choice].label} plan.`);
      }
      await Promise.all([reload(), reloadPlan()]);
    } catch (error) {
      if (error instanceof HttpError && error.code === "same_plan") toast("You're already on that plan.");
      else if (error instanceof HttpError && (error.code === "milestone_unpaid" || error.code === "illegal_state")) toast("That step isn't available yet.");
      else toast(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">{load.status === "ready" ? load.data.title : "Maintenance"}</p>
        <h1>Maintenance</h1>
        <p className="muted">After signed acceptance is paid, a monthly plan keeps the piece running. Plan changes take effect today and Kill Bill prorates them.</p>
      </header>
      {plan.status === "loading" && <Skeleton rows={2} />}
      {plan.status === "failed" && <p className="chip-note" role="alert">{plan.message}</p>}
      {plan.status === "ready" && (
        <div className="panel stack">
          {current
            ? <p>Current plan: <strong style={{ fontWeight: 400 }}>{PLANS[current].label}</strong> · {usd(PLANS[current].priceCents)} a month</p>
            : <p>Current plan: none yet</p>}
          <p className="muted">Charged through {plan.data.chargedThroughDate ?? "—"} (Kill Bill)</p>
        </div>
      )}
      <form className="stack section" onSubmit={(e) => {
        e.preventDefault();
        void act();
      }}>
        <div role="radiogroup" aria-label="Maintenance plan" className="stack" style={{ gap: 8 }}>
          {(Object.keys(PLANS) as Plan[]).map((p) => (
            <label key={p} className="option">
              <input type="radio" name="plan" value={p} checked={choice === p} onChange={() => setChoice(p)} />
              <span>{PLANS[p].label} — {PLANS[p].summary}</span><span className="price">{usd(PLANS[p].priceCents)} / month</span>
            </label>
          ))}
        </div>
        <div className="row-actions">
          <button type="submit" className="button primary" aria-busy={busy || undefined}>{current ? "Change plan" : "Start maintenance"}</button>
        </div>
      </form>
      {proration && (
        <section className="section" aria-labelledby="proration-title">
          <h2 id="proration-title">Proration</h2>
          <div className="table-wrap" role="region" aria-label="Proration table" tabIndex={0}>
            <table aria-label="Proration">
              <thead><tr><th>Kill Bill item</th><th>Period</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {proration.items.map((item, i) => (
                  <tr key={i}><td>{item.description}</td><td>{item.startDate ?? "—"} → {item.endDate ?? "—"}</td><td className="num">{usd(item.amountCents)}</td></tr>
                ))}
                <tr><td>Invoice {proration.invoiceNumber} total</td><td /><td className="num">{usd(proration.amountCents)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="section" aria-label="Commission pages"><CommissionLinks id={id} /></section>
    </main>
  );
}
