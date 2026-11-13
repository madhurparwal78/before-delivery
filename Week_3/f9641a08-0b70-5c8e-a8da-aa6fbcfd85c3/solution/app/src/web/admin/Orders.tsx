import { useState } from "react";
import type { AdminOrder, Fulfillment, OrderStatus } from "../../shared/api";
import { ORDER_STATUS_WORDS, PAYMENT_STATUS_WORDS, inr, shortDateTime } from "../../shared/format";
import { Dialog } from "../components/Dialog";
import { Loading, Panel } from "../components/Panel";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { useData } from "../lib/useData";
import { ErrorAlert, PageTitle, SelectField, StatusBlock, TableWrap, TextField, toneOf, useAction, useFilters } from "./ui";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...(["placed", "packed", "partially_shipped", "shipped", "out_for_delivery", "delivered", "cancelled"] as const).map((value) => ({
    value,
    label: ORDER_STATUS_WORDS[value] ?? value,
  })),
];

export function OrdersList() {
  const [filters, setFilters] = useFilters(["q", "status"] as const);
  const query = new URLSearchParams();
  if (filters.q.trim()) query.set("q", filters.q.trim());
  if (filters.status) query.set("status", filters.status);
  const text = query.toString();
  const { data, loading, reload } = useData<AdminOrder[]>(`/api/admin/orders${text ? `?${text}` : ""}`);
  useLive("order", () => void reload());

  return (
    <>
      <PageTitle>Orders</PageTitle>
      <div className="filter-row">
        <TextField label="Search orders" type="search" value={filters.q} onChange={(q) => setFilters({ q })} />
        <SelectField label="Status" value={filters.status} onChange={(status) => setFilters({ status }, false)} options={STATUS_OPTIONS} />
      </div>
      {loading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Panel tone="surface">No orders yet.</Panel>
      ) : (
        <TableWrap>
          <table className="tbl" aria-label="Orders">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Placed</th>
                <th scope="col">Status</th>
                <th scope="col">Payment</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((order) => (
                <tr key={order.number}>
                  <th scope="row">
                    <Link href={`/admin/orders/${order.number}`}>{order.number}</Link>
                  </th>
                  <td>{order.customer.email}</td>
                  <td>{shortDateTime(order.placed_at)}</td>
                  <td>
                    <StatusBlock word={ORDER_STATUS_WORDS[order.status] ?? order.status} tone={toneOf(order.status)} />
                  </td>
                  <td>{PAYMENT_STATUS_WORDS[order.payment.status] ?? order.payment.status}</td>
                  <td>{inr(order.payment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

const FULFILMENT_WORDS: Record<Fulfillment, string> = {
  unfulfilled: "Not packed",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const CARRIERS = ["Coastline Couriers", "Peak Express"];

interface MoveButton {
  to: "packed" | "out_for_delivery" | "delivered";
  label: string;
}

function moveFor(status: OrderStatus): MoveButton | null {
  if (status === "placed") return { to: "packed", label: "Mark packed" };
  if (status === "shipped") return { to: "out_for_delivery", label: "Mark out for delivery" };
  if (status === "out_for_delivery") return { to: "delivered", label: "Mark delivered" };
  return null;
}

export function OrderPage({ number }: { number: string }) {
  const { data: order, error, loading, reload } = useData<AdminOrder>(`/api/admin/orders/${number}`);
  useLive("order", (event) => {
    if (event.number === number) void reload();
  });
  if (error) return <Panel tone="red">{error.message}</Panel>;
  if (loading || !order) return <Loading />;
  return <OrderDetail order={order} reload={reload} />;
}

function OrderDetail({ order, reload }: { order: AdminOrder; reload: () => Promise<void> }) {
  const move = moveFor(order.status);
  const canShip = order.status === "packed" || order.status === "partially_shipped";
  const canCancel = order.status === "placed" || order.status === "packed";
  const toShip = order.lines.filter((l) => l.fulfillment === "packed");
  const [picked, setPicked] = useState<string[]>([]);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [confirm, setConfirm] = useState(false);
  const moving = useAction();
  const shipping = useAction();
  const cancelling = useAction();

  const finish = async (from: Promise<AdminOrder>): Promise<string> => {
    const updated = await from;
    await reload();
    return `${order.number} is now ${ORDER_STATUS_WORDS[updated.status] ?? updated.status}.`;
  };

  const transition = (status: string) => async () =>
    finish(api.post<AdminOrder>(`/api/admin/orders/${order.number}/status`, { version: order.version, status }));

  const ship = async () => {
    const ok = await shipping.run(() =>
      finish(api.post<AdminOrder>(`/api/admin/orders/${order.number}/shipments`, { version: order.version, line_ids: picked, carrier, tracking_number: tracking })),
    );
    if (ok) {
      setPicked([]);
      setTracking("");
      setCarrier("");
    }
  };

  const cancel = async () => {
    const ok = await cancelling.run(transition("cancelled"));
    if (ok) setConfirm(false);
  };

  const reloadLatest = () => {
    moving.clear();
    shipping.clear();
    cancelling.clear();
    void reload();
  };

  return (
    <>
      <PageTitle>Order {order.number}</PageTitle>
      <p className="staff-meta">
        <StatusBlock word={ORDER_STATUS_WORDS[order.status] ?? order.status} tone={toneOf(order.status)} />{" "}
        <span>{PAYMENT_STATUS_WORDS[order.payment.status] ?? order.payment.status}</span> · <span>{inr(order.payment.amount)}</span>
      </p>
      <dl className="facts">
        <dt>Customer</dt>
        <dd>
          {order.customer.name}, {order.customer.email}
        </dd>
        <dt>Placed</dt>
        <dd>{shortDateTime(order.placed_at)}</dd>
      </dl>

      <h2>Lines</h2>
      <TableWrap>
        <table className="tbl" aria-label="Order lines">
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Product</th>
              <th scope="col">Quantity</th>
              <th scope="col">Fulfilment</th>
              <th scope="col">Tracking</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">{line.sku}</th>
                <td>
                  {line.product}, {line.colour}, {line.size}
                </td>
                <td>{line.quantity}</td>
                <td>{FULFILMENT_WORDS[line.fulfillment]}</td>
                <td>{line.shipment ? `${line.shipment.carrier} ${line.shipment.tracking_number}` : "None yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {move && (
        <section className="staff-section" aria-label="Next step">
          <ErrorAlert error={moving.error} onReload={reloadLatest} />
          <button type="button" className="btn btn-primary" disabled={moving.pending} onClick={() => void moving.run(transition(move.to))}>
            {moving.pending ? "Saving" : move.label}
          </button>
        </section>
      )}

      {canShip && (
        <section className="staff-section" aria-labelledby="ship-heading">
          <h2 id="ship-heading">Ship lines</h2>
          {toShip.map((line) => (
            <label key={line.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(line.id)}
                onChange={(event) => setPicked(event.target.checked ? [...picked, line.id] : picked.filter((id) => id !== line.id))}
              />
              Ship {line.sku}
            </label>
          ))}
          {shipping.error?.fields.line_ids && <p className="field-error">{shipping.error.fields.line_ids}</p>}
          <SelectField
            label="Carrier"
            value={carrier}
            onChange={setCarrier}
            options={[{ value: "", label: "Choose a carrier" }, ...CARRIERS.map((c) => ({ value: c, label: c }))]}
            error={shipping.error?.fields.carrier}
          />
          <TextField label="Tracking number" value={tracking} onChange={setTracking} error={shipping.error?.fields.tracking_number} />
          <ErrorAlert error={shipping.error && shipping.error.code !== "validation_failed" ? shipping.error : null} onReload={reloadLatest} />
          <button type="button" className="btn btn-primary" disabled={shipping.pending} onClick={() => void ship()}>
            {shipping.pending ? "Saving" : "Create shipment"}
          </button>
        </section>
      )}

      {canCancel && (
        <section className="staff-section" aria-label="Cancellation">
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            Cancel order
          </button>
        </section>
      )}

      <h2>Timeline</h2>
      <ol className="timeline" aria-label="Order timeline">
        {order.timeline.map((item, i) => (
          <li key={i}>
            {item.label} <span className="muted">{shortDateTime(item.at)}</span>
          </li>
        ))}
      </ol>

      <Dialog title="Cancel this order?" kind="alert" open={confirm} onClose={() => setConfirm(false)}>
        <p>The full amount goes back to the card and gift card, and the stock goes back on sale.</p>
        <ErrorAlert error={cancelling.error} onReload={reloadLatest} />
        <div className="staff-actions">
          <button type="button" className="btn" data-autofocus onClick={() => setConfirm(false)}>
            Keep order
          </button>
          <button type="button" className="btn btn-primary" disabled={cancelling.pending} onClick={() => void cancel()}>
            {cancelling.pending ? "Saving" : "Yes, cancel order"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
