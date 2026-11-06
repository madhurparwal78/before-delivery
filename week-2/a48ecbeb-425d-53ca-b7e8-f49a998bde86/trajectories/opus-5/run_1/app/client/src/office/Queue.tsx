import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { flavourName } from '../../../shared/catalogue.js';
import { queueCopy } from '../../../shared/copy.js';
import { formatLongDate } from '../../../shared/time.js';
import { ApiCallError, api, type OrderPayload } from '../api.js';
import { Link } from '../router.js';

const REFRESH_MS = 10_000;
const TABLE_WIDTH = 1024;

type Target = 'picking' | 'packed' | 'shipped';

function cansOf(order: OrderPayload): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

function useTableLayout(): boolean {
  const [table, setTable] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= TABLE_WIDTH,
  );
  useEffect(() => {
    const onResize = () => setTable(window.innerWidth >= TABLE_WIDTH);
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return table;
}

export function Queue(): ReactElement {
  const [orders, setOrders] = useState<OrderPayload[]>([]);
  const [status, setStatus] = useState('');
  const asTable = useTableLayout();

  const load = useCallback(async () => {
    try {
      const payload = await api.get<{ orders: OrderPayload[] }>('/api/staff/queue');
      setOrders(payload.orders);
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const move = async (order: OrderPayload, to: Target) => {
    setStatus('');
    try {
      const payload = await api.post<{ order: OrderPayload }>(
        `/api/staff/orders/${order.number}/transitions`,
        { to },
      );
      setOrders((current) =>
        current
          .map((item) => (item.number === order.number ? payload.order : item))
          .filter((item) => item.status !== 'shipped'),
      );
      setStatus(queueCopy.marked(order.number, to));
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      setStatus(
        error.failure.error === 'illegal_transition'
          ? queueCopy.illegal(order.number, to)
          : error.failure.message,
      );
    }
  };

  const actions = (order: OrderPayload) => (
    <div className="office__actions">
      <button
        type="button"
        className="button button--quiet"
        onClick={() => void move(order, 'picking')}
      >
        Start picking
      </button>
      <button
        type="button"
        className="button button--quiet"
        onClick={() => void move(order, 'packed')}
      >
        Mark packed
      </button>
      <button
        type="button"
        className="button button--quiet"
        onClick={() => void move(order, 'shipped')}
      >
        Mark shipped
      </button>
      <a
        className="button button--quiet"
        href={`/api/staff/orders/${order.number}/packing-slip.pdf`}
        aria-label={`Packing slip for ${order.number}`}
      >
        Packing slip
      </a>
    </div>
  );

  return (
    <div className="office__content">
      <h1>Paid orders</h1>

      {orders.length === 0 ? <p>No paid orders waiting.</p> : null}

      {asTable ? (
        <table className="office__table mono" aria-label="Paid orders">
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
                <td>
                  <Link to={`/office/orders/${order.number}`}>{order.number}</Link>
                </td>
                <td>{formatLongDate(order.placed_at.slice(0, 10))}</td>
                <td>{order.province}</td>
                <td>{cansOf(order)}</td>
                <td>{order.status}</td>
                <td>{actions(order)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="office__cards">
          {orders.map((order) => (
            <li key={order.number}>
              <article aria-label={`Order ${order.number}`} className="office__card">
                <h2 className="mono">
                  <Link to={`/office/orders/${order.number}`}>{order.number}</Link>
                </h2>
                <p className="mono">
                  {formatLongDate(order.placed_at.slice(0, 10))} &middot; {order.province} &middot;{' '}
                  {cansOf(order)} cans &middot; {order.status}
                </p>
                <ul className="office__card-lines">
                  {order.lines.map((line) => (
                    <li key={line.flavour}>
                      {line.quantity} x {flavourName(line.flavour)}
                    </li>
                  ))}
                </ul>
                {actions(order)}
              </article>
            </li>
          ))}
        </ul>
      )}

      <p role="status" aria-live="polite" aria-label="Queue status" className="live-region">
        {status}
      </p>
    </div>
  );
}
