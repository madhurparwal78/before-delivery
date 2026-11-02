import { CircleCheck, FileText, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { PriceTable } from "../crate/PriceTable";
import { api } from "../lib/api";
import { Link } from "../lib/router";
import type { Order } from "../lib/types";
import { FLAVOUR_NAMES, money } from "../../shared/format";
import { useShop } from "../state/shop";
import { NotFound } from "./NotFound";

export function ThanksPage({ number }: { number: string }) {
  const { user } = useShop();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  useEffect(() => {
    api<{ order: Order }>("GET", `/api/orders/${number}`)
      .then((body) => setOrder(body.order))
      .catch(() => setOrder(null));
  }, [number]);
  if (order === null) return <NotFound />;
  if (order === undefined) {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <div className="skeleton" style={{ height: 48, width: "70%" }} aria-hidden="true" />
          <div className="skeleton" style={{ height: 160, marginTop: 24 }} aria-hidden="true" />
        </div>
      </div>
    );
  }
  return (
    <div className="page page-narrow thanks">
      <div className="panel">
        <CircleCheck className="thanks-icon" size={40} aria-hidden="true" />
        <h1>{`Order ${order.number} is confirmed`}</h1>
        {user && <p className="lede">{`A receipt is on its way to ${user.email}.`}</p>}
        <ul className="thanks-lines">
          {order.lines.map((line) => (
            <li key={line.flavour} className={`flavour-${line.flavour}`}>
              <span className="swatch" aria-hidden="true" />
              <span>{FLAVOUR_NAMES[line.flavour]}</span>
              <span className="num">× {line.quantity}</span>
              <span className="num">{money(line.goods_cents)}</span>
            </li>
          ))}
        </ul>
        <PriceTable figures={order} subscribed={order.discount_cents > 0} hasCans />
        <p className="muted">
          Shipping to {order.ship_to.name}, {order.ship_to.line1}, {order.ship_to.city} {order.ship_to.province} {order.ship_to.postal_code}
        </p>
        <div className="thanks-actions">
          <a className="btn btn-primary" href={order.invoice_url}>
            <FileText size={18} aria-hidden="true" />
            Download invoice (PDF)
          </a>
          {order.subscription_id && (
            <Link className="btn btn-secondary" href={`/account/subscriptions/${order.subscription_id}`}>
              <Repeat size={18} aria-hidden="true" />
              Manage your subscription
            </Link>
          )}
          <Link className="btn btn-quiet" href="/box">
            Keep shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
