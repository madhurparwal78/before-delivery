// The box office (brief: Screens and layout › Box office): sessions, the orders ledger with
// refunds and notes, overdue supporters, price changes, the monthly reconciliation per currency
// and the staff action record.

import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiFailure, LostReply, type LedgerOrder, type Session } from "../api.js";
import { useApi, useStableKey } from "../hooks.js";
import { useApp } from "../state.js";
import { Dialog } from "../components/Dialog.js";
import { StaffActions } from "../components/StaffActions.js";
import { ErrorSummary, Field, Skeleton, TextArea, type FieldErrors } from "../components/ui.js";
import { LISBON_ENTRY_HINT, readLisbonEntry } from "../entries.js";
import { COPY, SESSION_STATUS_LABELS, TIERS, TIER_NAMES, copyFor, type Tier } from "../../shared/copy.js";
import { CURRENCIES, formatPrice, parseAmount, type Currency } from "../../shared/money.js";
import { formatLisbonDate, formatLisbonDateTime, lisbonDate, parseDateEntry } from "../../shared/lisbon.js";

const ORDER_STATUS_LABELS: Record<LedgerOrder["status"], string> = { settled: "Settled", partially_refunded: "Partly refunded", refunded: "Refunded" };
const MONTHS_SHOWN = 12;

interface Failure {
  errors: FieldErrors;
  message: string;
}
const NO_FAILURE: Failure = { errors: {}, message: "" };

function failureOf(error: unknown): Failure {
  if (error instanceof ApiFailure) return { errors: error.error.fields ?? {}, message: error.error.fields ? COPY.validation : error.error.message };
  if (error instanceof LostReply) return { errors: {}, message: COPY.billingDown };
  return NO_FAILURE;
}

function Section({ label, catalogue, title, children, className }: { label: string; catalogue: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={`museum-card office-section ${className ?? ""}`}>
      <p className="catalogue">{catalogue}</p>
      <h2 className="card-title">{title}</h2>
      {children}
    </section>
  );
}

function NewSessionForm({ onCreated }: { onCreated: () => void }) {
  const app = useApp();
  const [form, setForm] = useState({ title: "", starts: "", duration: "60", capacity: "10" });
  const [failure, setFailure] = useState<Failure>(NO_FAILURE);
  const [busy, setBusy] = useState(false);
  const set = (name: keyof typeof form) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [name]: value }));
  };
  const whole = (text: string) => (/^\d+$/.test(text) ? Number(text) : text);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setFailure(NO_FAILURE);
    const read = readLisbonEntry(form.starts);
    if ("error" in read) return setFailure({ errors: { starts_at: read.error }, message: COPY.validation });
    setBusy(true);
    try {
      await api("/api/manager/sessions", { body: { title: form.title, starts_at: read.iso, duration_minutes: whole(form.duration), capacity: whole(form.capacity) } });
      app.announce(COPY.sessionCreated);
      setForm({ title: "", starts: "", duration: "60", capacity: "10" });
      onCreated();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  const ids = { title: "session-title", starts_at: "session-starts", duration_minutes: "session-duration", capacity: "session-capacity" };
  return (
    <form aria-label="New session" className="office-form" noValidate onSubmit={(e) => void create(e)}>
      <h3>New session</h3>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={ids} />
      <Field id={ids.title} label="Title" value={form.title} onChange={set("title")} error={failure.errors.title} />
      <Field id={ids.starts_at} label="Starts at (Lisbon time)" autoComplete="off" hint={LISBON_ENTRY_HINT} value={form.starts} onChange={set("starts")} error={failure.errors.starts_at} />
      <div className="form-grid">
        <Field id={ids.duration_minutes} label="Duration in minutes" type="number" min={15} max={240} inputMode="numeric" value={form.duration} onChange={set("duration")} error={failure.errors.duration_minutes} />
        <Field id={ids.capacity} label="Capacity" type="number" min={1} max={200} inputMode="numeric" value={form.capacity} onChange={set("capacity")} error={failure.errors.capacity} />
      </div>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Create session
        </button>
      </div>
    </form>
  );
}

function CancelSessionDialog({ session, onClose, onDone }: { session: Session | null; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<Failure>(NO_FAILURE);
  const [busy, setBusy] = useState(false);
  const keyFor = useStableKey(JSON.stringify([session?.id, reason]));
  const close = () => {
    setReason("");
    setFailure(NO_FAILURE);
    onClose();
  };
  const cancel = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    setFailure(NO_FAILURE);
    try {
      const { refunds } = await api<{ refunds: number }>(`/api/manager/sessions/${session.id}/cancel`, { body: { reason }, key: keyFor() });
      app.announce(copyFor.sessionCancelled(refunds));
      onDone();
      close();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={session !== null} label="Cancel session" onClose={close}>
      <h2>Cancel session</h2>
      <p className="dialog-lede">
        {session?.title}. Every booking is refunded in full and each booker is emailed.
      </p>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={{ reason: "cancel-reason" }} />
      <form noValidate onSubmit={(e) => void cancel(e)}>
        <TextArea id="cancel-reason" label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} error={failure.errors.reason} />
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Cancel session
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RefundDialog({ order, onClose, onDone }: { order: LedgerOrder | null; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<Failure>(NO_FAILURE);
  const [busy, setBusy] = useState(false);
  const keyFor = useStableKey(JSON.stringify([order?.id, amount, reason]));
  const close = () => {
    setAmount("");
    setReason("");
    setFailure(NO_FAILURE);
    onClose();
  };
  const refund = async (event: FormEvent) => {
    event.preventDefault();
    if (!order || busy) return;
    setFailure(NO_FAILURE);
    const minor = parseAmount(amount, order.currency);
    if (minor === null) return setFailure({ errors: { amount_minor: COPY.amountFormat }, message: COPY.validation });
    setBusy(true);
    try {
      const { refund: made } = await api<{ refund: { amount_minor: number } }>(`/api/manager/orders/${order.id}/refunds`, { body: { amount_minor: minor, reason }, key: keyFor() });
      app.announce(copyFor.refundIssued(formatPrice(made.amount_minor, order.currency)));
      onDone();
      close();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  const ids = { amount_minor: "refund-amount", reason: "refund-reason" };
  return (
    <Dialog open={order !== null} label="Refund" onClose={close}>
      <h2>Refund</h2>
      {order && (
        <p className="dialog-lede">
          {order.receipt_number} · {order.description} · {formatPrice(order.amount_minor - order.refunded_minor, order.currency)} left to refund
        </p>
      )}
      <ErrorSummary errors={failure.errors} message={failure.message} ids={ids} />
      <form noValidate onSubmit={(e) => void refund(e)}>
        <Field id={ids.amount_minor} label="Amount" inputMode="decimal" autoComplete="off" hint={order ? `In ${order.currency}, such as ${order.currency === "JPY" ? "2000" : "12.50"}.` : undefined} value={amount} onChange={(e) => setAmount(e.currentTarget.value)} error={failure.errors.amount_minor} />
        <TextArea id={ids.reason} label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} error={failure.errors.reason} />
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Issue refund
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NoteDialog({ order, onClose, onDone }: { order: LedgerOrder | null; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<Failure>(NO_FAILURE);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setText("");
    setFailure(NO_FAILURE);
    onClose();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!order || busy) return;
    setBusy(true);
    setFailure(NO_FAILURE);
    try {
      await api(`/api/manager/orders/${order.id}/notes`, { body: { text } });
      app.announce(COPY.noteAdded);
      onDone();
      close();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={order !== null} label="Add note" onClose={close}>
      <h2>Add note</h2>
      <p className="dialog-lede">Notes stay in the box office; they never appear on a receipt.</p>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={{ text: "note-text" }} />
      <form noValidate onSubmit={(e) => void save(e)}>
        <TextArea id="note-text" label="Note" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.currentTarget.value)} error={failure.errors.text} />
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Save note
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PriceChangeForm({ onScheduled }: { onScheduled: () => void }) {
  const app = useApp();
  const [form, setForm] = useState<{ tier: Tier; currency: Currency; price: string; effective: string }>({ tier: "fellow", currency: "EUR", price: "", effective: "" });
  const [failure, setFailure] = useState<Failure>(NO_FAILURE);
  const [busy, setBusy] = useState(false);
  const schedule = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const errors: FieldErrors = {};
    const amount = parseAmount(form.price, form.currency);
    const effective = parseDateEntry(form.effective);
    if (amount === null) errors.amount_minor = COPY.amountFormat;
    if (effective === null) errors.effective_on = COPY.afterToday;
    if (amount === null || effective === null) return setFailure({ errors, message: COPY.validation });
    setBusy(true);
    setFailure(NO_FAILURE);
    try {
      const { change } = await api<{ change: { effective_on: string } }>("/api/manager/plan-prices", { body: { tier: form.tier, currency: form.currency, amount_minor: amount, effective_on: effective } });
      app.announce(copyFor.priceScheduled(formatLisbonDate(change.effective_on)));
      setForm((f) => ({ ...f, price: "", effective: "" }));
      onScheduled();
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  };
  const ids = { tier: "price-tier", currency: "price-currency", amount_minor: "price-amount", effective_on: "price-effective" };
  return (
    <form aria-label="Price change" className="office-form" noValidate onSubmit={(e) => void schedule(e)}>
      <ErrorSummary errors={failure.errors} message={failure.message} ids={ids} />
      <div className="form-grid">
        <div className="field select-field">
          <label htmlFor={ids.tier}>Tier</label>
          <select id={ids.tier} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.currentTarget.value as Tier })}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_NAMES[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field select-field">
          <label htmlFor={ids.currency}>Currency</label>
          <select id={ids.currency} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.currentTarget.value as Currency })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-grid">
        <Field id={ids.amount_minor} label="New price" inputMode="decimal" autoComplete="off" value={form.price} onChange={(e) => setForm({ ...form, price: e.currentTarget.value })} error={failure.errors.amount_minor} />
        <Field id={ids.effective_on} label="Effective from" autoComplete="off" hint="A Lisbon date, as YYYY-MM-DD." value={form.effective} onChange={(e) => setForm({ ...form, effective: e.currentTarget.value })} error={failure.errors.effective_on} />
      </div>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Schedule price change
        </button>
      </div>
    </form>
  );
}

interface ReconciliationRow {
  currency: Currency;
  ledger_net_minor: number;
  killbill_net_minor: number;
  difference_minor: number;
  matched: boolean;
}

function monthsBefore(month: string, count: number): string[] {
  const [year, number] = month.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + (number - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

function monthLabel(month: string): string {
  return formatLisbonDate(`${month}-01`).replace(/^1 /, "");
}

function Reconciliation({ current, version }: { current: string; version: number }) {
  const [month, setMonth] = useState(current);
  const report = useApi<{ month: string; currencies: ReconciliationRow[] }>(`/api/manager/reconciliation?month=${month}&v=${version}`);
  return (
    <>
      <div className="field select-field">
        <label htmlFor="recon-month">Month</label>
        <select id="recon-month" value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
          {monthsBefore(current, MONTHS_SHOWN).map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>
      {report.failure ? (
        <p className="banner-inline">{report.failure.error.message}</p>
      ) : !report.data ? (
        <Skeleton lines={4} />
      ) : (
        <div className="table-scroll" role="region" aria-label="Reconciliation table" tabIndex={0}>
          <table aria-label="Reconciliation" className="data-table">
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th scope="col">Ledger net</th>
                <th scope="col">Kill Bill net</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.data.currencies.map((r) => (
                <tr key={r.currency}>
                  <th scope="row" className="figure">
                    {r.currency}
                  </th>
                  <td className="figure">{formatPrice(r.ledger_net_minor, r.currency)}</td>
                  <td className="figure">{formatPrice(r.killbill_net_minor, r.currency)}</td>
                  <td>
                    <span className={`badge${r.matched ? "" : " badge-alert"}`}>{r.matched ? "Matched" : copyFor.difference(formatPrice(Math.abs(r.difference_minor), r.currency))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface OverdueRow {
  user_email: string;
  name: string;
  tier: string;
  currency: Currency;
  amount_due_minor: number;
  failed_at: string;
  attempts: number;
  next_retry_at: string | null;
}

export function BoxOfficePage() {
  const app = useApp();
  const [version, setVersion] = useState(0);
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [refunding, setRefunding] = useState<LedgerOrder | null>(null);
  const [noting, setNoting] = useState<LedgerOrder | null>(null);
  const isManager = app.user?.role === "manager";
  const sessions = useApi<{ server_time: string; sessions: Session[] }>(isManager ? `/api/sessions?v=${version}` : null);
  const ledger = useApi<{ orders: LedgerOrder[] }>(isManager ? `/api/manager/orders?v=${version}` : null);
  const dunning = useApi<{ overdue: OverdueRow[] }>(isManager ? `/api/manager/dunning?v=${version}` : null);
  const refresh = () => setVersion((v) => v + 1);

  if (!app.userLoaded) return <div className="page" aria-busy="true" />;
  if (!app.user || !isManager)
    return (
      <div className="page">
        <div className="museum-card signed-out-card">
          <h1>Box office</h1>
          <p>{app.user ? COPY.forbidden : COPY.unauthenticated}</p>
          {!app.user && (
            <button type="button" className="button button-primary" onClick={(e) => app.openSignIn(e.currentTarget)}>
              Sign in
            </button>
          )}
        </div>
      </div>
    );

  const serverMonth = sessions.data ? sessions.data.server_time.slice(0, 7) : null;

  return (
    <div className="page office-page">
      <header className="page-intro">
        <p className="eyebrow">Box office and membership · {app.user.name}</p>
        <h1>Box office</h1>
      </header>
      <div className="office-grid">
        <Section label="Sessions" catalogue="HRR-SESSIONS" title="Guided sessions">
          <NewSessionForm onCreated={refresh} />
          <div className="office-list">
            {!sessions.data ? (
              <Skeleton lines={4} />
            ) : (
              <ul className="office-sessions">
                {sessions.data.sessions.map((s) => (
                  <li key={s.id} className="office-session">
                    <div>
                      <p className="office-session-title">{s.title}</p>
                      <p className="era">
                        {s.starts_at_display} · {s.duration_minutes} min · {copyFor.seatsLeft(s.seats_left)} of {s.capacity}
                      </p>
                    </div>
                    <span className="badge">{SESSION_STATUS_LABELS[s.status]}</span>
                    {(s.status === "on_sale" || s.status === "closed") && (
                      <button type="button" className="button button-small" onClick={() => setCancelling(s)}>
                        Cancel session
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
        <Section label="Overdue supporters" catalogue="HRR-DUNNING" title="Overdue supporters">
          <div className="office-list">
            {dunning.failure ? (
              <p className="banner-inline">{dunning.failure.error.message}</p>
            ) : !dunning.data ? (
              <Skeleton lines={3} />
            ) : dunning.data.overdue.length ? (
              <div className="table-scroll">
                <table aria-label="Overdue supporters" className="data-table stack-on-phone">
                  <thead>
                    <tr>
                      <th scope="col">Supporter</th>
                      <th scope="col">Tier</th>
                      <th scope="col">Due</th>
                      <th scope="col">Declined</th>
                      <th scope="col">Attempts</th>
                      <th scope="col">Next retry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dunning.data.overdue.map((r) => (
                      <tr key={r.user_email}>
                        <th scope="row" data-label="Supporter">
                          {r.name} <span className="era">{r.user_email}</span>
                        </th>
                        <td data-label="Tier">{r.tier}</td>
                        <td data-label="Due" className="figure">
                          {formatPrice(r.amount_due_minor, r.currency)}
                        </td>
                        <td data-label="Declined">{formatLisbonDateTime(Date.parse(r.failed_at))}</td>
                        <td data-label="Attempts" className="figure">
                          {r.attempts}
                        </td>
                        <td data-label="Next retry">{r.next_retry_at ? formatLisbonDateTime(Date.parse(r.next_retry_at)) : "None left"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="card-text">No supporter is overdue.</p>
            )}
          </div>
        </Section>
        <Section label="Price changes" catalogue="HRR-PRICES" title="Schedule a price change">
          <p className="card-text">A new monthly price applies from 00:00 Lisbon time on its date, to new members and to existing members from their first payment on or after it.</p>
          <PriceChangeForm onScheduled={refresh} />
        </Section>
        <Section label="Monthly reconciliation" catalogue="HRR-RECON" title="Monthly reconciliation">
          <p className="card-text">Ledger and Kill Bill net totals per currency, for a month in Lisbon time.</p>
          {serverMonth ? <Reconciliation current={serverMonth} version={version} /> : <Skeleton lines={4} />}
        </Section>
        <Section label="Orders ledger" catalogue="HRR-LEDGER" title="Orders ledger" className="span-wide">
          {!ledger.data ? (
            <Skeleton lines={5} />
          ) : (
            <div className="table-scroll table-tall">
              <table aria-label="Ledger" className="data-table stack-on-phone">
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">Payer</th>
                    <th scope="col">Item</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Refunded</th>
                    <th scope="col">Status</th>
                    <th scope="col">Settled</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.orders.map((o) => (
                    <tr key={o.id}>
                      <th scope="row" data-label="Receipt" className="figure">
                        {o.receipt_number}
                      </th>
                      <td data-label="Payer">{o.user_email}</td>
                      <td data-label="Item">
                        {o.description}
                        {o.notes.map((n) => (
                          <p key={n.id} className="ledger-note">
                            {n.text} <span className="era">— {n.author_email}</span>
                          </p>
                        ))}
                      </td>
                      <td data-label="Amount" className="figure">
                        {formatPrice(o.amount_minor, o.currency)}
                      </td>
                      <td data-label="Refunded" className="figure">
                        {formatPrice(o.refunded_minor, o.currency)}
                      </td>
                      <td data-label="Status">{ORDER_STATUS_LABELS[o.status]}</td>
                      <td data-label="Settled">{formatLisbonDate(lisbonDate(Date.parse(o.settled_at)))}</td>
                      <td data-label="Actions" className="row-actions">
                        <button type="button" className="button button-small" onClick={() => setRefunding(o)}>
                          Refund
                        </button>
                        <button type="button" className="button button-small button-quiet" onClick={() => setNoting(o)}>
                          Add note
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <StaffActions version={version} />
      <CancelSessionDialog session={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
      <RefundDialog order={refunding} onClose={() => setRefunding(null)} onDone={refresh} />
      <NoteDialog order={noting} onClose={() => setNoting(null)} onDone={refresh} />
    </div>
  );
}
