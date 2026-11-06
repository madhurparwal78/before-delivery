/**
 * The admin screen: Applications, Orders, Stock and Health, each a table.
 * Dispatch, refunds, recorded payments and stock changes all run through the API,
 * which refuses every caller who is not an admin.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { ADMIN } from "../../shared/copy.js";
import { formatMoney, parseAmountToCents } from "../../shared/money.js";
import { refundableCents } from "../../shared/orderState.js";
import type { AdminOrder, ServiceHealth, StockItem, TradeApplication } from "../../shared/types.js";
import { useAnnouncer, useSession } from "../state/app.js";
import { Dialog } from "../components/Dialog.js";

type TabName = "Applications" | "Orders" | "Stock" | "Health";
const TABS: readonly TabName[] = ["Applications", "Orders", "Stock", "Health"];

const SERVICE_ROWS: ReadonlyArray<{ key: keyof ServiceHealth; label: string }> = [
  { key: "postgres", label: "Postgres" },
  { key: "killbill", label: "Kill Bill" },
  { key: "mailpit", label: "Mailpit" },
  { key: "minio", label: "MinIO" },
  { key: "pocketbase", label: "PocketBase" },
];

export function AdminPage() {
  const { user } = useSession();
  const { message, announce } = useAnnouncer();
  const [tab, setTab] = useState<TabName>("Applications");

  const [applications, setApplications] = useState<TradeApplication[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [pendingCell, setPendingCell] = useState<Record<string, string>>({});

  const [declining, setDeclining] = useState<TradeApplication | null>(null);
  const [refunding, setRefunding] = useState<AdminOrder | null>(null);
  const [recording, setRecording] = useState<AdminOrder | null>(null);
  const [adjusting, setAdjusting] = useState<StockItem | null>(null);

  const loadApplications = useCallback(async () => {
    const { applications: loaded } = await api.adminApplications();
    setApplications(loaded);
  }, []);
  const loadOrders = useCallback(async () => {
    const { orders: loaded } = await api.adminOrders();
    setOrders(loaded);
  }, []);
  const loadStock = useCallback(async () => {
    const { items } = await api.adminStock();
    setStock(items);
  }, []);
  const loadHealth = useCallback(async () => {
    const { services } = await api.adminHealth();
    setHealth(services);
  }, []);

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    if (tab === "Applications") void loadApplications().catch(() => undefined);
    if (tab === "Orders") void loadOrders().catch(() => undefined);
    if (tab === "Stock") void loadStock().catch(() => undefined);
    if (tab === "Health") void loadHealth().catch(() => undefined);
  }, [tab, user, loadApplications, loadOrders, loadStock, loadHealth]);

  // The Health tab refreshes every 10 seconds.
  useEffect(() => {
    if (tab !== "Health" || !user || user.role !== "admin") return;
    const timer = setInterval(() => void loadHealth().catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [tab, user, loadHealth]);

  if (!user || user.role !== "admin") {
    return (
      <div className="wrap section">
        <h1>Admin</h1>
        <p className="muted">This area is for Southerly Light Works staff.</p>
      </div>
    );
  }

  const approve = async (application: TradeApplication): Promise<void> => {
    setPendingCell((c) => ({ ...c, [application.id]: ADMIN.saving }));
    try {
      await api.approveApplication(application.id);
      announce(ADMIN.approved(application.business_name));
      await loadApplications();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      announce(ADMIN.alreadyDecided);
    } finally {
      setPendingCell((c) => {
        const next = { ...c };
        delete next[application.id];
        return next;
      });
    }
  };

  const dispatch = async (order: AdminOrder): Promise<void> => {
    setPendingCell((c) => ({
      ...c,
      [order.order_key]: order.payment_method === "account" ? ADMIN.invoicing : ADMIN.capturing,
    }));
    try {
      const { order: updated } = await api.dispatchOrder(order.order_key);
      announce(
        updated.invoice
          ? ADMIN.invoiceRaised(updated.invoice.invoice_number, updated.order_key)
          : ADMIN.paymentCaptured(updated.order_key),
      );
      await loadOrders();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === "payment_unavailable") announce(ADMIN.killbillUnavailable(order.order_key));
      else announce(ADMIN.cannotDispatch);
    } finally {
      setPendingCell((c) => {
        const next = { ...c };
        delete next[order.order_key];
        return next;
      });
    }
  };

  return (
    <div className="wrap section">
      <h1>Admin</h1>

      <div className="tabs" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className="tab"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <p role="status" aria-label="Admin updates" className="small muted" style={{ marginTop: 12 }}>
        {message}
      </p>

      {tab === "Applications" && (
        <div className="table-frame">
          <table aria-label="Trade applications">
            <thead>
              <tr>
                <th scope="col">Business</th>
                <th scope="col">Applicant</th>
                <th scope="col">NZBN</th>
                <th scope="col">Occupation</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.id}>
                  <td>{application.business_name}</td>
                  <td className="small">{`${application.applicant_name} \u00b7 ${application.applicant_email}`}</td>
                  <td className="numeric">{application.nzbn}</td>
                  <td className="small">{application.occupation}</td>
                  <td>{application.status}</td>
                  <td>
                    {application.status === "submitted" ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-quiet small"
                          onClick={() => void approve(application)}
                        >
                          {pendingCell[application.id] ?? `Approve ${application.business_name}`}
                        </button>
                        <button
                          type="button"
                          className="button button-quiet small"
                          onClick={() => setDeclining(application)}
                        >
                          {`Decline ${application.business_name}`}
                        </button>
                      </div>
                    ) : (
                      <span className="small muted">{application.decline_reason ?? "Decided"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Orders" && (
        <div className="table-frame">
          <table aria-label="Orders">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Method</th>
                <th scope="col">Total</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.order_key}>
                  <td className="numeric">{order.order_key}</td>
                  <td className="small">{order.customer_email}</td>
                  <td className="small">{order.payment_method ?? ""}</td>
                  <td className="numeric">{formatMoney(order.total_cents)}</td>
                  <td>{pendingCell[order.order_key] ?? order.display_status}</td>
                  <td>
                    <div className="row-actions">
                      {(order.status === "authorised" || order.status === "placed") && (
                        <button
                          type="button"
                          className="button button-quiet small"
                          onClick={() => void dispatch(order)}
                        >
                          {`Dispatch ${order.order_key}`}
                        </button>
                      )}
                      {(order.status === "captured" || order.status === "partially_refunded") && (
                        <button
                          type="button"
                          className="button button-quiet small"
                          onClick={() => setRefunding(order)}
                        >
                          {`Refund ${order.order_key}`}
                        </button>
                      )}
                      {(order.status === "invoiced" || order.status === "overdue") && (
                        <button
                          type="button"
                          className="button button-quiet small"
                          onClick={() => setRecording(order)}
                        >
                          {`Record payment ${order.order_key}`}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Stock" && (
        <div className="table-frame">
          <table aria-label="Clearance stock">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Product</th>
                <th scope="col">Clearance price</th>
                <th scope="col">On hand</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((item) => (
                <tr key={item.variant_code}>
                  <td className="numeric">{item.variant_code}</td>
                  <td>{item.product_name}</td>
                  <td className="numeric">{formatMoney(item.clearance_price_cents)}</td>
                  <td className="numeric">{item.stock_on_hand}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-quiet small"
                        onClick={() => setAdjusting(item)}
                      >
                        {`Adjust stock ${item.variant_code}`}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Health" && (
        <div className="table-frame">
          <table aria-label="Service health">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {SERVICE_ROWS.map((service) => (
                <tr key={service.key}>
                  <th scope="row">{service.label}</th>
                  <td>{health ? (health[service.key] === "up" ? "Up" : "Down") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {declining && (
        <Dialog title="Decline application" onClose={() => setDeclining(null)}>
          <DeclineForm
            application={declining}
            onDone={async (businessName) => {
              announce(ADMIN.declined(businessName));
              setDeclining(null);
              await loadApplications();
            }}
            onAlreadyDecided={() => {
              announce(ADMIN.alreadyDecided);
              setDeclining(null);
            }}
          />
        </Dialog>
      )}

      {refunding && (
        <Dialog title="Refund" onClose={() => setRefunding(null)}>
          <RefundForm
            order={refunding}
            onDone={async (amountCents, orderKey) => {
              announce(ADMIN.refunded(amountCents, orderKey));
              setRefunding(null);
              await loadOrders();
            }}
            onOutage={(orderKey) => {
              announce(ADMIN.killbillUnavailable(orderKey));
              setRefunding(null);
            }}
          />
        </Dialog>
      )}

      {recording && (
        <Dialog title="Record payment" onClose={() => setRecording(null)}>
          <RecordPaymentForm
            order={recording}
            onDone={async (orderKey) => {
              announce(ADMIN.paymentRecorded(orderKey));
              setRecording(null);
              await loadOrders();
            }}
            onOutage={(orderKey) => {
              announce(ADMIN.killbillUnavailable(orderKey));
              setRecording(null);
            }}
          />
        </Dialog>
      )}

      {adjusting && (
        <Dialog title="Adjust stock" onClose={() => setAdjusting(null)}>
          <AdjustStockForm
            item={adjusting}
            onDone={async (code, onHand) => {
              announce(ADMIN.stockNow(code, onHand));
              setAdjusting(null);
              await loadStock();
            }}
            onBelowZero={() => announce(ADMIN.stockBelowZero)}
          />
        </Dialog>
      )}
    </div>
  );
}

function DeclineForm({
  application,
  onDone,
  onAlreadyDecided,
}: {
  application: TradeApplication;
  onDone: (businessName: string) => Promise<void>;
  onAlreadyDecided: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="field">
        <label htmlFor="decline-reason">Reason</label>
        <textarea id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .declineApplication(application.id, reason.trim())
              .then(() => onDone(application.business_name))
              .catch(() => onAlreadyDecided())
              .finally(() => setBusy(false));
          }}
        >
          {busy ? ADMIN.saving : "Decline"}
        </button>
      </div>
    </>
  );
}

function RefundForm({
  order,
  onDone,
  onOutage,
}: {
  order: AdminOrder;
  onDone: (amountCents: number, orderKey: string) => Promise<void>;
  onOutage: (orderKey: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refundable = refundableCents(order);

  return (
    <>
      <div className="stack">
        <div className="field">
          <label htmlFor="refund-amount">Amount (NZD)</label>
          <input
            id="refund-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {error !== "" && <span className="field-error">{error}</span>}
        </div>
        <div className="field">
          <label htmlFor="refund-reason">Reason</label>
          <input id="refund-reason" type="text" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <p className="small muted numeric">{`${formatMoney(refundable)} still refundable`}</p>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => {
            const cents = parseAmountToCents(amount);
            if (cents === null || cents < 1) {
              setError(ADMIN.exceedsRefundable(refundable));
              return;
            }
            setBusy(true);
            setError("");
            void api
              .refundOrder(order.order_key, { amount_cents: cents, reason: reason.trim() }, crypto.randomUUID())
              .then(() => onDone(cents, order.order_key))
              .catch((failure: unknown) => {
                if (!(failure instanceof ApiError)) throw failure;
                if (failure.failure.code === "payment_unavailable") onOutage(order.order_key);
                else setError(ADMIN.exceedsRefundable(refundable));
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? ADMIN.refunding : "Issue refund"}
        </button>
      </div>
    </>
  );
}

function RecordPaymentForm({
  order,
  onDone,
  onOutage,
}: {
  order: AdminOrder;
  onDone: (orderKey: string) => Promise<void>;
  onOutage: (orderKey: string) => void;
}) {
  // The amount field starts empty, so the admin types the invoice total.
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="field">
        <label htmlFor="record-amount">Amount received (NZD)</label>
        <input
          id="record-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {error !== "" && <span className="field-error">{error}</span>}
      </div>
      <p className="small muted numeric">{`Invoice total ${formatMoney(order.total_cents)}`}</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => {
            const cents = parseAmountToCents(amount);
            if (cents === null) {
              setError(ADMIN.amountMustEqualTotal);
              return;
            }
            setBusy(true);
            setError("");
            void api
              .recordPayment(order.order_key, cents)
              .then(() => onDone(order.order_key))
              .catch((failure: unknown) => {
                if (!(failure instanceof ApiError)) throw failure;
                if (failure.failure.code === "payment_unavailable") onOutage(order.order_key);
                else setError(ADMIN.amountMustEqualTotal);
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? ADMIN.recording : "Record"}
        </button>
      </div>
    </>
  );
}

function AdjustStockForm({
  item,
  onDone,
  onBelowZero,
}: {
  item: StockItem;
  onDone: (code: string, onHand: number) => Promise<void>;
  onBelowZero: () => void;
}) {
  const [change, setChange] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="stack">
        <div className="field" style={{ maxWidth: 160 }}>
          <label htmlFor="adjust-change">Change</label>
          <input
            id="adjust-change"
            type="number"
            value={change}
            onChange={(event) => setChange(Number(event.target.value) || 0)}
          />
        </div>
        <div className="field">
          <label htmlFor="adjust-note">Note</label>
          <input id="adjust-note" type="text" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .adjustVariant(item.variant_code, { stock_adjust: change, note: note.trim() })
              .then(({ item: updated }) => onDone(updated.variant_code, updated.stock_on_hand))
              .catch((failure: unknown) => {
                if (!(failure instanceof ApiError)) throw failure;
                onBelowZero();
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? ADMIN.saving : "Save"}
        </button>
      </div>
    </>
  );
}
