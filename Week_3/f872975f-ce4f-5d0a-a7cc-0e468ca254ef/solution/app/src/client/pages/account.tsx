// The maker's account: holds with live labels from the server, cut tickets and invoices.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hold, Invoice, Ticket } from "../../shared/api";
import { formatWhen, holdLabel, money, TICKET_LABELS } from "../../shared/domain";
import { api, navigate, signInPath, useServices } from "../api";
import { Link } from "../app";
import { HOLD_COPY, useHoldActions } from "../holdactions";

const HOLD_POLL_MS = 4000;

export function AccountPage() {
  const services = useServices();
  const billingDown = services.billing === "down";
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [status, setStatus] = useState("");
  const { pending, cancel, pay } = useHoldActions();
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const focusAfter = useRef<string | null>(null);

  const loadHolds = useCallback(async () => {
    const r = await api<{ holds: Hold[] }>("GET", "/api/holds");
    if (r.ok) setHolds(r.data.holds);
  }, []);
  const loadRecords = useCallback(async () => {
    const [t, i] = await Promise.all([api<{ tickets: Ticket[] }>("GET", "/api/tickets"), api<{ invoices: Invoice[] }>("GET", "/api/invoices")]);
    if (t.ok) setTickets([...t.data.tickets].reverse());
    if (i.ok) setInvoices(i.data.invoices);
  }, []);

  useEffect(() => {
    void loadHolds();
    void loadRecords();
  }, [loadHolds, loadRecords]);

  const anyHeld = holds?.some((h) => h.status === "held") ?? false;
  useEffect(() => {
    if (!anyHeld) return;
    const timer = setInterval(() => void loadHolds(), HOLD_POLL_MS);
    return () => clearInterval(timer);
  }, [anyHeld, loadHolds]);

  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    links.current.get(id)?.focus();
  });

  const onCancel = async (hold: Hold): Promise<void> => {
    if (billingDown || pending) return;
    const outcome = await cancel(hold);
    if (outcome.kind === "unauthenticated") {
      navigate(signInPath("/account"));
      return;
    }
    setStatus(outcome.message);
    if (outcome.kind === "cancelled") {
      focusAfter.current = hold.id;
      setHolds((all) => all?.map((h) => (h.id === hold.id ? outcome.hold : h)) ?? null);
    }
    if (outcome.kind === "not_active") await loadHolds();
  };

  const onPay = async (hold: Hold): Promise<void> => {
    if (billingDown || pending) return;
    const outcome = await pay(hold);
    if (outcome.kind === "unauthenticated") {
      navigate(signInPath("/account"));
      return;
    }
    setStatus(outcome.message);
    if (outcome.kind === "paid" || outcome.kind === "not_active") {
      await loadHolds();
      await loadRecords();
    }
  };

  // Holds and tickets fill in from their own requests: show the page once both landed, so neither pushes the next down.
  if (holds === null || tickets === null) {
    return <div className="account"><h1 className="page-title">Account</h1><p className="muted loading">Loading…</p></div>;
  }
  return (
    <div className="account">
      <h1 className="page-title">Account</h1>
      <section aria-labelledby="holds-heading">
        <h2 id="holds-heading">Holds</h2>
        <div role="status" aria-label="Hold status" className="status-line">{status}</div>
        {holds?.length === 0 && <p className="muted">No holds yet. Hold a board from its page once your cut list fits.</p>}
        <ul className="cards">
          {(holds ?? []).map((h) => {
            const label = holdLabel(h.status, h.release_reason);
            const active = h.status === "held";
            return (
              <li key={h.id} className="card hold-card">
                <div className="card-head">
                  <Link to={`/boards/${h.board}`} className="mono tag-link"
                    ref={(el) => { if (el) links.current.set(h.id, el); }}>{h.board}</Link>
                  <span className={`badge ${label.toLowerCase()}`}>{label}</span>
                </div>
                <p className="mono">${money(h.price_cents)} for {h.take_mm} mm · deposit ${money(h.deposit_cents)}</p>
                {label === "Expired" && <p className="muted">{HOLD_COPY.expired}</p>}
                {active && h.expires_at && <p>Held until {formatWhen(h.expires_at)}</p>}
                {active && (
                  <div className="card-actions">
                    <button type="button" className="primary" aria-disabled={billingDown ? true : undefined}
                      onClick={() => void onPay(h)}>
                      {pending?.id === h.id && pending.action === "pay" ? "Paying" : "Pay and cut"}
                    </button>
                    <button type="button" className="quiet" aria-disabled={billingDown ? true : undefined}
                      onClick={() => void onCancel(h)}>
                      {pending?.id === h.id && pending.action === "cancel" ? "Cancelling" : "Cancel hold"}
                    </button>
                  </div>
                )}
                {active && billingDown && <p className="paused">{HOLD_COPY.paused}</p>}
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="tickets-heading">
        <h2 id="tickets-heading">Cut tickets</h2>
        {tickets?.length === 0 && <p className="muted">No cut tickets yet.</p>}
        <ul className="rows">
          {(tickets ?? []).map((t) => (
            <li key={t.id} className="row-line">
              <Link to={`/tickets/${t.id}`} className="mono">{t.id}</Link>
              <span className="mono muted">{t.board}</span>
              <span className={`badge ${t.status}`}>{TICKET_LABELS[t.status]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="invoices-heading">
        <h2 id="invoices-heading">Invoices</h2>
        {invoices === null && <p className="muted loading">Loading…</p>}
        {invoices?.length === 0 && <p className="muted">No invoices yet.</p>}
        <ul className="cards">
          {(invoices ?? []).map((inv) => (
            <li key={inv.id} className="card invoice">
              <div className="card-head">
                <span className="mono">{inv.id}</span>
                <span className="badge paid">Paid</span>
              </div>
              <dl className="figures">
                <div><dt>Ticket</dt> <dd className="mono">{inv.ticket}</dd></div>
                <div><dt>Board</dt> <dd className="mono">{inv.board}</dd></div>
                <div><dt>Price</dt> <dd className="mono">${money(inv.price_cents)}</dd></div>
                <div><dt>Deposit</dt> <dd className="mono">${money(inv.deposit_cents)}</dd></div>
                <div><dt>Balance paid</dt> <dd className="mono">${money(inv.amount_cents)}</dd></div>
              </dl>
              <ul aria-label={`Lines on ${inv.id}`} className="lines">
                {inv.lines.map((l, i) => <li key={i}>{l.label} <span className="mono">${money(l.amount_cents)}</span></li>)}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
