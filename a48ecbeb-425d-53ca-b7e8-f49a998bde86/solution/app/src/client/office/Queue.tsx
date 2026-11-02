import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useMedia } from "../lib/media";
import { Link } from "../lib/router";
import type { Order, OrderStatus, User } from "../lib/types";
import { longDateTime, PROVINCE_NAMES } from "../../shared/format";
import { EmptyCrate, failureOf, Loading, OrderStatusBadge, PageFailure, useOfficeData } from "./shared";

// The paid-orders queue: cards below 1024 px, a table from 1024 px, refreshed every 5 seconds.

const QUEUE_POLL_MS = 5000;
const CARDS = "(max-width: 1023px)";

interface Step {
  from: OrderStatus;
  to: "picking" | "packed" | "shipped";
  label: string;
}

/** The buttons each order carries; the server decides every move, the button for the next one is enabled. */
const STEPS: Step[] = [
  { from: "paid", to: "picking", label: "Start picking" },
  { from: "picking", to: "packed", label: "Mark packed" },
  { from: "packed", to: "shipped", label: "Mark shipped" },
];

const cans = (order: Order): number => order.lines.reduce((sum, line) => sum + line.quantity, 0);

interface ActionsProps {
  order: Order;
  canMove: boolean;
  busy: boolean;
  onMove: (order: Order, step: Step) => void;
  register: (key: string, button: HTMLButtonElement | null) => void;
}

function QueueActions({ order, canMove, busy, onMove, register }: ActionsProps) {
  return (
    <div className="queue-actions" aria-busy={busy}>
      {canMove &&
        STEPS.map((step) => (
          <button
            key={step.to}
            ref={(button) => {
              register(`${order.number}:${step.to}`, button);
            }}
            type="button"
            className="btn btn-secondary"
            disabled={busy || order.status !== step.from}
            onClick={() => onMove(order, step)}
          >
            {step.label}
          </button>
        ))}
      <a className="btn btn-quiet" href={`/api/staff/orders/${order.number}/packing-slip.pdf`} target="_blank" rel="noopener">
        <FileText size={18} aria-hidden="true" />
        Packing slip for {order.number}
      </a>
    </div>
  );
}

export function Queue({ user }: { user: User }) {
  const { data, setData, failure, reload } = useOfficeData<{ orders: Order[] }>("/api/staff/queue", QUEUE_POLL_MS);
  const asCards = useMedia(CARDS);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const canMove = user.role !== "support";

  const register = (key: string, button: HTMLButtonElement | null) => {
    if (button) buttons.current.set(key, button);
    else buttons.current.delete(key);
  };

  // After a move, focus goes to the order's next action, or to the heading once it has shipped.
  useEffect(() => {
    if (!focusKey || busy) return;
    (buttons.current.get(focusKey) ?? heading.current)?.focus();
    setFocusKey(null);
  }, [focusKey, busy, data]);

  const move = async (order: Order, step: Step) => {
    setBusy(order.number);
    try {
      const { order: moved } = await api<{ order: Order }>("POST", `/api/staff/orders/${order.number}/transitions`, { to: step.to });
      setData((prev) => prev && { orders: prev.orders.map((o) => (o.number === moved.number ? moved : o)) });
      setMessage(`Order ${moved.number} marked ${step.to}.`);
      const next = STEPS.find((s) => s.from === moved.status);
      setFocusKey(next ? `${moved.number}:${next.to}` : "heading");
    } catch (error) {
      setMessage(failureOf(error).message);
      setFocusKey("heading");
      void reload();
    } finally {
      setBusy(null);
    }
  };

  const actions = (order: Order) => (
    <QueueActions order={order} canMove={canMove} busy={busy === order.number} onMove={(o, s) => void move(o, s)} register={register} />
  );
  const orders = data?.orders ?? [];

  return (
    <div className="office-page">
      <h1 ref={heading} tabIndex={-1}>
        Paid orders
      </h1>
      <p role="status" aria-label="Queue status" className="status-line">
        {message}
      </p>
      {failure && !data && <PageFailure failure={failure} />}
      {!data && !failure && <Loading />}
      {data && orders.length === 0 && (
        <div className="empty">
          <EmptyCrate />
          <p>No paid orders are waiting.</p>
        </div>
      )}
      {orders.length > 0 &&
        (asCards ? (
          <ul className="queue-cards">
            {orders.map((order) => (
              <li key={order.number}>
                <article aria-label={`Order ${order.number}`} className="queue-card">
                  <div className="queue-card-head">
                    <h2>
                      <Link href={`/office/orders/${order.number}`} className="num">
                        {order.number}
                      </Link>
                    </h2>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <dl className="facts">
                    <div>
                      <dt>Placed</dt>
                      <dd className="num">{longDateTime(new Date(order.placed_at))}</dd>
                    </div>
                    <div>
                      <dt>Province</dt>
                      <dd>{PROVINCE_NAMES[order.province] ?? order.province}</dd>
                    </div>
                    <div>
                      <dt>Cans</dt>
                      <dd className="num">{cans(order)}</dd>
                    </div>
                  </dl>
                  {actions(order)}
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <div className="table-wrap">
            <table aria-label="Paid orders" className="office-table queue-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Placed</th>
                  <th scope="col">Province</th>
                  <th scope="col">Cans</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.number}>
                    <th scope="row">
                      <Link href={`/office/orders/${order.number}`} className="num">
                        {order.number}
                      </Link>
                    </th>
                    <td className="num">{longDateTime(new Date(order.placed_at))}</td>
                    <td>{PROVINCE_NAMES[order.province] ?? order.province}</td>
                    <td className="num">{cans(order)}</td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td>{actions(order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
