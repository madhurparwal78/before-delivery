// The specialist, cashier and admin desks.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ApiError, HistoryRow, Lot, UNEXPECTED, amount, announce, api, euros, rotterdam, rotterdamToIso, stamp,
} from "./lib";
import { useResource } from "./resource";
import { EmptyState, Modal, Shell } from "./ui";
import { InvoiceJson } from "./pages-member";

function Loading({ label }: { label: string }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label={label}>
      <div class="skeleton-block" />
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ComponentChildren }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {error && (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return text ? <p class="form-message">{text}</p> : null;
}

const describe = (id: string, error?: string) => ({ "aria-invalid": error ? ("true" as const) : undefined, "aria-describedby": error ? `${id}-error` : undefined });

// ---- specialist ----

const PORTRAITS: [string, string][] = [
  ["chronograph", "Chronograph dial"], ["rangefinder", "Pocket rangefinder"], ["diver", "Diver's bezel"],
  ["twin_lens", "Twin-lens reflex"], ["dress", "Dress watch"], ["bellows", "Folding bellows camera"],
];

interface DeskSale {
  id: string;
  title: string;
  state: string;
  lots: Lot[];
}

function useDeskLots() {
  return {
    intake: useResource<{ lots: Lot[] }>("/api/desk/lots?state=intake", () => false),
    estimated: useResource<{ lots: Lot[] }>("/api/desk/lots?state=estimated", () => false),
    sales: useResource<{ sales: DeskSale[] }>("/api/desk/sales", () => false),
  };
}

export function SpecialistPage() {
  const { intake, estimated, sales } = useDeskLots();
  const [selected, setSelected] = useState<Lot | null>(null);
  const [form, setForm] = useState({ low: "", high: "", opening: "", reserve: "", condition: "", portrait: "chronograph" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [estimateMessage, setEstimateMessage] = useState("");
  const [saleForm, setSaleForm] = useState({ title: "", ends: "", first: "" });
  const [saleErrors, setSaleErrors] = useState<Record<string, string>>({});
  const [saleMessage, setSaleMessage] = useState("");
  const [saleId, setSaleId] = useState("");
  const [busy, setBusy] = useState(false);

  if (!intake.data || !estimated.data || !sales.data) return <Shell><main class="desk three"><Loading label="Loading the specialist desk" /></main></Shell>;
  const drafts = sales.data.sales.filter((s) => s.state === "draft");
  const sale = drafts.find((s) => s.id === saleId) ?? drafts[0];
  const placedIds = new Set((sale?.lots ?? []).map((l) => l.id));
  const available = estimated.data.lots.filter((l) => !placedIds.has(l.id));
  const waiting = [...intake.data.lots, ...estimated.data.lots];

  const refresh = () => Promise.all([intake.reload(), estimated.reload(), sales.reload()]);
  const say = (set: (t: string) => void, text: string) => {
    set(text);
    announce(text);
  };

  const pick = (lot: Lot) => {
    setSelected(lot);
    setErrors({});
    setEstimateMessage("");
    setForm({
      low: lot.estimate_low != null ? String(lot.estimate_low) : "",
      high: lot.estimate_high != null ? String(lot.estimate_high) : "",
      opening: lot.opening_bid != null ? String(lot.opening_bid) : "",
      reserve: lot.reserve != null ? String(lot.reserve) : "",
      condition: lot.condition ?? "",
      portrait: lot.portrait ?? "chronograph",
    });
  };

  const whole = (v: string): number | string => (/^\d{1,12}$/.test(v.trim()) ? Number(v.trim()) : v);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setErrors({});
    setEstimateMessage("");
    try {
      await api(`/api/desk/lots/${selected.id}/estimate`, {
        method: "PUT",
        body: {
          estimate_low: whole(form.low), estimate_high: whole(form.high), opening_bid: whole(form.opening), reserve: whole(form.reserve),
          condition: form.condition, portrait: form.portrait,
        },
      });
      await refresh();
      say(setEstimateMessage, `Estimate saved for ${selected.title}.`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        Object.values(err.fields).forEach(announce);
      } else say(setEstimateMessage, err instanceof ApiError && err.status === 409 ? err.message : UNEXPECTED);
    }
    setBusy(false);
  };

  const createSale = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setSaleErrors({});
    setSaleMessage("");
    const iso = rotterdamToIso(saleForm.ends);
    if (!iso) {
      const text = "Enter the end as YYYY-MM-DD HH:MM, Rotterdam time.";
      setSaleErrors({ ends_at: text });
      announce(text);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ sale: DeskSale }>("/api/desk/sales", {
        method: "POST", body: { title: saleForm.title, ends_at: iso, first_lot_number: whole(saleForm.first) },
      });
      await refresh();
      setSaleId(res.sale.id);
      say(setSaleMessage, `Sale ${res.sale.title} created.`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setSaleErrors(err.fields);
        Object.values(err.fields).forEach(announce);
      } else say(setSaleMessage, UNEXPECTED);
    }
    setBusy(false);
  };

  const order = async (ids: string[]) => {
    if (!sale || busy) return;
    setBusy(true);
    try {
      await api(`/api/desk/sales/${sale.id}/lots`, { method: "PUT", body: { lot_ids: ids } });
      await refresh();
    } catch (err) {
      say(setSaleMessage, err instanceof ApiError && err.status === 409 ? err.message : UNEXPECTED);
    }
    setBusy(false);
  };
  const ids = (sale?.lots ?? []).map((l) => l.id);
  const move = (index: number, by: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item as string);
    void order(next);
  };

  const publish = async () => {
    if (!sale || busy) return;
    setBusy(true);
    setSaleMessage("");
    try {
      const res = await api<{ lots: Lot[] }>(`/api/desk/sales/${sale.id}/publish`, { method: "POST" });
      await refresh();
      say(setSaleMessage, `Sale published. ${res.lots.length} lots are open.`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) say(setSaleMessage, Object.values(err.fields)[0] ?? UNEXPECTED);
      else say(setSaleMessage, err instanceof ApiError && err.status === 409 ? err.message : UNEXPECTED);
    }
    setBusy(false);
  };

  return (
    <Shell>
      <main class="desk">
        <h1 class="display">SPECIALIST DESK</h1>
        <div class="specialist">
          <section class="panel region-intake" aria-labelledby="p-intake">
            <h2 id="p-intake">Intake</h2>
            {waiting.length === 0 && <p class="muted">Nothing is waiting for you.</p>}
            <ul class="rows">
              {waiting.map((lot) => (
                <li key={lot.id}>
                  <button type="button" class="outline-btn" aria-label={`Estimate ${lot.title}`} onClick={() => pick(lot)}>
                    {lot.title}
                  </button>
                  <span class="muted">{lot.state === "intake" ? "Waiting for an estimate" : "Estimated"}</span>
                </li>
              ))}
            </ul>
          </section>
          <section class="panel region-estimate" aria-labelledby="p-estimate">
            <h2 id="p-estimate">Estimate</h2>
            {selected ? (
              <form class="stack" onSubmit={save} noValidate>
                <p class="muted">{selected.title}</p>
                <Field id="est-low" label="Low estimate" error={errors.estimate_low}>
                  <input id="est-low" type="text" inputMode="numeric" value={form.low} {...describe("est-low", errors.estimate_low)} onInput={(e) => setForm({ ...form, low: e.currentTarget.value })} />
                </Field>
                <Field id="est-high" label="High estimate" error={errors.estimate_high}>
                  <input id="est-high" type="text" inputMode="numeric" value={form.high} {...describe("est-high", errors.estimate_high)} onInput={(e) => setForm({ ...form, high: e.currentTarget.value })} />
                </Field>
                <Field id="est-opening" label="Opening bid" error={errors.opening_bid}>
                  <input id="est-opening" type="text" inputMode="numeric" value={form.opening} {...describe("est-opening", errors.opening_bid)} onInput={(e) => setForm({ ...form, opening: e.currentTarget.value })} />
                </Field>
                <Field id="est-reserve" label="Reserve" error={errors.reserve}>
                  <input id="est-reserve" type="text" inputMode="numeric" value={form.reserve} {...describe("est-reserve", errors.reserve)} onInput={(e) => setForm({ ...form, reserve: e.currentTarget.value })} />
                </Field>
                <Field id="est-condition" label="Condition notes" error={errors.condition}>
                  <textarea id="est-condition" rows={3} value={form.condition} {...describe("est-condition", errors.condition)} onInput={(e) => setForm({ ...form, condition: e.currentTarget.value })} />
                </Field>
                <Field id="est-portrait" label="Portrait" error={errors.portrait}>
                  <select id="est-portrait" value={form.portrait} {...describe("est-portrait", errors.portrait)} onChange={(e) => setForm({ ...form, portrait: e.currentTarget.value })}>
                    {PORTRAITS.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="submit" class="outline-btn" aria-busy={busy ? "true" : undefined}>
                  Save estimate
                </button>
                <Notice text={estimateMessage} />
              </form>
            ) : (
              <p class="muted">Choose a lot from Intake to estimate it.</p>
            )}
          </section>
          <section class="panel region-sale" aria-labelledby="p-sale">
            <h2 id="p-sale">Sale order</h2>
            <form class="stack" onSubmit={createSale} noValidate>
              <Field id="sale-title" label="Sale title" error={saleErrors.title}>
                <input id="sale-title" type="text" value={saleForm.title} {...describe("sale-title", saleErrors.title)} onInput={(e) => setSaleForm({ ...saleForm, title: e.currentTarget.value })} />
              </Field>
              <Field id="sale-ends" label="Sale ends" error={saleErrors.ends_at}>
                <input id="sale-ends" type="text" placeholder="2026-11-12 20:00" value={saleForm.ends} {...describe("sale-ends", saleErrors.ends_at)} onInput={(e) => setSaleForm({ ...saleForm, ends: e.currentTarget.value })} />
              </Field>
              <Field id="sale-first" label="First lot number" error={saleErrors.first_lot_number}>
                <input id="sale-first" type="text" inputMode="numeric" value={saleForm.first} {...describe("sale-first", saleErrors.first_lot_number)} onInput={(e) => setSaleForm({ ...saleForm, first: e.currentTarget.value })} />
              </Field>
              <button type="submit" class="outline-btn">
                Create sale
              </button>
            </form>
            <Field id="sale-pick" label="Sale">
              <select id="sale-pick" value={sale?.id ?? ""} onChange={(e) => setSaleId(e.currentTarget.value)}>
                {drafts.length === 0 && <option value="">No draft sale</option>}
                {drafts.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <ol class="rows" aria-label="Catalogue order">
              {(sale?.lots ?? []).map((lot, i) => (
                <li key={lot.id}>
                  <span>{lot.title}</span>
                  <span class="actions">
                    <button type="button" class="outline-btn small" aria-label={`Move ${lot.title} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      Up
                    </button>
                    <button type="button" class="outline-btn small" aria-label={`Move ${lot.title} down`} disabled={busy || i === ids.length - 1} onClick={() => move(i, 1)}>
                      Down
                    </button>
                    <button type="button" class="outline-btn small" aria-label={`Remove ${lot.title} from sale`} disabled={busy} onClick={() => void order(ids.filter((x) => x !== lot.id))}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            {sale && available.length > 0 && (
              <ul class="rows">
                {available.map((lot) => (
                  <li key={lot.id}>
                    <span>{lot.title}</span>
                    <button type="button" class="outline-btn small" aria-label={`Add ${lot.title} to sale`} disabled={busy} onClick={() => void order([...ids, lot.id])}>
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" class="gold-btn" onClick={publish} aria-busy={busy ? "true" : undefined}>
              Publish sale
            </button>
            <Notice text={saleMessage} />
          </section>
        </div>
      </main>
    </Shell>
  );
}

// ---- cashier ----

type Filter = "issued" | "paid" | "all";

const METHODS: [string, string][] = [["bank_transfer", "Bank transfer"], ["card", "Card at the counter"], ["cash", "Cash"]];

/** The Show filter is part of the address: any `show` other than paid or all is Unpaid. */
function filterFromAddress(): Filter {
  const show = new URLSearchParams(window.location.search).get("show");
  return show === "paid" || show === "all" ? show : "issued";
}

export function CashierPage() {
  const [filter, setFilter] = useState<Filter>(filterFromAddress);
  const [selectedId, setSelectedId] = useState("");
  const [payment, setPayment] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const all = useResource<{ invoices: InvoiceJson[] }>("/api/desk/invoices", () => true);
  useLayoutEffect(() => {
    const follow = () => setFilter(filterFromAddress());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  const choose = (value: Filter) => {
    window.history.pushState(null, "", value === "issued" ? "/desk/cashier" : `/desk/cashier?show=${value}`);
    setFilter(value);
  };
  if (!all.data) return <Shell><main class="desk"><Loading label="Loading the cashier desk" /></main></Shell>;
  const invoices = all.data.invoices;
  const shown = invoices.filter((i) => filter === "all" || i.status === filter);
  const defaults = invoices.filter((i) => i.status === "defaulted");
  const selected = invoices.find((i) => i.id === selectedId);

  const record = async (e: Event) => {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api<{ payment: { amount: string }; invoice: InvoiceJson }>(`/api/desk/invoices/${selected.id}/payments`, {
        method: "POST", body: { amount: payment.trim(), method },
      });
      const text =
        res.invoice.status === "paid"
          ? `Payment of ${amount(res.payment.amount)} recorded. Invoice ${res.invoice.number} is paid.`
          : `Payment of ${amount(res.payment.amount)} recorded. ${amount(res.invoice.outstanding)} outstanding.`;
      setMessage(text);
      announce(text);
      setPayment("");
      all.reload();
    } catch (err) {
      const text = err instanceof ApiError && (err.fields.amount || err.status === 409) ? (err.fields.amount ?? err.message) : UNEXPECTED;
      setError(text);
      announce(text);
    }
    setBusy(false);
  };

  return (
    <Shell>
      <main class="desk">
        <h1 class="display">CASHIER DESK</h1>
        <div class="cashier">
          <section class="panel region-invoices" aria-labelledby="p-invoices">
            <h2 id="p-invoices">Invoices</h2>
            <fieldset role="radiogroup" aria-label="Show" class="inline-choices">
              {([["issued", "Unpaid"], ["paid", "Paid"], ["all", "All"]] as [Filter, string][]).map(([value, label]) => (
                <label class="choice" key={value}>
                  <input type="radio" name="show" checked={filter === value} onChange={() => choose(value)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            {invoices.length === 0 ? (
              <EmptyState line="NO INVOICES YET">Invoices appear when a sale's last lot closes.</EmptyState>
            ) : (
              <div class="stack-table" style="--cols: 4" role="table" aria-label="Invoices">
                <div class="head" role="row">
                  <span role="columnheader">Invoice</span>
                  <span role="columnheader">Buyer</span>
                  <span role="columnheader">Total</span>
                  <span role="columnheader">Status</span>
                </div>
                {shown.map((inv) => (
                  <div class="body-row" role="row" key={inv.id}>
                    <span role="cell" data-label="Invoice">
                      <a
                        href={`/desk/cashier?invoice=${inv.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          setSelectedId(inv.id);
                          setMessage("");
                          setError("");
                        }}
                      >{`Invoice ${inv.number}`}</a>
                    </span>
                    <span role="cell" data-label="Buyer">{`${inv.bidder_name ?? ""} · Paddle ${inv.paddle ?? ""}`}</span>
                    <span role="cell" data-label="Total">{amount(inv.total)}</span>
                    <span role="cell" data-label="Status">{{ issued: "Unpaid", paid: "Paid", defaulted: "Defaulted" }[inv.status]}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section class="panel region-detail" aria-labelledby="p-detail">
            <h2 id="p-detail">Payment</h2>
            {selected ? (
              <form class="stack" onSubmit={record} noValidate>
                <p>{`Invoice ${selected.number} · ${selected.bidder_name ?? ""}`}</p>
                <p class="muted">{`Total ${amount(selected.total)} · Paid ${amount(selected.paid)} · Outstanding ${amount(selected.outstanding)} · Due ${rotterdam(selected.due_at)}`}</p>
                <Field id="pay-amount" label="Payment amount" error={error}>
                  <input id="pay-amount" type="text" inputMode="decimal" value={payment} {...describe("pay-amount", error)} onInput={(e) => setPayment(e.currentTarget.value)} />
                </Field>
                <Field id="pay-method" label="Method">
                  <select id="pay-method" value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
                    {METHODS.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="submit" class="gold-btn" aria-busy={busy ? "true" : undefined}>
                  Record payment
                </button>
              </form>
            ) : (
              <p class="muted">Choose an invoice to record a payment.</p>
            )}
            <Notice text={message} />
          </section>
          <section class="panel region-defaults" aria-labelledby="p-defaults">
            <h2 id="p-defaults">Defaults</h2>
            {defaults.length === 0 && <p class="muted">No defaults.</p>}
            <ul class="rows">
              {defaults.map((inv) => (
                <li key={inv.id}>
                  <span>{`Invoice ${inv.number} · Paddle ${inv.paddle ?? ""} · Defaulted ${rotterdam(inv.due_at)}`}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </Shell>
  );
}

// ---- admin ----

interface Pending {
  id: string;
  full_name: string;
  phone: string;
}

interface StatementRow {
  id: string;
  number: string;
  status: string;
  sale_title: string;
}

export function AdminPage() {
  const registrations = useResource<{ registrations: Pending[] }>("/api/admin/registrations?status=pending", () => false);
  const lotsList = useResource<{ lots: Lot[] }>("/api/admin/lots", () => false);
  const statements = useResource<{ statements: StatementRow[] }>("/api/admin/statements", () => false);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({});
  const [approveMessage, setApproveMessage] = useState("");
  const [lotId, setLotId] = useState("");
  const [bids, setBids] = useState<{ lot: Lot; bids: HistoryRow[] } | null>(null);
  const [removing, setRemoving] = useState<HistoryRow | null>(null);
  const [reason, setReason] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [removeMessage, setRemoveMessage] = useState("");
  const [statementMessage, setStatementMessage] = useState("");
  const [correcting, setCorrecting] = useState<StatementRow | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const loadedFor = useRef("");

  const lots = lotsList.data?.lots ?? [];
  const chosen = lotId || lots[0]?.id || "";
  const loadBids = async (id: string) => {
    try {
      const res = await api<{ lot: Lot; bids: HistoryRow[] }>(`/api/admin/lots/${id}/bids`);
      setBids({ lot: stamp(res.lot), bids: res.bids });
    } catch {
      setBids(null);
    }
  };
  useLayoutEffect(() => {
    if (chosen && loadedFor.current !== chosen) {
      loadedFor.current = chosen;
      void loadBids(chosen);
    }
  });

  if (!registrations.data || !lotsList.data || !statements.data) return <Shell><main class="desk"><Loading label="Loading the admin desk" /></main></Shell>;

  const say = (set: (t: string) => void, text: string) => {
    set(text);
    announce(text);
  };

  const approve = async (reg: Pending) => {
    setApproveErrors({ ...approveErrors, [reg.id]: "" });
    setApproveMessage("");
    const raw = (limits[reg.id] ?? "").trim();
    try {
      const res = await api<{ registration: { paddle: number; spending_limit: number } }>(`/api/admin/registrations/${reg.id}/approve`, {
        method: "POST", body: { spending_limit: /^\d{1,12}$/.test(raw) ? Number(raw) : raw },
      });
      say(setApproveMessage, `Paddle ${res.registration.paddle} approved with a spending limit of ${euros(res.registration.spending_limit)}.`);
      registrations.reload();
    } catch (err) {
      const text = err instanceof ApiError && err.fields.spending_limit ? err.fields.spending_limit : UNEXPECTED;
      setApproveErrors({ ...approveErrors, [reg.id]: text });
      announce(text);
    }
  };

  const remove = async (e: Event) => {
    e.preventDefault();
    if (!removing) return;
    setRemoveError("");
    try {
      const res = await api<{ lot: Lot; bids: HistoryRow[] }>(`/api/admin/bids/${removing.bid_id}/remove`, { method: "POST", body: { reason } });
      setRemoving(null);
      setReason("");
      setBids({ lot: stamp(res.lot), bids: res.bids });
      const n = res.lot.lot_number;
      say(setRemoveMessage, res.lot.price != null ? `Bid removed. Lot ${n} now ${euros(res.lot.price)}.` : `Bid removed. Lot ${n} has no bids.`);
    } catch (err) {
      setRemoveError(err instanceof ApiError && err.fields.reason ? err.fields.reason : err instanceof ApiError && err.status === 409 ? err.message : UNEXPECTED);
    }
  };

  const issue = async (s: StatementRow) => {
    try {
      await api(`/api/admin/statements/${s.id}/issue`, { method: "POST" });
      say(setStatementMessage, `Statement ${s.number} issued.`);
    } catch (err) {
      say(setStatementMessage, err instanceof ApiError && err.code === "statement_locked" ? `Statement ${s.number} is issued and locked.` : UNEXPECTED);
    }
    statements.reload();
  };

  const correct = async (e: Event) => {
    e.preventDefault();
    if (!correcting) return;
    setNoteError("");
    try {
      const res = await api<{ statement: StatementRow; superseded: StatementRow }>(`/api/admin/statements/${correcting.id}/correct`, { method: "POST", body: { note } });
      say(setStatementMessage, `Statement ${res.statement.number} issued, replacing ${res.superseded.number}.`);
      setCorrecting(null);
      setNote("");
      statements.reload();
    } catch (err) {
      setNoteError(err instanceof ApiError && err.fields.note ? err.fields.note : UNEXPECTED);
    }
  };

  return (
    <Shell>
      <main class="desk">
        <h1 class="display">ADMIN DESK</h1>
        <div class="admin">
          <div class="admin-left">
            <section class="panel" aria-labelledby="p-pending">
              <h2 id="p-pending">Pending registrations</h2>
              {registrations.data.registrations.length === 0 ? (
                <p class="muted">No bidders are waiting.</p>
              ) : (
                <div class="stack-table" style="--cols: 3" role="table" aria-label="Pending registrations">
                  <div class="head" role="row">
                    <span role="columnheader">Bidder</span>
                    <span role="columnheader">Spending limit</span>
                    <span role="columnheader">Approve</span>
                  </div>
                  {registrations.data.registrations.map((reg) => (
                    <div class="body-row" role="row" key={reg.id}>
                      <span role="cell" data-label="Bidder">{`${reg.full_name} · ${reg.phone}`}</span>
                      <span role="cell" data-label="Spending limit">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Spending limit for ${reg.full_name}`}
                          value={limits[reg.id] ?? ""}
                          aria-invalid={approveErrors[reg.id] ? "true" : undefined}
                          onInput={(e) => setLimits({ ...limits, [reg.id]: e.currentTarget.value })}
                        />
                        {approveErrors[reg.id] && <span class="field-error">{approveErrors[reg.id]}</span>}
                      </span>
                      <span role="cell" data-label="Approve">
                        <button type="button" class="gold-btn small" aria-label={`Approve ${reg.full_name}`} onClick={() => approve(reg)}>
                          Approve
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Notice text={approveMessage} />
            </section>
            <section class="panel" aria-labelledby="p-statements">
              <h2 id="p-statements">Statements</h2>
              {statements.data.statements.length === 0 && <p class="muted">No statements yet.</p>}
              <ul class="rows">
                {statements.data.statements.map((s) => (
                  <li key={s.id}>
                    <span>{`${s.number} · ${s.sale_title} · ${{ draft: "Draft", issued: "Issued", superseded: "Superseded" }[s.status]}`}</span>
                    {s.status === "draft" && (
                      <button type="button" class="outline-btn small" aria-label={`Issue ${s.number}`} onClick={() => issue(s)}>
                        Issue
                      </button>
                    )}
                    {s.status === "issued" && (
                      <button
                        type="button"
                        class="outline-btn small"
                        aria-label={`Correct ${s.number}`}
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          setCorrecting(s);
                        }}
                      >
                        Correct
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <Notice text={statementMessage} />
            </section>
          </div>
          <section class="panel" aria-labelledby="p-removal">
            <h2 id="p-removal">Bid removal</h2>
            <Field id="removal-lot" label="Lot">
              <select id="removal-lot" value={chosen} onChange={(e) => setLotId(e.currentTarget.value)}>
                {lots.map((lot) => (
                  <option value={lot.id} key={lot.id}>
                    {`Lot ${lot.lot_number}, ${lot.title}`}
                  </option>
                ))}
              </select>
            </Field>
            {bids && bids.bids.length === 0 ? (
              <p class="muted">No bids on this lot yet. Its bids appear here, each with a Remove bid button.</p>
            ) : (
              <div class="stack-table" style="--cols: 6" role="table" aria-label="Bids">
                <div class="head" role="row">
                  <span role="columnheader">Paddle</span>
                  <span role="columnheader">Bidder</span>
                  <span role="columnheader">Maximum</span>
                  <span role="columnheader">Price after</span>
                  <span role="columnheader">Time</span>
                  <span role="columnheader">Remove</span>
                </div>
                {(bids?.bids ?? []).map((bid) => (
                  <div class="body-row" role="row" key={bid.bid_id}>
                    <span role="cell" data-label="Paddle">{bid.paddle}</span>
                    <span role="cell" data-label="Bidder">{bid.bidder_name}</span>
                    <span role="cell" data-label="Maximum">{euros(bid.max_amount)}</span>
                    <span role="cell" data-label="Price after">{euros(bid.price_after)}</span>
                    <span role="cell" data-label="Time">{rotterdam(bid.accepted_at)}</span>
                    <span role="cell" data-label="Remove">
                      <button
                        type="button"
                        class="outline-btn small"
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          setRemoving(bid);
                          setReason("");
                          setRemoveError("");
                        }}
                      >
                        Remove bid
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Notice text={removeMessage} />
          </section>
        </div>
      </main>
      <Modal open={removing !== null} label="Remove this bid?" onClose={() => setRemoving(null)} returnFocus={() => opener.current}>
        <form class="dialog-body stack" onSubmit={remove} noValidate>
          <h2>Remove this bid?</h2>
          <Field id="remove-reason" label="Reason" error={removeError}>
            <input id="remove-reason" type="text" data-autofocus value={reason} {...describe("remove-reason", removeError)} onInput={(e) => setReason(e.currentTarget.value)} />
          </Field>
          <div class="dialog-actions">
            <button type="submit" class="gold-btn">
              Remove bid
            </button>
            <button type="button" class="outline-btn" onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={correcting !== null} label="Correct this statement?" onClose={() => setCorrecting(null)} returnFocus={() => opener.current}>
        <form class="dialog-body stack" onSubmit={correct} noValidate>
          <h2>Correct this statement?</h2>
          <Field id="correct-note" label="Note" error={noteError}>
            <input id="correct-note" type="text" data-autofocus value={note} {...describe("correct-note", noteError)} onInput={(e) => setNote(e.currentTarget.value)} />
          </Field>
          <div class="dialog-actions">
            <button type="submit" class="gold-btn">
              Issue correction
            </button>
            <button type="button" class="outline-btn" onClick={() => setCorrecting(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </Shell>
  );
}
