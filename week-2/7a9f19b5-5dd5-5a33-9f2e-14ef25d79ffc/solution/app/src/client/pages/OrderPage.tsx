import { useEffect, useState } from "react";
import { dollars } from "../../shared/money";
import type { Order } from "../../shared/types";
import { Totals } from "../components/Totals";
import { request } from "../lib/api";
import { formatDate } from "../lib/format";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { NotFound } from "./NotFound";

export function OrderPage({ orderKey }: { orderKey: string }) {
  const { user, ready } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    document.title = `Order ${orderKey} · Lightfall`;
    if (!user) return;
    void request<{ order: Order }>(`/api/orders/${encodeURIComponent(orderKey)}`).then((reply) => {
      if (reply.ok) setOrder(reply.data.order);
      else setMissing(true);
    });
  }, [orderKey, user]);

  if (missing || (ready && !user)) return <NotFound />;
  if (!order || !user) return <div className="page-loading" aria-busy="true" />;

  const onAccount = order.payment_method === "account";
  return (
    <div className="order">
      <header className="page-head">
        <p className="eyebrow mono">{order.order_key}</p>
        <h1>{onAccount ? "Order placed" : "Order confirmed"}</h1>
        <p className="page-head__lede">
          {onAccount
            ? `Order ${order.order_key} is on your monthly account. A confirmation is on its way to ${user.email}.`
            : `Order ${order.order_key} is confirmed. A receipt is on its way to ${user.email}.`}
        </p>
      </header>
      <div className="order__layout">
        <section className="order__lines" aria-labelledby="order-lines">
          <h2 id="order-lines" className="section-title">
            Fittings
          </h2>
          <table className="data-table">
            <caption className="visually-hidden">Order lines</caption>
            <thead>
              <tr>
                <th scope="col">Fitting</th>
                <th scope="col" className="numeric">Quantity</th>
                <th scope="col" className="numeric">Unit price</th>
                <th scope="col" className="numeric">Line total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.variant_code}>
                  <td>
                    <span className="cart__name">{line.product_name}</span>
                    <span className="cart__code mono">{line.variant_code}</span>
                  </td>
                  <td className="numeric mono">{line.quantity}</td>
                  <td className="numeric mono">{dollars(line.unit_price_cents)}</td>
                  <td className="numeric mono">{dollars(line.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Totals order={order} />
        </section>
        <aside className="order__facts">
          <dl className="spec-list">
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`status-pill status-pill--${order.status}`}>{order.display_status}</span>
              </dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{onAccount ? "Monthly account" : `Card ending ${order.card_last4 ?? ""}`}</dd>
            </div>
            <div>
              <dt>Prices</dt>
              <dd>{order.price_tier === "trade" ? "Trade" : "Retail"}</dd>
            </div>
            {order.purchase_order && (
              <div>
                <dt>Purchase order</dt>
                <dd className="mono">{order.purchase_order}</dd>
              </div>
            )}
            {order.invoice && (
              <>
                <div>
                  <dt>Invoice</dt>
                  <dd className="mono">{order.invoice.invoice_number}</dd>
                </div>
                <div>
                  <dt>Invoice date</dt>
                  <dd className="mono">{order.invoice.invoice_date}</dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd className="mono">{order.invoice.due_date}</dd>
                </div>
              </>
            )}
            {order.refunds.length > 0 && (
              <div>
                <dt>Refunded</dt>
                <dd className="mono">{dollars(order.refunded_cents)}</dd>
              </div>
            )}
            <div>
              <dt>Placed</dt>
              <dd>{formatDate(order.created_at)}</dd>
            </div>
          </dl>
          <Link href="/account">Your orders</Link>
        </aside>
      </div>
    </div>
  );
}
