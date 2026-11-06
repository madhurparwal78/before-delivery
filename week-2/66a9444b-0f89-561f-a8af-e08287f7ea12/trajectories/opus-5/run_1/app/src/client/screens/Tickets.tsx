import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { formatDate, formatDeadline, formatEuros } from '../lib/festival.js';
import { useRoute, useUser } from '../lib/store.js';
import type { Hold, Order, WaitlistEntry } from '../lib/types.js';
import type { JSX } from 'react';

const REFRESH_MS = 10_000;

export function TicketsScreen(): JSX.Element {
  const route = useRoute();
  const { user, loading } = useUser();
  const [orders, setOrders] = useState<Order[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (user === null) return;
    const [orderBody, waitlistBody] = await Promise.all([
      request<{ orders: Order[] }>('/api/orders'),
      request<{ entries: WaitlistEntry[] }>('/api/waitlist').catch(() => ({ entries: [] })),
    ]);
    setOrders(orderBody.orders);
    setWaitlist(waitlistBody.entries);
  }, [user]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return <section className="narrow ground-paper">Loading…</section>;

  if (user === null) {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">My tickets</h1>
        <p>
          <a
            href="/signin?next=%2Ftickets"
            onClick={(event) => {
              event.preventDefault();
              route.navigate('/signin?next=%2Ftickets');
            }}
          >
            Sign in
          </a>{' '}
          to see your orders.
        </p>
      </section>
    );
  }

  const claim = async (entry: WaitlistEntry): Promise<void> => {
    try {
      await request<Hold>(`/api/waitlist/${entry.id}/claim`, { method: 'POST' });
      route.navigate('/?checkout=tickets');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setMessage(
        error.failure.code === 'offer_lapsed'
          ? 'This offer lapsed and the seat went to the next person.'
          : 'That offer is no longer open.',
      );
    }
  };

  return (
    <section className="wide ground-paper">
      <h1 className="display">My tickets</h1>
      <p className="status" role="status" aria-label="Tickets status">
        {message}
      </p>

      <table className="ruled" aria-label="My orders">
        <thead>
          <tr>
            <th scope="col">Ref</th>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <a
                  href={`/orders/${order.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    route.navigate(`/orders/${order.id}`);
                  }}
                >
                  {order.ref}
                </a>
              </td>
              <td className="figures">{formatDate(order.created_at)}</td>
              <td>{order.status.replace(/_/g, ' ')}</td>
              <td className="figures">{formatEuros(order.total_cents)}</td>
            </tr>
          ))}
          {orders.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No orders yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h2>Waitlist</h2>
      <ul className="ruled" aria-label="My waitlist">
        {waitlist.map((entry) => (
          <li key={entry.id}>
            <span>{entry.title}</span>
            <span className="figures">{`Position ${entry.position}`}</span>
            <span>{entry.status}</span>
            {entry.status === 'offered' && entry.offer_expires_at !== null ? (
              <>
                <span className="figures">{`Claim by ${formatDeadline(entry.offer_expires_at)}`}</span>
                <button type="button" className="primary" onClick={() => void claim(entry)}>
                  {`Claim seat for ${entry.title}`}
                </button>
              </>
            ) : null}
          </li>
        ))}
        {waitlist.length === 0 ? <li className="muted">No waitlist entries.</li> : null}
      </ul>
    </section>
  );
}
