import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { dollars, parseDollars } from "../../shared/money";
import type { AdminOrder, ServiceHealth, StockItem, TradeApplication } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { newRequestKey, request } from "../lib/api";
import { formatDate } from "../lib/format";
import { useSession } from "../lib/session";
import { NotFound } from "./NotFound";

const TABS = ["Applications", "Orders", "Stock", "Health"] as const;
type Tab = (typeof TABS)[number];
const KILL_BILL_DOWN = (key: string) => `Kill Bill is unavailable. Order ${key} is unchanged; try again shortly.`;
const HEALTH_REFRESH_MS = 10_000;
const OCCUPATION: Record<string, string> = {
  electrician: "Electrician",
  architect: "Architect",
  lighting_designer: "Lighting designer",
  wholesaler: "Wholesaler",
};
const SERVICES: [keyof ServiceHealth, string][] = [
  ["postgres", "Postgres"],
  ["killbill", "Kill Bill"],
  ["mailpit", "Mailpit"],
  ["minio", "MinIO"],
  ["pocketbase", "PocketBase"],
];

type Announce = (message: string) => void;

interface PanelProps {
  announce: Announce;
  onReady: () => void;
}

function Applications({ announce, onReady }: PanelProps) {
  const [applications, setApplications] = useState<TradeApplication[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<TradeApplication | null>(null);
  const [reason, setReason] = useState("");
  const id = useId();

  const load = useCallback(async () => {
    const reply = await request<{ applications: TradeApplication[] }>("/api/admin/trade-applications");
    if (reply.ok) setApplications(reply.data.applications);
    onReady();
  }, [onReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (application: TradeApplication, verdict: "approve" | "decline", body?: { reason: string }) => {
    setBusy(application.id);
    const reply = await request(`/api/admin/trade-applications/${application.id}/${verdict}`, { method: "POST", body });
    setBusy(null);
    if (reply.ok) announce(`${verdict === "approve" ? "Approved" : "Declined"} ${application.business_name}.`);
    else if (reply.status === 409) announce("This application has already been decided.");
    await load();
  };

  const submitDecline = async (event: FormEvent) => {
    event.preventDefault();
    if (!declining || !reason.trim()) return;
    const application = declining;
    setDeclining(null);
    await decide(application, "decline", { reason: reason.trim() });
    setReason("");
  };

  return (
    <>
      <table aria-label="Trade applications" className="data-table admin-table">
        <thead>
          <tr>
            <th scope="col">Applicant</th>
            <th scope="col">Business</th>
            <th scope="col">NZBN</th>
            <th scope="col">Occupation</th>
            <th scope="col">Submitted</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {applications?.map((application) => (
            <tr key={application.id}>
              <td>
                {application.applicant_name}
                <span className="cart__code mono">{application.applicant_email}</span>
              </td>
              <td>{application.business_name}</td>
              <td className="mono">{application.nzbn}</td>
              <td>{OCCUPATION[application.occupation]}</td>
              <td>{formatDate(application.submitted_at)}</td>
              <td>
                <span className={`status-pill status-pill--${application.status}`}>
                  {application.status === "submitted" ? "Submitted" : application.status === "approved" ? "Approved" : "Declined"}
                </span>
                {application.decline_reason && <span className="cart__code">{application.decline_reason}</span>}
              </td>
              <td className="admin-table__actions">
                {application.status === "submitted" && (
                  <>
                    <button
                      type="button"
                      className="button button--primary button--small"
                      aria-label={`Approve ${application.business_name}`}
                      disabled={busy === application.id}
                      onClick={() => void decide(application, "approve")}
                    >
                      {busy === application.id ? "Saving" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      aria-label={`Decline ${application.business_name}`}
                      disabled={busy === application.id}
                      onClick={() => setDeclining(application)}
                    >
                      Decline
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {applications?.length === 0 && <p className="empty-note">No trade applications yet.</p>}
      <Dialog title="Decline application" open={declining !== null} onClose={() => setDeclining(null)}>
        <form className="form-stack" onSubmit={(event) => void submitDecline(event)}>
          <p className="dialog__note">{declining?.business_name}</p>
          <div className="field">
            <label htmlFor={`${id}-reason`}>Reason</label>
            <textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="submit" className="button button--primary">
            Decline
          </button>
        </form>
      </Dialog>
    </>
  );
}

interface MoneyDialog {
  kind: "refund" | "payment";
  order: AdminOrder;
}

function Orders({ announce, onReady }: PanelProps) {
  const id = useId();
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<MoneyDialog | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [working, setWorking] = useState(false);
  const refundKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const reply = await request<{ orders: AdminOrder[] }>("/api/admin/orders");
    if (reply.ok) setOrders(reply.data.orders);
    onReady();
  }, [onReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const dispatch = async (order: AdminOrder) => {
    setPending((current) => ({ ...current, [order.order_key]: order.payment_method === "account" ? "Invoicing" : "Capturing" }));
    const reply = await request<{ order: AdminOrder }>(`/api/admin/orders/${order.order_key}/dispatch`, { method: "POST" });
    setPending(({ [order.order_key]: _, ...rest }) => rest);
    if (reply.ok) {
      const done = reply.data.order;
      announce(
        done.payment_method === "account"
          ? `Invoice ${done.invoice?.invoice_number ?? ""} raised for ${done.order_key}.`
          : `Payment captured. Order ${done.order_key} is Paid.`,
      );
    } else if (reply.status === 409) announce("This order can't be dispatched in its current state.");
    else announce(KILL_BILL_DOWN(order.order_key));
    await load();
  };

  const open = (kind: MoneyDialog["kind"], order: AdminOrder) => {
    setAmount("");
    setReason("");
    setFieldError("");
    refundKey.current = null;
    setDialog({ kind, order });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dialog) return;
    const { order, kind } = dialog;
    const cents = parseDollars(amount);
    if (cents === null || cents < 1) {
      setFieldError("Enter dollars with up to two decimals, for example 277.73.");
      return;
    }
    setWorking(true);
    setFieldError("");
    if (kind === "refund") {
      const refundable = order.captured_cents - order.refunded_cents;
      refundKey.current ??= newRequestKey();
      const reply = await request(`/api/admin/orders/${order.order_key}/refunds`, {
        method: "POST",
        headers: { "Idempotency-Key": refundKey.current },
        body: { amount_cents: cents, reason: reason.trim() },
      });
      setWorking(false);
      if (reply.ok) {
        setDialog(null);
        announce(`Refunded ${dollars(cents)} on ${order.order_key}.`);
      } else if (reply.error.errors?.amount_cents === "exceeds_refundable") {
        refundKey.current = null;
        setFieldError(`More than the ${dollars(refundable)} still refundable.`);
      } else if (reply.error.errors) {
        refundKey.current = null;
        setFieldError("This field is required.");
      } else if (reply.status === 503 || reply.status === 0) announce(KILL_BILL_DOWN(order.order_key));
      else announce("This order can't be dispatched in its current state.");
    } else {
      const reply = await request(`/api/admin/orders/${order.order_key}/record-payment`, {
        method: "POST",
        body: { amount_cents: cents },
      });
      setWorking(false);
      if (reply.ok) {
        setDialog(null);
        announce(`Payment recorded. Order ${order.order_key} is Paid.`);
      } else if (reply.error.errors?.amount_cents === "must_equal_balance") announce("The amount must equal the invoice total.");
      else if (reply.status === 503 || reply.status === 0) announce(KILL_BILL_DOWN(order.order_key));
    }
    await load();
  };

  return (
    <>
      <table aria-label="Orders" className="data-table admin-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Customer</th>
            <th scope="col">Placed</th>
            <th scope="col" className="numeric">Total</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {orders?.map((order) => {
            const busy = pending[order.order_key];
            const status = order.status;
            return (
              <tr key={order.order_key}>
                <td className="mono">
                  {order.order_key}
                  <span className="cart__code">{order.payment_method === "account" ? `Account${order.purchase_order ? ` · PO ${order.purchase_order}` : ""}` : "Card"}</span>
                </td>
                <td className="admin-table__email">{order.customer_email}</td>
                <td>{formatDate(order.created_at)}</td>
                <td className="numeric mono">{dollars(order.total_cents)}</td>
                <td>
                  <span className={`status-pill status-pill--${busy ? "busy" : status}`}>{busy ?? order.display_status}</span>
                  {order.invoice && <span className="cart__code mono">Due {order.invoice.due_date}</span>}
                </td>
                <td className="admin-table__actions">
                  {(status === "authorised" || status === "placed") && (
                    <button
                      type="button"
                      className="button button--primary button--small"
                      aria-label={`Dispatch ${order.order_key}`}
                      disabled={Boolean(busy)}
                      onClick={() => void dispatch(order)}
                    >
                      Dispatch
                    </button>
                  )}
                  {(status === "captured" || status === "partially_refunded") && (
                    <button type="button" className="button button--quiet button--small" aria-label={`Refund ${order.order_key}`} onClick={() => open("refund", order)}>
                      Refund
                    </button>
                  )}
                  {(status === "invoiced" || status === "overdue") && (
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      aria-label={`Record payment ${order.order_key}`}
                      onClick={() => open("payment", order)}
                    >
                      Record payment
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {orders?.length === 0 && <p className="empty-note">No orders yet.</p>}
      <Dialog title={dialog?.kind === "payment" ? "Record payment" : "Refund"} open={dialog !== null} onClose={() => setDialog(null)}>
        <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
          <p className="dialog__note mono">
            {dialog?.order.order_key} · {dialog && dollars(dialog.order.total_cents)}
          </p>
          <div className={`field ${fieldError ? "field--error" : ""}`}>
            <label htmlFor={`${id}-amount`}>{dialog?.kind === "payment" ? "Amount received (NZD)" : "Amount (NZD)"}</label>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              aria-describedby={fieldError ? `${id}-error` : undefined}
              onChange={(event) => {
                refundKey.current = null;
                setAmount(event.target.value);
              }}
            />
            {fieldError && (
              <p id={`${id}-error`} className="field__error">
                {fieldError}
              </p>
            )}
          </div>
          {dialog?.kind === "refund" && (
            <div className="field">
              <label htmlFor={`${id}-reason`}>Reason</label>
              <input
                id={`${id}-reason`}
                maxLength={200}
                value={reason}
                onChange={(event) => {
                  refundKey.current = null;
                  setReason(event.target.value);
                }}
              />
            </div>
          )}
          <button type="submit" className="button button--primary" disabled={working}>
            {dialog?.kind === "payment" ? (working ? "Recording" : "Record") : working ? "Refunding" : "Issue refund"}
          </button>
        </form>
      </Dialog>
    </>
  );
}

function Stock({ announce, onReady }: PanelProps) {
  const id = useId();
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [adjusting, setAdjusting] = useState<StockItem | null>(null);
  const [change, setChange] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const reply = await request<{ items: StockItem[] }>("/api/admin/stock");
    if (reply.ok) setItems(reply.data.items);
    onReady();
  }, [onReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!adjusting) return;
    const delta = Number.parseInt(change, 10);
    if (!Number.isInteger(delta)) return;
    setSaving(true);
    const reply = await request<{ item: StockItem }>(`/api/admin/variants/${adjusting.variant_code}`, {
      method: "PATCH",
      body: { stock_adjust: delta, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setSaving(false);
    if (reply.ok) {
      announce(`Stock for ${adjusting.variant_code} is now ${reply.data.item.stock_on_hand}.`);
      setAdjusting(null);
      setChange("");
      setNote("");
    } else if (reply.error.error === "stock_below_zero") announce("Stock can't go below zero.");
    await load();
  };

  const movements = (items ?? [])
    .flatMap((item) => item.movements.map((movement) => ({ ...movement, code: item.variant_code })))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 12);

  return (
    <>
      <table aria-label="Clearance stock" className="data-table admin-table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Product</th>
            <th scope="col" className="numeric">Clearance price</th>
            <th scope="col" className="numeric">On hand</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items?.map((item) => (
            <tr key={item.variant_code}>
              <td className="mono">{item.variant_code}</td>
              <td>{item.product_name}</td>
              <td className="numeric mono">{item.clearance_price_cents === null ? "" : dollars(item.clearance_price_cents)}</td>
              <td className="numeric mono">{item.stock_on_hand}</td>
              <td className="admin-table__actions">
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Adjust stock ${item.variant_code}`}
                  onClick={() => setAdjusting(item)}
                >
                  Adjust stock
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="section-title admin-subhead">Recent movements</h3>
      <table className="data-table data-table--compact">
        <caption className="visually-hidden">Recent stock movements</caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col" className="numeric">Change</th>
            <th scope="col">Reason</th>
            <th scope="col">Order or note</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement, index) => (
            <tr key={`${movement.code}-${movement.created_at}-${index}`}>
              <td className="mono">{movement.code}</td>
              <td className="numeric mono">{movement.delta > 0 ? `+${movement.delta}` : movement.delta}</td>
              <td>{movement.reason}</td>
              <td className="mono">{movement.order_key ?? movement.note ?? ""}</td>
              <td>{formatDate(movement.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog title="Adjust stock" open={adjusting !== null} onClose={() => setAdjusting(null)}>
        <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
          <p className="dialog__note mono">
            {adjusting?.variant_code} · {adjusting?.stock_on_hand} on hand
          </p>
          <div className="field">
            <label htmlFor={`${id}-change`}>Change</label>
            <input id={`${id}-change`} type="number" step={1} value={change} onChange={(e) => setChange(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-note`}>Note</label>
            <input id={`${id}-note`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit" className="button button--primary" disabled={saving}>
            {saving ? "Saving" : "Save"}
          </button>
        </form>
      </Dialog>
    </>
  );
}

function Health() {
  const [services, setServices] = useState<ServiceHealth | null>(null);
  useEffect(() => {
    const load = () =>
      void request<{ services: ServiceHealth }>("/api/admin/health").then((reply) => reply.ok && setServices(reply.data.services));
    load();
    const timer = setInterval(load, HEALTH_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <table aria-label="Service health" className="data-table admin-table health-table">
      <thead>
        <tr>
          <th scope="col">Service</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {SERVICES.map(([key, label]) => (
          <tr key={key}>
            <th scope="row">{label}</th>
            <td>
              {services && (
                <span className={`status-pill status-pill--${services[key]}`}>{services[key] === "up" ? "Up" : "Down"}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LOADED_PANELS = 3;

export function Admin() {
  const { user, ready } = useSession();
  const [tab, setTab] = useState<Tab>("Applications");
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(0);
  const tabs = useRef(new Map<Tab, HTMLButtonElement>());
  const id = useId();
  const reported = useRef(new Set<string>());
  const readyFor = (panel: string) => () => {
    if (reported.current.has(panel)) return;
    reported.current.add(panel);
    setLoaded(reported.current.size);
  };
  const onApplications = useCallback(readyFor("applications"), []);
  const onOrders = useCallback(readyFor("orders"), []);
  const onStock = useCallback(readyFor("stock"), []);

  useEffect(() => {
    document.title = "Admin · Lightfall";
  }, []);

  if (ready && user?.role !== "admin") return <NotFound />;
  if (!user) return <div className="page-loading" aria-busy="true" />;

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    const next = event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length] : event.key === "ArrowLeft" ? TABS[(index + TABS.length - 1) % TABS.length] : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <div className="admin">
      <header className="page-head">
        <p className="eyebrow">Southerly staff</p>
        <h1>Admin</h1>
      </header>
      {loaded < LOADED_PANELS && <div className="page-loading" aria-busy="true" />}
      <div hidden={loaded < LOADED_PANELS}>
        <div role="tablist" aria-label="Admin sections" className="tabs">
          {TABS.map((name) => (
            <button
              key={name}
              ref={(element) => {
                if (element) tabs.current.set(name, element);
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`${id}-panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              className="tabs__tab"
              onClick={() => setTab(name)}
              onKeyDown={onKey}
            >
              {name}
            </button>
          ))}
        </div>
        <p role="status" aria-label="Admin updates" className="form-status">
          {status}
        </p>
        {/* The three data panels stay mounted (hidden when inactive) so a tab shows its table at once. */}
        <div role="tabpanel" id={`${id}-panel-Applications`} aria-labelledby={`${id}-tab-Applications`} hidden={tab !== "Applications"} className="tabs__panel">
          <Applications announce={setStatus} onReady={onApplications} />
        </div>
        <div role="tabpanel" id={`${id}-panel-Orders`} aria-labelledby={`${id}-tab-Orders`} hidden={tab !== "Orders"} className="tabs__panel">
          <Orders announce={setStatus} onReady={onOrders} />
        </div>
        <div role="tabpanel" id={`${id}-panel-Stock`} aria-labelledby={`${id}-tab-Stock`} hidden={tab !== "Stock"} className="tabs__panel">
          <Stock announce={setStatus} onReady={onStock} />
        </div>
        <div role="tabpanel" id={`${id}-panel-Health`} aria-labelledby={`${id}-tab-Health`} hidden={tab !== "Health"} className="tabs__panel">
          {tab === "Health" && <Health />}
        </div>
      </div>
    </div>
  );
}
