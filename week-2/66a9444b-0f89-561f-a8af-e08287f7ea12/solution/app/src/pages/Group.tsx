// Group bookers: organisation totals, attendee search, the CSV export, and tables of orders, invoices and
// credit notes — all computed on the server from the caller's organisation only.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { dateText } from "../../shared/brussels.ts";
import { euro } from "../../shared/money.ts";
import { api } from "../api.ts";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader } from "../components/Screen.tsx";
import { navigate } from "../router.ts";
import { useSession } from "../session.tsx";
import type { CreditNote, Invoice, Order } from "../types.ts";
import { statusName } from "./Tickets.tsx";

type Dashboard = { organisation: { id: string; name: string }; orders: number; tickets: number; invoiced_cents: number; credited_cents: number; paid_cents: number; outstanding_cents: number };
type Attendee = { name: string; order_ref: string; line_id: string; item_title: string; state: string };

export function Group() {
  const { user } = useSession();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Attendee[] | null>(null);
  const [searchNote, setSearchNote] = useState("");
  const load = useCallback(async () => {
    const [d, o, i] = await Promise.all([
      api.get<Dashboard>("/api/group/dashboard"), api.get<{ orders: Order[] }>("/api/orders"), api.get<{ invoices: Invoice[] }>("/api/invoices"),
    ]);
    if (d.ok) setDash(d.data);
    if (o.ok) setOrders(o.data.orders);
    if (i.ok) {
      setInvoices(i.data.invoices);
      const ids = i.data.invoices.flatMap((x) => x.credit_note_ids);
      const fetched = await Promise.all(ids.map((id) => api.get<CreditNote>(`/api/credit-notes/${id}`)));
      setNotes(fetched.flatMap((r) => (r.ok ? [r.data] : [])));
    }
  }, []);
  useEffect(() => { if (user?.role === "group_booker") void load(); }, [user, load]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) { setHits(null); return setSearchNote("Type at least two letters of a name."); }
    const r = await api.get<{ attendees: Attendee[] }>(`/api/group/attendees?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) {
      setHits(r.data.attendees);
      setSearchNote(r.data.attendees.length === 1 ? "1 attendee found." : `${r.data.attendees.length} attendees found.`);
    }
  };

  const totals: [string, string][] = dash ? [
    ["Orders", String(dash.orders)], ["Tickets", String(dash.tickets)], ["Invoiced", euro(dash.invoiced_cents)],
    ["Credited", euro(dash.credited_cents)], ["Paid", euro(dash.paid_cents)], ["Outstanding", euro(dash.outstanding_cents)],
  ] : [];

  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title={dash ? dash.organisation.name : "Group"} lede="Your organisation's bookings, invoices and credit notes." />
      <Gate user={user} roles={["group_booker"]}>
        <div className="grid screen__body">
          <div className="toolbar">
            <button type="button" className="button button--primary" onClick={() => { navigate("/"); requestAnimationFrame(() => document.getElementById("schedule")?.scrollIntoView()); }}>New group booking</button>
            <a className="button" href="/api/group/export.csv" download>Export CSV</a>
          </div>
          <section aria-label="Organisation totals" className="totals">
            <dl className="totals__grid figures">
              {totals.map(([label, value]) => (
                <div key={label} className="totals__cell"><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
          <form className="toolbar" role="search" onSubmit={(e) => void search(e)}>
            <Field label="Search attendees"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
            <button type="submit" className="button">Search</button>
            <p role="status" className="status-line">{searchNote}</p>
          </form>
          {hits && (
            <table aria-label="Attendees" className="ruled cards">
              <thead><tr><th scope="col">Name</th><th scope="col">Order</th><th scope="col">Item</th><th scope="col">State</th></tr></thead>
              <tbody>{hits.map((h) => <tr key={h.line_id}><td data-label="Name">{h.name}</td><td data-label="Order">{h.order_ref}</td><td data-label="Item">{h.item_title}</td><td data-label="State">{statusName(h.state)}</td></tr>)}</tbody>
            </table>
          )}
          <h2 className="panel__title">Orders</h2>
          <table aria-label="Group orders" className="ruled figures cards">
            <thead><tr><th scope="col">Ref</th><th scope="col">Date</th><th scope="col">Tickets</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}>
                <td data-label="Ref"><a href={`/orders/${o.id}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${o.id}`); }}>{o.ref}</a></td>
                <td data-label="Date">{dateText(Date.parse(o.created_at))}</td><td data-label="Tickets">{o.lines.length}</td>
                <td data-label="Status">{statusName(o.status)}</td><td data-label="Total">{euro(o.total_cents)}</td>
              </tr>
            ))}</tbody>
          </table>
          <h2 className="panel__title">Invoices</h2>
          <table aria-label="Invoices" className="ruled figures cards">
            <thead><tr><th scope="col">Number</th><th scope="col">Status</th><th scope="col">Amount</th><th scope="col">Credited</th><th scope="col">Paid</th><th scope="col">Balance</th><th scope="col">Due</th></tr></thead>
            <tbody>{invoices.map((i) => (
              <tr key={i.id}>
                <td data-label="Number">{i.number}</td><td data-label="Status">{statusName(i.status)}</td><td data-label="Amount">{euro(i.amount_cents)}</td>
                <td data-label="Credited">{euro(i.credited_cents)}</td><td data-label="Paid">{euro(i.paid_cents)}</td><td data-label="Balance">{euro(i.balance_cents)}</td>
                <td data-label="Due">{dateText(Date.parse(i.due_at))}</td>
              </tr>
            ))}</tbody>
          </table>
          <h2 className="panel__title">Credit notes</h2>
          <table aria-label="Credit notes" className="ruled figures cards">
            <thead><tr><th scope="col">Number</th><th scope="col">Invoice</th><th scope="col">Lines</th><th scope="col">Amount</th><th scope="col">Issued</th></tr></thead>
            <tbody>{notes.map((n) => (
              <tr key={n.id}>
                <td data-label="Number">{n.number}</td><td data-label="Invoice">{invoices.find((i) => i.id === n.invoice_id)?.number ?? "—"}</td>
                <td data-label="Lines">{n.lines.map((l) => l.description).join("; ")}</td><td data-label="Amount">{euro(n.amount_cents)}</td>
                <td data-label="Issued">{dateText(Date.parse(n.issued_at))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Gate>
    </div>
  );
}
