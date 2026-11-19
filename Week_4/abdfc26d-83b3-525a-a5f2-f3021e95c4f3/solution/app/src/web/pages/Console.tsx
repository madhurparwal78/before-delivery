import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { dollars, monthName } from "../../shared/rules";
import { api, IdempotentAction, type LedgerEntry, type Order, type Render, type ServiceCheck, type SplitRow } from "../api";
import { Dialog, ErrorSummary, FieldError, LiveStatus, useAnnouncer, type Announcer } from "../components/ui";
import { copy, money } from "../copy";

const TABS = ["Orders", "Credit ledger", "Renders", "Statements"] as const;
type Tab = (typeof TABS)[number];

/** Amounts carry a written sign and a word, never colour alone. */
const signed = (cents: number): string => (cents < 0 ? `− ${money(-cents)}` : `+ ${money(cents)}`);

export function Console() {
  const [tab, setTab] = useState<Tab>("Orders");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const announcer = useAnnouncer();
  const onTabKey = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next = -1;
    if (event.key in moves) next = (index + (moves[event.key] ?? 0) + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next] as Tab);
    tabs.current[next]?.focus();
  };
  return (
    <div className="page console-page">
      <header className="page-head">
        <p className="eyebrow"><span className="eyebrow-name">Console · Brightmoss Works</span></p>
        <h1 className="display display-md">Keep sales honest.</h1>
      </header>
      <ServiceNotices />
      <LiveStatus label="Console status" announcer={announcer} />
      <div role="tablist" aria-label="Console" className="tabs">
        {TABS.map((name, i) => (
          <button
            key={name}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${i}`}
            aria-selected={tab === name}
            aria-controls={`panel-${i}`}
            tabIndex={tab === name ? 0 : -1}
            className="tab"
            onClick={() => setTab(name)}
            onKeyDown={(event) => onTabKey(event, i)}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${TABS.indexOf(tab)}`} aria-labelledby={`tab-${TABS.indexOf(tab)}`} className="tab-panel">
        {tab === "Orders" ? <OrdersTab announcer={announcer} /> : null}
        {tab === "Credit ledger" ? <LedgerTab /> : null}
        {tab === "Renders" ? <RendersTab /> : null}
        {tab === "Statements" ? <StatementsTab announcer={announcer} /> : null}
      </div>
    </div>
  );
}

function ServiceNotices() {
  const [services, setServices] = useState<ServiceCheck[]>([]);
  useEffect(() => {
    const load = () => void api<{ services: ServiceCheck[] }>("GET", "/api/admin/services").then((r) => r.ok && setServices(r.data.services));
    load();
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const down = services.filter((s) => !s.reachable);
  return (
    <section className="service-notices" aria-label="Service notices">
      {down.length === 0 ? (
        <p className="muted all-clear">Every service answered its latest check.</p>
      ) : (
        down.map((s) => (
          <div key={s.name} className="banner">
            {copy.banners[s.name]}
          </div>
        ))
      )}
    </section>
  );
}

const ORDER_STATE: Record<Order["state"], string> = {
  held: "Held",
  paying: "Paying",
  paid: "Paid",
  invoiced: "Invoiced",
  receipted: "Receipted",
  refunded: "Refunded",
  expired: "Expired",
  failed: "Failed",
};

function OrdersTab({ announcer }: { announcer: Announcer }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [refunding, setRefunding] = useState<Order | null>(null);
  const [splitsOf, setSplitsOf] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(() => void api<{ orders: Order[] }>("GET", "/api/admin/orders").then((r) => r.ok && setOrders(r.data.orders)), []);
  useEffect(load, [load]);
  if (!orders) return <div className="table-skeleton" aria-busy="true" />;
  if (!orders.length) return <p className="empty-sentence">No orders yet.</p>;
  return (
    <div className="table-scroll">
      <table className="data-table stack-on-phone orders-table">
        <caption className="visually-hidden">Orders</caption>
        <thead>
          <tr>
            <th scope="col">Piece</th><th scope="col">Buyer</th><th scope="col">State</th><th scope="col">Invoice</th>
            <th scope="col" className="num">Net</th><th scope="col" className="num">Refunded</th><th scope="col" className="num">Gross</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRows
              key={order.id}
              order={order}
              open={splitsOf === order.id}
              onSplits={() => setSplitsOf(splitsOf === order.id ? null : order.id)}
              onRefund={(button) => {
                opener.current = button;
                setRefunding(order);
              }}
            />
          ))}
        </tbody>
      </table>
      {refunding ? (
        <RefundDialog
          order={refunding}
          opener={opener}
          onClose={() => setRefunding(null)}
          onDone={(line) => {
            setRefunding(null);
            announcer.say(line);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function OrderRows({ order, open, onSplits, onRefund }: { order: Order; open: boolean; onSplits: () => void; onRefund: (button: HTMLButtonElement) => void }) {
  const [rows, setRows] = useState<SplitRow[] | null>(null);
  useEffect(() => {
    if (open) void api<{ rows: SplitRow[] }>("GET", `/api/admin/orders/${order.id}/splits`).then((r) => r.ok && setRows(r.data.rows));
  }, [open, order.id]);
  const paid = order.paid_at !== null;
  return (
    <>
      <tr>
        <td data-label="Piece"><span className="table-title">{order.piece_title}</span> <span className="muted tabular">#{order.edition} of {order.edition_count}</span></td>
        <td data-label="Buyer">{order.billing_name ?? "—"}<span className="muted block">{order.email ?? ""}{order.billing_country ? ` · ${order.billing_country}` : ""}</span></td>
        <td data-label="State"><span className={`badge badge-${order.state}`}>{ORDER_STATE[order.state]}</span></td>
        <td data-label="Invoice" className="tabular">{order.invoice_number ?? "—"}</td>
        <td data-label="Net" className="num tabular">{money(order.net_cents)}</td>
        <td data-label="Refunded" className="num tabular">{order.refunded_net_cents ? `refund ${signed(-order.refunded_net_cents)}` : "—"}</td>
        <td data-label="Gross" className="num tabular">{money(order.gross_cents)}</td>
        <td data-label="Actions">
          <div className="row-actions">
            {paid ? (
              <button type="button" className="button button-ghost" aria-expanded={open} onClick={onSplits}>
                Splits
              </button>
            ) : null}
            {order.state === "receipted" ? (
              <button type="button" className="button button-ghost" onClick={(event) => onRefund(event.currentTarget)}>
                Refund
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="split-detail">
          <td colSpan={8}>
            {rows ? (
              <table className="data-table inner-table">
                <caption>Split rows for {order.piece_title} #{order.edition} · net {money(order.net_cents)}</caption>
                <thead><tr><th scope="col">Party</th><th scope="col">Holder</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th></tr></thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td>{row.party}</td><td>{row.holder}</td><td>{row.kind}</td><td className="num tabular">{signed(row.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Loading split rows</p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RefundDialog({ order, opener, onClose, onDone }: { order: Order; opener: React.RefObject<HTMLButtonElement | null>; onClose: () => void; onDone: (line: string) => void }) {
  const remaining = order.net_cents - order.refunded_net_cents;
  const [amount, setAmount] = useState(dollars(remaining).replace(/,/g, ""));
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const action = useRef(new IdempotentAction());
  const ids = { net_cents: useId(), reason: useId() };
  const announcer = useAnnouncer();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const match = /^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(amount.trim().replace(/,/g, ""));
    const cents = match ? Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0")) : NaN;
    if (!match || cents < 1 || cents > remaining) {
      setFields({ net_cents: copy.refundRange(remaining) });
      return;
    }
    setBusy(true);
    const result = await action.current.send<{ refund: { credit_note_number: string } }>("POST", `/api/admin/orders/${order.id}/refunds`, { net_cents: cents, reason });
    setBusy(false);
    if (result.ok) return onDone(copy.refundIssued(result.data.refund.credit_note_number));
    if (result.status === 422) setFields(result.error.code === "validation_failed" && result.error.fields?.net_cents ? { net_cents: copy.refundRange(remaining) } : result.error.fields ?? {});
    else if (result.error.code === "refund_window_closed") announcer.say(copy.refundClosed);
    else if (result.status === 503) announcer.say("Kill Bill is unreachable, so refunds are paused. Nothing was refunded.");
    else announcer.say(result.error.message);
  };

  return (
    <Dialog open label="Refund order" onClose={onClose} returnFocus={opener} initialFocus="[data-autofocus]">
      <p className="sheet-line">{order.piece_title} — edition {order.edition} of {order.edition_count} · {order.invoice_number}</p>
      <form className="sheet-form" onSubmit={(event) => void submit(event)} noValidate>
        <ErrorSummary fields={fields} ids={ids} />
        <label htmlFor={ids.net_cents}>Refund amount (USD)</label>
        <input id={ids.net_cents} data-autofocus type="text" inputMode="decimal" value={amount} aria-invalid={Boolean(fields.net_cents)}
          aria-describedby={`${ids.net_cents}-hint`} onChange={(e) => setAmount(e.target.value)} />
        <p id={`${ids.net_cents}-hint`} className="muted small">Net amount, up to {money(remaining)}. VAT at {order.vat_rate_percent}% is refunded with it.</p>
        <FieldError id={`${ids.net_cents}-error`} message={fields.net_cents} />
        <label htmlFor={ids.reason}>Reason (optional)</label>
        <textarea id={ids.reason} value={reason} maxLength={300} rows={3} onChange={(e) => setReason(e.target.value)} />
        <FieldError id={`${ids.reason}-error`} message={fields.reason} />
        <div className="sheet-actions">
          <button type="submit" className="button button-accent" disabled={busy}>Issue refund</button>
        </div>
        <LiveStatus label="Refund status" announcer={announcer} />
      </form>
    </Dialog>
  );
}

function LedgerTab() {
  const [ledger, setLedger] = useState<{ accounts: { account: string; balance: number }[]; entries: LedgerEntry[] } | null>(null);
  useEffect(() => void api<NonNullable<typeof ledger>>("GET", "/api/admin/credit-ledger").then((r) => r.ok && setLedger(r.data)), []);
  if (!ledger) return <div className="table-skeleton" aria-busy="true" />;
  const sums = new Map<string, number>();
  for (const entry of ledger.entries) for (const row of entry.rows) sums.set(row.account, (sums.get(row.account) ?? 0) + row.amount);
  return (
    <>
      <table className="data-table stack-on-phone">
        <caption className="table-caption">Balances</caption>
        <thead><tr><th scope="col">Account</th><th scope="col" className="num">Balance</th><th scope="col" className="num">Sum of rows</th><th scope="col">Check</th></tr></thead>
        <tbody>
          {ledger.accounts.map((a) => (
            <tr key={a.account}>
              <td data-label="Account" className="mono">{a.account}</td>
              <td data-label="Balance" className="num tabular">{a.balance}</td>
              <td data-label="Sum of rows" className="num tabular">{sums.get(a.account) ?? 0}</td>
              <td data-label="Check">{(sums.get(a.account) ?? 0) === a.balance ? "Balanced" : "Out of balance"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="data-table stack-on-phone">
        <caption className="table-caption">Entries, newest first</caption>
        <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col" className="num">Credits</th></tr></thead>
        <tbody>
          {ledger.entries.slice(0, 200).map((e) => {
            const debit = e.rows.find((r) => r.amount < 0) ?? e.rows[0];
            const credit = e.rows.find((r) => r.amount > 0) ?? e.rows[1];
            return (
              <tr key={e.id}>
                <td data-label="When" className="tabular">{e.created_at.slice(0, 16).replace("T", " ")}</td>
                <td data-label="Kind">{e.kind}</td>
                <td data-label="Debit" className="mono">debit {debit?.account}</td>
                <td data-label="Credit" className="mono">credit {credit?.account}</td>
                <td data-label="Credits" className="num tabular">{Math.abs(credit?.amount ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

const RENDER_STATE: Record<Render["state"], string> = {
  accepted: "Accepted",
  queued: "Queued",
  rendering: "Rendering",
  stored: "Stored",
  ready: "Ready",
  failed: "Failed",
  timed_out: "Timed out",
  credits_released: "Credits released",
};

function RendersTab() {
  const [renders, setRenders] = useState<Render[] | null>(null);
  useEffect(() => void api<{ renders: Render[] }>("GET", "/api/admin/renders").then((r) => r.ok && setRenders(r.data.renders)), []);
  if (!renders) return <div className="table-skeleton" aria-busy="true" />;
  return (
    <table className="data-table stack-on-phone">
      <caption className="visually-hidden">Renders</caption>
      <thead><tr><th scope="col">Piece</th><th scope="col">Export</th><th scope="col">State</th><th scope="col">Why it ended</th><th scope="col" className="num">Attempts</th><th scope="col" className="num">Credits</th></tr></thead>
      <tbody>
        {renders.map((r) => (
          <tr key={r.id}>
            <td data-label="Piece">{r.piece_slug}</td>
            <td data-label="Export" className="tabular">{r.aspect} · {r.resolution} · {r.duration_s} s · {r.format.toUpperCase()}</td>
            <td data-label="State"><span className={`badge badge-${r.state}`}>{RENDER_STATE[r.state]}</span></td>
            <td data-label="Why it ended">{r.failure_reason ? r.failure_reason.replace("_", " ") : "—"}</td>
            <td data-label="Attempts" className="num tabular">{r.attempts}</td>
            <td data-label="Credits" className="num tabular">{r.cost_credits}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Period {
  period: string;
  status: "open" | "closed";
  creators: number | null;
  closed_at: string | null;
}

function StatementsTab({ announcer }: { announcer: Announcer }) {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void api<{ periods: Period[] }>("GET", "/api/admin/statements").then((r) => r.ok && setPeriods(r.data.periods)), []);
  useEffect(load, [load]);
  const close = async (period: string) => {
    setBusy(true);
    const result = await api<{ creators: number }>("POST", "/api/admin/statements", { period });
    setBusy(false);
    if (result.ok) announcer.say(copy.statementsSent(period, result.data.creators));
    else if (result.error.code === "period_open") announcer.say(copy.periodOpen(period));
    else announcer.say(result.error.message);
    load();
  };
  if (!periods) return <div className="table-skeleton" aria-busy="true" />;
  if (!periods.length) return <p className="empty-sentence">No sales to state yet.</p>;
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <table className="data-table stack-on-phone">
      <caption className="visually-hidden">Payout statements</caption>
      <thead><tr><th scope="col">Month</th><th scope="col">Status</th><th scope="col" className="num">Creators</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
      <tbody>
        {periods.map((p) => (
          <tr key={p.period}>
            <td data-label="Month">{monthName(p.period)}</td>
            <td data-label="Status">{p.status === "closed" ? `Closed ${p.closed_at?.slice(0, 10) ?? ""}` : p.period === thisMonth ? "Open (month running)" : "Open"}</td>
            <td data-label="Creators" className="num tabular">{p.creators ?? "—"}</td>
            <td data-label="Actions">
              {p.status === "open" ? (
                <button type="button" className="button button-ghost" disabled={busy} onClick={() => void close(p.period)}>
                  Close {monthName(p.period)}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
