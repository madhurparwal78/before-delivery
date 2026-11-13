import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { promiseText } from "../../shared/format";
import { NotFound } from "../components/NotFound";
import { useConfettiOnce } from "../effects/confetti";
import { ApiFailure, get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { formatRemaining, useCountdown } from "./cart/countdown";
import { ShopperOnly } from "./orders/Gate";
import type { Order, OrderPayment, PaymentStatus } from "./orders/types";
import "../styles/orders.css";

const POLL_MS = 3000;

interface PaymentReading extends OrderPayment {
  server_time: string;
}

function ExpiryTimer({ endsAt, serverTime }: { endsAt: string; serverTime: string }): ReactNode {
  const remaining = useCountdown(endsAt, serverTime);
  return (
    <p className="placed__timer">
      expires in{" "}
      <span role="timer" aria-label="UPI request expires in">
        {formatRemaining(remaining)}
      </span>
    </p>
  );
}

const SHIPMENT_TONES = ["black", "pink", "yellow"] as const;

function Confirmation(): ReactNode {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [payment, setPayment] = useState<PaymentReading | null>(null);

  useEffect(() => {
    let current = true;
    get<Order>(`/api/orders/${id}`).then(
      (found) => {
        if (!current) return;
        setOrder(found);
        setPayment({ ...found.payment, server_time: found.server_time });
      },
      (failure: unknown) => {
        if (current && failure instanceof ApiFailure) setMissing(true);
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  const status: PaymentStatus | null = payment?.status ?? null;
  const paymentId = payment?.payment_id;

  useEffect(() => {
    if (status !== "awaiting_customer" || !paymentId) return undefined;
    let current = true;
    let timer = 0;
    const poll = (): void => {
      get<PaymentReading>(`/api/payments/${paymentId}`).then(
        (reading) => {
          if (!current) return;
          setPayment(reading);
          if (reading.status === "confirmed") {
            get<Order>(`/api/orders/${id}`).then((found) => current && setOrder(found), () => undefined);
          } else if (reading.status === "awaiting_customer") timer = window.setTimeout(poll, POLL_MS);
        },
        () => {
          if (current) timer = window.setTimeout(poll, POLL_MS);
        },
      );
    };
    timer = window.setTimeout(poll, POLL_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [status, paymentId, id]);

  const placed = status === "confirmed";
  useConfettiOnce(placed);
  useTitle(placed ? "order placed" : "your order");

  if (missing) return <NotFound />;
  if (!order || !payment) {
    return (
      <section className="panel panel--ground" aria-busy="true">
        <div className="skeleton" style={{ minHeight: 240 }} />
      </section>
    );
  }

  const parcels = order.shipments.length;
  const heading =
    status === "confirmed" ? "order placed." : status === "awaiting_customer" ? "waiting for your payment." : "payment didn't go through. nothing was charged.";

  return (
    <div className="placed">
      <section className={`panel ${status === "confirmed" || status === "awaiting_customer" ? "panel--black" : "panel--pink"} placed__head`}>
        <h1>{heading}</h1>
        {placed && <p className="bill">{parcels === 1 ? "1 parcel on the way." : `${parcels} parcels on the way.`}</p>}
        {status === "awaiting_customer" && payment.expires_at && <ExpiryTimer endsAt={payment.expires_at} serverTime={payment.server_time} />}
        {placed && (
          <Link className="btn btn--primary" to={`/orders/${order.order_id}`}>
            View order
          </Link>
        )}
      </section>
      {placed && (
        <section className="panel panel--ground">
          <ul className="ship-grid">
            {order.shipments.map((shipment, index) => (
              <li key={shipment.shipment_id} className={`card card--${SHIPMENT_TONES[index % SHIPMENT_TONES.length]} ship-card`}>
                <h2 className="ship-card__seller">{shipment.seller_name}</h2>
                <p className="bill">{shipment.promise_date ? `arrives by ${promiseText(shipment.promise_date)}` : "no delivery date"}</p>
                <span className="chip">{shipment.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function Placed(): ReactNode {
  return (
    <ShopperOnly>
      <Confirmation />
    </ShopperOnly>
  );
}
