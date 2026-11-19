import { useEffect, useState } from 'react';
import { COPY } from '../copy.js';
import { get } from '../api.js';
import { formatAmount, formatPrice, inZone, shortId } from '../format.js';
import { Shell } from '../components/Shell.js';
import { navigate } from '../main.js';
import type { Market, Me, Order } from '../api.js';

function useMarkets(): Market[] {
  const [markets, setMarkets] = useState<Market[]>([]);
  useEffect(() => {
    void get<{ markets: Market[] }>('/api/markets')
      .then((value) => setMarkets(value.markets))
      .catch(() => undefined);
  }, []);
  return markets;
}

export function OrdersScreen(props: { me: Me }): React.JSX.Element {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const markets = useMarkets();

  useEffect(() => {
    void get<{ orders: Order[] }>('/api/orders?status=all')
      .then((value) => setOrders(value.orders))
      .catch(() => setOrders([]));
  }, []);

  const marketOf = (id: string): Market | undefined => markets.find((market) => market.id === id);

  return (
    <Shell me={props.me} path="/orders" field="slate" stickers={['dial']}>
      <h1>Orders</h1>
      <div className="card">
        {orders === null ? (
          <div className="skeleton" />
        ) : orders.length === 0 ? (
          <p className="empty-line">No orders yet — the book is waiting.</p>
        ) : (
          <div className="table-scroll">
            <table aria-label="Orders">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Market</th>
                  <th scope="col">Side</th>
                  <th scope="col">Price</th>
                  <th scope="col">Filled</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const market = marketOf(order.market_id);
                  return (
                    <tr key={order.id}>
                      <td>
                        <a
                          href={`/orders/${order.id}`}
                          onClick={(click) => {
                            click.preventDefault();
                            navigate(`/orders/${order.id}`);
                          }}
                        >
                          {shortId(order.id)}
                        </a>
                      </td>
                      <td>{market?.symbol ?? '—'}</td>
                      <td>
                        {order.outcome !== null
                          ? `Buy ${order.outcome === 'yes' ? 'Yes' : 'No'}`
                          : `${order.mode === 'margin' ? 'Margin' : 'Spot'} ${order.side}`}
                      </td>
                      <td>{formatPrice(market?.kind ?? 'event', order.price)}</td>
                      <td>
                        {order.filled_quantity} / {order.quantity}
                      </td>
                      <td>{order.status.replace('_', ' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

export function OrderDetail(props: { me: Me; orderId: string }): React.JSX.Element {
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const markets = useMarkets();

  useEffect(() => {
    void get<Order>(`/api/orders/${props.orderId}`)
      .then(setOrder)
      .catch(() => setMissing(true));
  }, [props.orderId]);

  if (missing) {
    return (
      <Shell me={props.me} path="/orders" field="slate">
        <h1>{COPY.notFoundHeading}</h1>
      </Shell>
    );
  }
  if (order === null) {
    return (
      <Shell me={props.me} path="/orders" field="slate">
        <div className="skeleton" />
      </Shell>
    );
  }

  const market = markets.find((item) => item.id === order.market_id);
  const kind = market?.kind ?? 'event';

  return (
    <Shell me={props.me} path="/orders" field="slate">
      <h1>Order {shortId(order.id)}</h1>
      <div className="card">
        <p>
          {market?.symbol ?? order.market_id} · {order.status.replace('_', ' ')}
        </p>
        <p>
          {order.outcome !== null
            ? `Buy ${order.outcome === 'yes' ? 'Yes' : 'No'}`
            : `${order.mode === 'margin' ? 'Margin' : 'Spot'} ${order.side}`}{' '}
          {formatPrice(kind, order.price)} × {order.quantity}
        </p>
        <p className="label">
          Filled {order.filled_quantity}, remaining {order.remaining_quantity}, hold{' '}
          {formatAmount(order.hold_cents)}
        </p>
      </div>
      <div className="card">
        <h2>Fills</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Price</th>
                <th scope="col">Quantity</th>
                <th scope="col">Notional</th>
                <th scope="col">Fee</th>
                <th scope="col">Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {order.fills.map((fill) => (
                <tr key={fill.id}>
                  <td>{inZone(props.me.venue?.time_zone ?? 'UTC', fill.filled_at)}</td>
                  <td>{formatPrice(kind, fill.price)}</td>
                  <td>{fill.quantity}</td>
                  <td>{formatAmount(fill.notional_cents)}</td>
                  <td>{formatAmount(fill.fee_cents)}</td>
                  <td>{fill.liquidity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
