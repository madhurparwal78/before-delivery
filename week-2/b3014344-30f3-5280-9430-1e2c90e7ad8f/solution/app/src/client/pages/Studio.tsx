import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Dialog } from "../components/Dialog";
import { api, newKey, RequestError } from "../lib/api";
import { COPY, copyFor } from "../../shared/copy";
import { isCare, longDate, PLAN_IDS, PLAN_NAMES, type Contractor, type Order, type OrderPayment, type PlanId, type PriceRow, type Project, type StudioEntry } from "../../shared/domain";
import { formatMoney, money, parseAmount } from "../../shared/money";
import { stateWord } from "./Overview";

const sum = (payments: OrderPayment[], field: "amount" | "refunded") => payments.reduce((total, p) => total + parseAmount(p[field])!, 0n);

function RefundDialog({ order, onClose, onDone }: { order: Order | null; onClose: () => void; onDone: (order: Order) => void }) {
  const [kind, setKind] = useState<"deposit" | "balance">("deposit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [banner, setBanner] = useState("");
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<Order | null>(order);

  useEffect(() => {
    if (order) {
      setShown(order);
      setKind(order.payments.some((p) => p.kind === "deposit") ? "deposit" : "balance");
      setAmount("");
      setReason("");
      setErrors({});
      setStatus("");
      setBanner("");
    }
  }, [order]);

  const payment = shown?.payments.find((p) => p.kind === kind);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!shown) return;
    setPending(true);
    setErrors({});
    setBanner("");
    setStatus(COPY.issuingRefund);
    try {
      const result = await api<{ refund: { amount: string }; payment: { kind: string; amount: string; refunded: string; remaining: string } }>(
        `/api/studio/orders/${shown.id}/refunds`,
        { body: { payment: kind, amount: amount.trim(), reason }, key: newKey() },
      );
      const updated: Order = {
        ...shown,
        payments: shown.payments.map((p) => (p.kind === kind ? { ...p, refunded: result.payment.refunded, remaining: result.payment.remaining } : p)),
      };
      setShown(updated);
      onDone(updated);
      setStatus(copyFor.refunded(money(result.refund.amount, shown.currency), money(result.payment.remaining, shown.currency)));
      setAmount("");
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      setStatus("");
      if (error.status === 422) setErrors(error.body.fields ?? {});
      else if (error.code === "billing_unavailable") setBanner(COPY.billingOutage);
      else setStatus(error.body.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={order !== null} label="Issue refund" onClose={onClose}>
      <h2 className="dialog__title">Issue refund{shown ? ` on ${shown.number}` : ""}</h2>
      {shown ? (
        <form onSubmit={submit} noValidate className="dialog__form">
          {banner ? <p role="alert" className="banner banner--outage">{banner}</p> : null}
          <div role="radiogroup" aria-label="Payment" className="segmented">
            {(["deposit", "balance"] as const).map((option) => (
              <label key={option} className="segmented__option">
                <input type="radio" name="refund-payment" value={option} checked={kind === option} onChange={() => setKind(option)} />
                <span>{option === "deposit" ? "Deposit" : "Launch balance"}</span>
              </label>
            ))}
          </div>
          <dl className="facts facts--compact">
            <div>
              <dt>Refunded so far</dt>
              <dd className="mono">{formatMoney(payment ? parseAmount(payment.refunded)! : 0n, shown.currency)}</dd>
            </div>
            <div>
              <dt>Left on this payment</dt>
              <dd className="mono">{formatMoney(payment ? parseAmount(payment.remaining)! : 0n, shown.currency)}</dd>
            </div>
          </dl>
          <div className="field">
            <label htmlFor="refund-amount">Amount</label>
            <input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={errors.amount ? "refund-amount-error" : undefined} aria-invalid={errors.amount ? true : undefined} />
            {errors.amount ? <p id="refund-amount-error" className="field-error">{errors.amount}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="refund-reason">Reason</label>
            <input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={errors.reason ? "refund-reason-error" : undefined} />
            {errors.reason ? <p id="refund-reason-error" className="field-error">{errors.reason}</p> : null}
          </div>
          <p role="status" aria-label="Refund status" className="live">{status}</p>
          <div className="dialog__actions">
            <button type="submit" className="button button--danger" disabled={pending}>Issue refund</button>
            <button type="button" className="button button--secondary" onClick={onClose}>Close</button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

function CreditDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setAmount("");
    setReason("");
    setErrors({});
    setStatus("");
  }, [order]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!order?.accountId) return;
    setPending(true);
    setErrors({});
    setStatus("Adding credit…");
    try {
      const result = await api<{ credit: { amount: string }; accountCredit: string }>(`/api/studio/accounts/${order.accountId}/credits`, {
        body: { amount: amount.trim(), currency: order.currency, reason },
        key: newKey(),
      });
      setStatus(`Added ${money(result.credit.amount, order.currency)} of credit. Unused credit on the account: ${money(result.accountCredit, order.currency)}.`);
      setAmount("");
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      if (error.status === 422) {
        setErrors(error.body.fields ?? {});
        setStatus("");
      } else setStatus(error.code === "billing_unavailable" ? COPY.billingOutage : error.body.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={order !== null} label="Add account credit" onClose={onClose}>
      <h2 className="dialog__title">Add account credit{order?.businessName ? ` for ${order.businessName}` : ""}</h2>
      <p className="dialog__text">Credit is held by billing in {order?.currency} and applies to the account's next invoice.</p>
      <form onSubmit={submit} noValidate className="dialog__form">
        <div className="field">
          <label htmlFor="credit-amount">Amount ({order?.currency})</label>
          <input id="credit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={errors.amount ? "credit-amount-error" : undefined} />
          {errors.amount ? <p id="credit-amount-error" className="field-error">{errors.amount}</p> : null}
          {errors.currency ? <p className="field-error">{errors.currency}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="credit-reason">Reason</label>
          <input id="credit-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          {errors.reason ? <p className="field-error">{errors.reason}</p> : null}
        </div>
        <p role="status" aria-label="Credit status" className="live">{status}</p>
        <div className="dialog__actions">
          <button type="submit" className="button button--primary" disabled={pending}>Add credit</button>
          <button type="button" className="button button--secondary" onClick={onClose}>Close</button>
        </div>
      </form>
    </Dialog>
  );
}

function Assignments({ projectId, contractors, initial, say }: { projectId: string; contractors: Contractor[]; initial: Contractor[]; say: (text: string) => void }) {
  const [assigned, setAssigned] = useState<Contractor[]>(initial);
  const [pick, setPick] = useState("");
  const assign = async () => {
    if (!pick) return;
    try {
      const result = await api<{ contractors: Contractor[] }>(`/api/studio/projects/${projectId}/assignments`, { body: { contractorId: pick } });
      setAssigned(result.contractors);
      say(`Assigned ${contractors.find((c) => c.id === pick)?.name ?? "the contractor"}.`);
    } catch (error) {
      say(error instanceof RequestError ? error.body.message : "We couldn't assign the contractor.");
    }
  };
  const remove = async (contractor: Contractor) => {
    try {
      await api(`/api/studio/projects/${projectId}/assignments/${contractor.id}`, { method: "DELETE" });
      setAssigned((list) => list.filter((c) => c.id !== contractor.id));
      say(`Removed ${contractor.name} from the project.`);
    } catch (error) {
      say(error instanceof RequestError ? error.body.message : "We couldn't remove the contractor.");
    }
  };
  const selectId = `assign-${projectId}`;
  return (
    <div className="assign">
      <span className="assign__label">Contractors</span>
      <ul className="assign__list">
        {assigned.map((c) => (
          <li key={c.id}>
            {c.name}
            <button type="button" className="button button--ghost button--small" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}>Remove</button>
          </li>
        ))}
      </ul>
      <label htmlFor={selectId} className="visually-hidden">Contractor for this project</label>
      <select id={selectId} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Contractor…</option>
        {contractors.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button type="button" className="button button--secondary button--small" onClick={assign}>Assign</button>
    </div>
  );
}

function OrdersTable({ ledger, say }: { ledger: StudioLedger; say: (text: string) => void }) {
  const [orders, setOrders] = useState<Order[]>(ledger.orders);
  const { contractors, assignments } = ledger;
  const [refunding, setRefunding] = useState<Order | null>(null);
  const [crediting, setCrediting] = useState<Order | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const move = async (order: Order, to: "in_build" | "balance_invoiced" | "closed", done: string) => {
    setBusy(order.id);
    say(to === "balance_invoiced" ? "Invoicing the launch balance with billing…" : "Saving…");
    try {
      const updated = await api<Order>(`/api/studio/orders/${order.id}/transitions`, { body: { to } });
      setOrders((list) => list.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      say(`${order.number}: ${done}`);
    } catch (error) {
      say(error instanceof RequestError ? (error.code === "billing_unavailable" ? COPY.billingOutage : error.body.message) : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="orders" aria-labelledby="studio-orders" className="ledger-section">
      <h2 id="studio-orders">Orders</h2>
      <div className="table-frame">
        <table className="ledger-table ledger-table--wide" aria-label="Orders">
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Client</th>
              <th scope="col">Plan</th>
              <th scope="col">Currency</th>
              <th scope="col">State</th>
              <th scope="col" className="num">Total</th>
              <th scope="col" className="num">Paid</th>
              <th scope="col" className="num">Refunded</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const refundable = order.payments.some((p) => p.kind === "deposit" || p.kind === "balance");
              const build = !isCare(order.plan);
              const assignable = build && order.state !== "closed" ? order.projectId : null;
              return (
                <Fragment key={order.id}>
                <tr className={assignable ? "has-subrow" : undefined}>
                  <td className="mono">{order.number}</td>
                  <td>{order.businessName}</td>
                  <td>{order.planName}</td>
                  <td className="mono">{order.currency}</td>
                  <td><span className={`pill pill--${order.state}`}>{stateWord(order.state)}</span></td>
                  <td className="num mono">{money(order.total, order.currency)}</td>
                  <td className="num mono">{formatMoney(sum(order.payments, "amount"), order.currency)}</td>
                  <td className="num mono">{formatMoney(sum(order.payments, "refunded"), order.currency)}</td>
                  <td>
                    <div className="row-actions">
                      {order.state === "deposit_paid" ? (
                        <button type="button" className="button button--primary button--small" disabled={busy === order.id} onClick={() => move(order, "in_build", "build started.")}>Start build</button>
                      ) : null}
                      {order.state === "in_build" ? (
                        <button type="button" className="button button--primary button--small" disabled={busy === order.id} onClick={() => move(order, "balance_invoiced", "launch balance invoiced.")}>Invoice launch balance</button>
                      ) : null}
                      {order.state === "paid_in_full" && build ? (
                        <button type="button" className="button button--danger button--small" disabled={busy === order.id} onClick={() => move(order, "closed", "project closed. Contractor access has ended.")}>Close project</button>
                      ) : null}
                      {refundable ? (
                        <button type="button" className="button button--secondary button--small" onClick={() => setRefunding(order)}>Refund</button>
                      ) : null}
                      {order.accountId && order.payments.length ? (
                        <button type="button" className="button button--ghost button--small" onClick={() => setCrediting(order)}>Add credit</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {assignable ? (
                  <tr className="ledger-subrow">
                    <td colSpan={9}>
                      <Assignments projectId={assignable} contractors={contractors} initial={assignments[assignable] ?? []} say={say} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <RefundDialog
        order={refunding}
        onClose={() => setRefunding(null)}
        onDone={(updated) => setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)))}
      />
      <CreditDialog order={crediting} onClose={() => setCrediting(null)} />
    </section>
  );
}

function Prices({ initial, say }: { initial: PriceRow[]; say: (text: string) => void }) {
  const [rows, setRows] = useState<PriceRow[]>(initial);
  const [plan, setPlan] = useState<PlanId>("launch-page");
  const [amount, setAmount] = useState("");
  const [effective, setEffective] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const load = () => {
    api<{ prices: PriceRow[] }>("/api/studio/prices").then((body) => setRows(body.prices)).catch(() => undefined);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const row = await api<PriceRow>("/api/studio/prices", {
        body: { plan, currency: "ARS", amount: amount.trim(), ...(effective ? { effectiveAt: `${effective}:00-03:00` } : {}) },
      });
      say(`Scheduled ${PLAN_NAMES[row.plan]} at ${money(row.amount, "ARS")} from ${longDate(row.effectiveAt)}, ${row.effectiveAt.slice(11, 16)}.`);
      setAmount("");
      setEffective("");
      load();
    } catch (error) {
      if (error instanceof RequestError && error.status === 422) setErrors(error.body.fields ?? {});
      else say(error instanceof RequestError ? error.body.message : "We couldn't schedule the price.");
    } finally {
      setPending(false);
    }
  };
  const ars = rows.filter((r) => r.currency === "ARS");
  return (
    <section id="prices" aria-labelledby="studio-prices" className="ledger-section">
      <h2 id="studio-prices">Peso prices</h2>
      <form aria-label="Peso prices" className="sheet-form sheet-form--inline" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="price-plan">Plan</label>
          <select id="price-plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
            {PLAN_IDS.map((id) => (
              <option key={id} value={id}>{PLAN_NAMES[id]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="price-amount">Amount (ARS)</label>
          <input id="price-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={errors.amount ? "price-amount-error" : undefined} />
          {errors.amount ? <p id="price-amount-error" className="field-error">{errors.amount}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="price-effective">Effective from</label>
          <input id="price-effective" type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} aria-describedby="price-effective-hint" />
          <p id="price-effective-hint" className="field-hint">Buenos Aires time. Leave empty to apply now.</p>
          {errors.effectiveAt ? <p className="field-error">{errors.effectiveAt}</p> : null}
        </div>
        <button type="submit" className="button button--primary" disabled={pending}>Schedule price</button>
      </form>
      <div className="table-frame" tabIndex={0} role="region" aria-label="Price schedule, scrollable">
        <table className="ledger-table" aria-label="Price schedule">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Effective from</th>
              <th scope="col" className="num">Amount (ARS)</th>
            </tr>
          </thead>
          <tbody>
            {ars.map((row) => (
              <tr key={row.id}>
                <td>{PLAN_NAMES[row.plan]}</td>
                <td className="mono">{longDate(row.effectiveAt)}, {row.effectiveAt.slice(11, 16)}</td>
                <td className="num mono">{money(row.amount, "ARS")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Entries({ initial, say }: { initial: StudioEntry[] | null; say: (text: string) => void }) {
  const [entries, setEntries] = useState<StudioEntry[]>(initial ?? []);
  const move = async (entry: StudioEntry, action: "publish" | "withdraw") => {
    try {
      const updated = await api<StudioEntry>(`/api/studio/entries/${entry.id}/${action}`, { body: {} });
      setEntries((list) => list.map((e) => (e.id === updated.id ? updated : e)));
      say(`${updated.title} is now ${updated.status}.`);
    } catch (error) {
      say(error instanceof RequestError ? (error.code === "cms_unavailable" ? COPY.cmsOutage : error.body.message) : "That didn't go through.");
    }
  };
  return (
    <section id="entries" aria-labelledby="studio-entries" className="ledger-section">
      <h2 id="studio-entries">Entries</h2>
      {initial === null ? <p className="notice notice--seam">{COPY.cmsOutage}</p> : null}
      <div className="table-frame">
        <table className="ledger-table" aria-label="Entries">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">Published</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.title}</td>
                <td>{entry.kind === "case_study" ? "Case study" : "Journal"}</td>
                <td><span className={`pill pill--${entry.status}`}>{entry.status}</span></td>
                <td className="mono">{entry.publishedAt ? longDate(entry.publishedAt) : "—"}</td>
                <td>
                  {entry.status === "draft" ? (
                    <button type="button" className="button button--primary button--small" onClick={() => move(entry, "publish")}>Publish</button>
                  ) : entry.status === "published" ? (
                    <button type="button" className="button button--secondary button--small" onClick={() => move(entry, "withdraw")}>Withdraw</button>
                  ) : (
                    <span className="muted">Withdrawn</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface StudioLedger {
  orders: Order[];
  contractors: Contractor[];
  assignments: Record<string, Contractor[]>;
  prices: PriceRow[];
  entries: StudioEntry[] | null;
}

/** Everything the console shows, read in one pass so no section moves the ones below it once it arrives. */
async function loadLedger(say: (text: string) => void): Promise<StudioLedger> {
  const [orders, contractors, prices, entries] = await Promise.all([
    api<{ orders: Order[] }>("/api/studio/orders").then((body) => body.orders).catch(() => {
      say("We couldn't load the orders. Try again in a moment.");
      return [];
    }),
    api<{ contractors: Contractor[] }>("/api/studio/contractors").then((body) => body.contractors).catch(() => []),
    api<{ prices: PriceRow[] }>("/api/studio/prices").then((body) => body.prices).catch(() => []),
    api<{ entries: StudioEntry[] }>("/api/studio/entries").then((body) => body.entries).catch(() => null),
  ]);
  const open = orders.filter((o) => !isCare(o.plan) && o.projectId && o.state !== "closed");
  const assigned = await Promise.all(
    open.map((o) => api<Project>(`/api/projects/${o.projectId}`).then((p) => [o.projectId!, p.contractors] as const).catch(() => [o.projectId!, []] as const)),
  );
  return { orders, contractors, assignments: Object.fromEntries(assigned), prices, entries };
}

export function Studio() {
  const [status, setStatus] = useState("");
  const [ledger, setLedger] = useState<StudioLedger | null>(null);
  const say = useCallback((text: string) => setStatus(text), []);
  useEffect(() => {
    void loadLedger(say).then(setLedger);
  }, [say]);
  return (
    <div className="ledger-page studio">
      <p className="eyebrow">Studio console</p>
      <h1>Pampero ledger</h1>
      <p role="status" aria-label="Studio status" className="live live--sticky">{status}</p>
      {ledger ? (
        <>
          <OrdersTable ledger={ledger} say={say} />
          <Prices initial={ledger.prices} say={say} />
          <Entries initial={ledger.entries} say={say} />
        </>
      ) : (
        <p className="muted">Loading the studio ledger…</p>
      )}
    </div>
  );
}
