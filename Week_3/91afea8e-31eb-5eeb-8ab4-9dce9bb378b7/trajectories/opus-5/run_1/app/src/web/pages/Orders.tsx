/** Order history, paged by cursor. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { Amount } from '../components/ui.tsx';
import type { OrderSummary } from '../../shared/types.js';

export function OrdersPage(): ReactNode {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    void api<{ orders: OrderSummary[]; next_cursor: string | null }>('/api/orders')
      .then((response) => {
        setOrders(response.orders);
        setCursor(response.next_cursor);
      })
      .catch(() => setOrders([]));
  }, []);

  const loadMore = async (): Promise<void> => {
    if (cursor === null) return;
    const response = await api<{ orders: OrderSummary[]; next_cursor: string | null }>(
      `/api/orders?cursor=${encodeURIComponent(cursor)}`,
    );
    setOrders((previous) => [...previous, ...response.orders]);
    setCursor(response.next_cursor);
  };

  return (
    <>
      <h1>orders</h1>
      <ul className="plain grid grid-2 grid-3" role="list" aria-label="Orders">
        {orders.map((order) => (
          <li key={order.order_id}>
            <article className="panel" aria-label={`Order ${order.order_id}`}>
              <h4>
                <Link to={`/orders/${order.order_id}`}>{order.order_id}</Link>
              </h4>
              <p className="price">
                <Amount paise={order.payable_paise} />
              </p>
              <p>{`${order.shipment_count} parcels`}</p>
              <p>
                {order.shipment_states.map((state, index) => (
                  <span className="chip" key={`${state}-${index}`}>
                    {state}
                  </span>
                ))}
              </p>
              <p className="muted">{new Date(order.placed_at).toISOString().slice(0, 10)}</p>
            </article>
          </li>
        ))}
      </ul>
      {cursor === null ? null : (
        <button type="button" className="btn" onClick={() => void loadMore()}>
          Load more
        </button>
      )}
    </>
  );
}
