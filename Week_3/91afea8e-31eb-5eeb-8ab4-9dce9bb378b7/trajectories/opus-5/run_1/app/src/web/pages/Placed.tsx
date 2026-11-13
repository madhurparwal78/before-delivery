/** The confirmation route: placed, waiting or failed, checked every three seconds. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { Amount, Timer, useCountdown } from '../components/ui.tsx';
import { PlacedBurst } from '../effects/decor.tsx';
import { formatPromiseDate } from '../../shared/format.js';
import { COPY, parcelsOnTheWay } from '../../shared/messages.js';
import type { OrderDetail, PaymentView } from '../../shared/types.js';

export function PlacedPage({ orderId }: { orderId: string }): ReactNode {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      const detail = await api<OrderDetail & { server_time: string }>(`/api/orders/${orderId}`);
      if (!live) return;
      setOrder(detail);
      setPayment(detail.payment);
      setServerTime(detail.server_time);
    };
    void load();
    const timer = setInterval(() => {
      if (payment === null || payment.status === 'awaiting_customer') void load();
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [orderId, payment?.status]);

  const left = useCountdown(payment?.expires_at ?? null, serverTime);

  if (order === null) return <p className="muted">loading</p>;

  const waiting = payment !== null && payment.status === 'awaiting_customer';
  const failed =
    payment !== null && (payment.status === 'expired' || payment.status === 'failed');

  return (
    <>
      {waiting || failed ? null : <PlacedBurst />}
      <h1>
        {waiting
          ? COPY.waitingHeading
          : failed
            ? COPY.paymentFailedHeading
            : COPY.orderPlacedHeading}
      </h1>
      {waiting || failed ? null : <p className="shout">{parcelsOnTheWay(order.shipments.length)}</p>}
      {waiting ? <Timer name="UPI request expires in" seconds={left} /> : null}
      <p className="price">
        <Amount paise={order.payable_paise} />
      </p>
      <ul className="plain grid grid-2 grid-3">
        {order.shipments.map((shipment) => (
          <li key={shipment.shipment_id} className="panel">
            <h4>{shipment.seller_name}</h4>
            <p>{`arrives by ${formatPromiseDate(shipment.promise_date)}`}</p>
            <p className="chip">{shipment.state}</p>
          </li>
        ))}
      </ul>
      <Link to={`/orders/${orderId}`} className="btn" ariaLabel="View order">
        View order
      </Link>
    </>
  );
}
