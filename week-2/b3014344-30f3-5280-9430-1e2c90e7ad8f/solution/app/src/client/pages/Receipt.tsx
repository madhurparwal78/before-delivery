import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { api, RequestError } from "../lib/api";
import { Link } from "../lib/router";
import { homeFor, useSession } from "../session";
import { copyFor } from "../../shared/copy";
import { longDate, type Order, type PaymentKind } from "../../shared/domain";
import { money } from "../../shared/money";
import { NotFound } from "./Missing";

const KIND: Record<PaymentKind, string> = { deposit: "Deposit", balance: "Launch balance", care: "Care plan, first month" };

/** `2026-11-01T14:05:09-03:00` → `1 November 2026, 14:05` (already studio local time). */
export function studioMoment(instant: string): string {
  return `${longDate(instant.slice(0, 10))}, ${instant.slice(11, 16)}`;
}

export function Receipt({ orderId }: { orderId: string }) {
  const { user } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api<Order>(`/api/orders/${encodeURIComponent(orderId)}`)
      .then((body) => (body.payments.length ? setOrder(body) : setMissing(true)))
      .catch((error) => error instanceof RequestError && setMissing(true));
  }, [orderId]);
  if (missing) return <NotFound />;
  const payment = order?.payments[order.payments.length - 1];
  return (
    <section className="page page--narrow receipt">
      <p className="eyebrow">Receipt</p>
      <h1>
        <Check aria-hidden="true" className="receipt__mark" size={36} />
        Payment received
      </h1>
      {order && payment ? (
        <div className="receipt__sheet">
          <dl className="facts">
            <div>
              <dt>Order</dt>
              <dd className="mono">{order.number}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{order.planName}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{KIND[payment.kind]}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="mono receipt__amount">{money(payment.amount, order.currency)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd className="mono">{studioMoment(payment.capturedAt)} Buenos Aires</dd>
            </div>
          </dl>
          {user?.role === "client_owner" ? <p className="receipt__mail">{copyFor.receiptLine(user.email)}</p> : null}
          <p>
            <Link href={user ? homeFor(user) : "/portal"} className="button button--primary">
              Go to your portal
            </Link>
          </p>
        </div>
      ) : (
        <p className="lede">Loading your receipt…</p>
      )}
    </section>
  );
}
