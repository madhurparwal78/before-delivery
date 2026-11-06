import { useEffect, useState } from "react";
import { dollars } from "../../shared/money";
import type { Order } from "../../shared/types";
import { request } from "../lib/api";
import { formatDate } from "../lib/format";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { NotFound } from "./NotFound";

const ROLE_LABEL = { retail: "Retail customer", trade: "Trade", admin: "Southerly staff" } as const;

export function Account() {
  const { user, ready, approvedTrade } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    document.title = "Account · Lightfall";
    if (!user) return;
    void request<{ orders: Order[] }>("/api/orders").then((reply) => reply.ok && setOrders(reply.data.orders));
  }, [user]);

  if (ready && !user) return <NotFound />;
  if (!user) return <div className="page-loading" aria-busy="true" />;

  const banner =
    user.trade_status === "submitted"
      ? "Your trade application is with our team. You'll see trade prices once it's approved."
      : user.trade_status === "declined"
        ? "Your trade application was declined. You can still shop at retail prices."
        : "";

  return (
    <div className="account">
      <header className="page-head">
        <p className="eyebrow">{ROLE_LABEL[user.role]}</p>
        <h1>{user.name}</h1>
        <p className="page-head__lede mono">{user.email}</p>
      </header>
      {user.role === "trade" && (
        <p role="status" aria-label="Trade application" className={banner ? "banner" : "visually-hidden"}>
          {banner}
        </p>
      )}
      {approvedTrade && (
        <p className="account__links">
          <Link href="/projects">Your projects</Link>
        </p>
      )}
      <section className="account__orders" aria-labelledby="account-orders">
        <h2 id="account-orders" className="section-title">
          Orders
        </h2>
        {orders && orders.length === 0 && <p className="empty-note">No orders yet.</p>}
        {orders && orders.length > 0 && (
          <table className="data-table">
            <caption className="visually-hidden">Your orders</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Placed</th>
                <th scope="col">Status</th>
                <th scope="col" className="numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.order_key}>
                  <td>
                    <Link href={`/orders/${order.order_key}`} className="mono">
                      {order.order_key}
                    </Link>
                  </td>
                  <td>{formatDate(order.created_at)}</td>
                  <td>
                    <span className={`status-pill status-pill--${order.status}`}>{order.display_status}</span>
                  </td>
                  <td className="numeric mono">{dollars(order.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
