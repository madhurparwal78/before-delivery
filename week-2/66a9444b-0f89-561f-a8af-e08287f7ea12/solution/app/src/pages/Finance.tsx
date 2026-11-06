// Finance: orders and refunds, invoices, vouchers and reconciliation, each a ruled table.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { dateText } from "../../shared/brussels.ts";
import { euro, parseEuros } from "../../shared/money.ts";
import { api } from "../api.ts";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader, TabPanel, Tabs } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { useSession } from "../session.tsx";
import type { Invoice, Mismatch, Order } from "../types.ts";
import { statusName } from "./Tickets.tsx";

type Tab = "orders" | "invoices" | "vouchers" | "reconciliation";
type Say = (text: string) => void;

const newKey = () => `kf-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

function OrdersTab({ say }: { say: Say }) {
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const load = useCallback(async (term: string) => {
    const r = await api.get<{ orders: Order[] }>(`/api/finance/orders?q=${encodeURIComponent(term)}`);
    if (r.ok) setOrders(r.data.orders);
  }, []);
  useEffect(() => { void load(""); }, [load]);
  const refund = async () => {
    const chosen = Object.entries(selected).filter(([, lines]) => lines.length);
    if (!chosen.length) return say("Select the lines to refund.");
    if (!reason.trim()) return say("Write a reason for the refund.");
    let refunded = 0;
    for (const [orderId, lines] of chosen) {
      const r = await api.post(`/api/finance/orders/${orderId}/refunds`, { line_ids: lines, reason: reason.trim() }, { "Idempotency-Key": `${key}-${orderId.slice(0, 8)}` });
      if (r.ok) refunded += lines.length;
      else return say(r.error === "line_not_refundable" ? "Some of those lines can't be refunded any more." : copy.financeKbDown);
    }
    setKey(newKey());
    setSelected({});
    say(copy.refundStarted(refunded));
    void load(q);
  };
  return (
    <>
      <form className="toolbar toolbar--search" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
        <Field label="Find orders" hint="Order ref or buyer email"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <button type="submit" className="button">Search</button>
      </form>
      <table aria-label="Orders" className="ruled figures cards">
        <thead><tr><th scope="col">Ref</th><th scope="col">Buyer</th><th scope="col">Status</th><th scope="col">Lines</th><th scope="col" className="num">Total</th></tr></thead>
        <tbody>
          {orders.length === 0 && (
            <tr><td colSpan={5} className="table__empty">No orders match. Search by order ref or buyer email.</td></tr>
          )}
          {orders.map((o) => (
            <tr key={o.id}>
              <td data-label="Ref">{o.ref}</td>
              <td data-label="Buyer">{o.buyer_name}</td>
              <td data-label="Status"><span className="badge" data-state={o.status}>{statusName(o.status)}</span>{o.refunds.some((r) => r.status === "pending") && <span className="hint"> {copy.refundPending}</span>}</td>
              <td data-label="Lines">
                {o.lines.map((l) => (
                  <label key={l.id} className="check check--small">
                    <input type="checkbox" disabled={l.state !== "captured" && l.state !== "transferred"} checked={(selected[o.id] ?? []).includes(l.id)}
                      onChange={(e) => setSelected({ ...selected, [o.id]: e.target.checked ? [...(selected[o.id] ?? []), l.id] : (selected[o.id] ?? []).filter((x) => x !== l.id) })} />
                    <span>{l.title} · {l.holder_name} · {euro(l.charged_cents)} · {statusName(l.state)}</span>
                  </label>
                ))}
              </td>
              <td data-label="Total" className="num">{euro(o.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar">
        <Field label="Refund reason"><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button type="button" className="button button--primary" onClick={() => void refund()}>Refund selected lines</button>
      </div>
    </>
  );
}

function InvoicesTab({ say }: { say: Say }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const r = await api.get<{ invoices: Invoice[] }>("/api/invoices");
    if (r.ok) setInvoices(r.data.invoices);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const recordReturn = async (inv: Invoice) => {
    if (!note.trim()) return say("Write a note for the bank return.");
    const r = await api.post<Invoice>(`/api/finance/invoices/${inv.id}/returns`, { note: note.trim() });
    if (r.ok) say(r.data.status === "written_off" ? copy.returnWrittenOff(inv.number) : copy.returnRetry(r.data.next_retry_at!));
    else if (r.error === "not_collected") say(`Invoice ${inv.number} hasn't been collected, so there is nothing to return.`);
    else say(copy.financeKbDown);
    void load();
  };
  return (
    <>
      <div className="toolbar"><Field label="Return note"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      <table aria-label="Invoices" className="ruled figures cards">
        <thead><tr><th scope="col">Number</th><th scope="col">Organisation</th><th scope="col">Status</th><th scope="col">Amount</th><th scope="col">Balance</th><th scope="col">Due</th><th scope="col"><span className="visually-hidden">Return</span></th></tr></thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td data-label="Number">{i.number}</td>
              <td data-label="Organisation">{i.organisation_id}</td>
              <td data-label="Status"><span className="badge" data-state={i.status}>{statusName(i.status)}</span>
                {i.status === "issued" && Date.parse(i.due_at) <= Date.now() && <span className="hint"> {copy.collectionPending}</span>}</td>
              <td data-label="Amount">{euro(i.amount_cents)}</td>
              <td data-label="Balance">{euro(i.balance_cents)}</td>
              <td data-label="Due">{dateText(Date.parse(i.due_at))}{i.next_retry_at ? ` · retry ${dateText(Date.parse(i.next_retry_at))}` : ""}</td>
              <td data-label="Return"><button type="button" className="button button--small" aria-label={`Record bank return for ${i.number}`} onClick={() => void recordReturn(i)}>Record bank return</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function VouchersTab({ say }: { say: Say }) {
  const [amount, setAmount] = useState("25.00");
  const [note, setNote] = useState("");
  const [issued, setIssued] = useState<{ code: string; balance_cents: number }[]>([]);
  const issue = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (cents === null) return say("Type an amount such as 25.00.");
    const r = await api.post<{ code: string; balance_cents: number }>("/api/finance/vouchers", { amount_cents: cents, note });
    if (r.ok) {
      say(copy.voucherIssued(r.data.code, r.data.balance_cents));
      setIssued([r.data, ...issued]);
    } else say("Vouchers are worth €0.01 to €1000.00.");
  };
  return (
    <>
      <form className="toolbar" onSubmit={(e) => void issue(e)}>
        <Field label="Amount (€)"><input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Note"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <button type="submit" className="button button--primary">Issue voucher</button>
      </form>
      <table aria-label="Vouchers issued" className="ruled figures cards">
        <thead><tr><th scope="col">Code</th><th scope="col">Balance</th></tr></thead>
        <tbody>{issued.map((v) => <tr key={v.code}><td data-label="Code">{v.code}</td><td data-label="Balance">{euro(v.balance_cents)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

function ReconciliationTab({ say }: { say: Say }) {
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const r = await api.get<{ mismatches: Mismatch[] }>("/api/finance/mismatches");
    if (r.ok) setMismatches(r.data.mismatches);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async () => {
    say(copy.reconciling);
    const r = await api.post<{ mismatches: Mismatch[] }>("/api/finance/reconciliation-runs");
    if (!r.ok) return say(copy.financeKbDown);
    await load();
    const open = await api.get<{ mismatches: Mismatch[] }>("/api/finance/mismatches?status=open");
    say(copy.reconciled(open.ok ? open.data.mismatches.length : r.data.mismatches.length));
  };
  const resolve = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return say(copy.noteMissing);
    const r = await api.post(`/api/finance/mismatches/${resolving}/resolve`, { note: note.trim() });
    if (r.ok) {
      say(copy.resolved);
      setResolving(null);
      setNote("");
    } else say(r.error === "already_resolved" ? "That mismatch is already resolved." : copy.noteMissing);
    void load();
  };
  return (
    <>
      <div className="toolbar"><button type="button" className="button button--primary" onClick={() => void run()}>Run reconciliation</button></div>
      {resolving && (
        <form className="toolbar resolve" onSubmit={(e) => void resolve(e)}>
          <Field label="Resolution note"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
          <button type="submit" className="button button--primary">Save resolution</button>
        </form>
      )}
      <table aria-label="Mismatches" className="ruled figures cards">
        <thead><tr><th scope="col">Type</th><th scope="col">Kill Bill transaction</th><th scope="col">Order</th><th scope="col">App</th><th scope="col">Kill Bill</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Resolve</span></th></tr></thead>
        <tbody>
          {mismatches.map((m) => (
            <tr key={m.id}>
              <td data-label="Type">{statusName(m.type)} · {m.transaction_type}</td>
              <td data-label="Kill Bill transaction" className="mono">{m.killbill_transaction_id ?? "—"}</td>
              <td data-label="Order">{m.order_ref ?? "—"}</td>
              <td data-label="App">{m.app_amount_cents === null ? "—" : euro(m.app_amount_cents)}</td>
              <td data-label="Kill Bill">{m.killbill_amount_cents === null ? "—" : euro(m.killbill_amount_cents)}</td>
              <td data-label="Status">{m.status === "resolved" ? `Resolved by ${m.resolved_by}: ${m.note}` : <span className="badge" data-state="open">open</span>}</td>
              <td data-label="Resolve">{m.status === "open" && (
                <button type="button" className="button button--small" aria-label={`Resolve mismatch ${m.id}`} onClick={() => setResolving(m.id)}>Resolve</button>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Finance() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>("orders");
  const [status, setStatus] = useState("");
  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title="Finance" lede="Refunds, group invoices and credit notes, gift vouchers and reconciliation with Kill Bill." />
      <Gate user={user} roles={["finance"]}>
        <div className="grid screen__body">
          <Tabs label="Finance" tabs={[["orders", "Orders and refunds"], ["invoices", "Invoices"], ["vouchers", "Vouchers"], ["reconciliation", "Reconciliation"]]}
            current={tab} onChange={(t) => { setTab(t); setStatus(""); }} />
          <p role="status" aria-label="Finance status" className="status-line">{status}</p>
          <TabPanel id={tab}>
            <div className="table-wrap">
              {tab === "orders" && <OrdersTab say={setStatus} />}
              {tab === "invoices" && <InvoicesTab say={setStatus} />}
              {tab === "vouchers" && <VouchersTab say={setStatus} />}
              {tab === "reconciliation" && <ReconciliationTab say={setStatus} />}
            </div>
          </TabPanel>
        </div>
      </Gate>
    </div>
  );
}
