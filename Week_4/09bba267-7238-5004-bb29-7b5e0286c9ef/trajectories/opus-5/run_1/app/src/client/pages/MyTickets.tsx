import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Entry, Order, Performance, Ticket, TicketStatus } from '../../shared/api';
import { COPY, refundConfirmedAnnouncement } from '../../shared/copy';
import { formatMoney, refundAmountCents } from '../../shared/money';
import { Dialog } from '../components/Dialog';
import { api, newIdempotencyKey } from '../lib/api';
import { useAnnouncer } from '../lib/announce';
import { useLiveUpdates } from '../lib/live';
import { Link, useRouter } from '../lib/router';

const STATUS_WORDS: Record<TicketStatus, string> = {
  payment_pending: 'Payment pending',
  issued: 'Issued',
  exchange_pending: 'Exchange pending',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

interface RefundIntent {
  readonly order: Order;
  readonly ticket: Ticket;
  readonly amountCents: number;
  readonly includesOrderFee: boolean;
}

export function MyTickets(): ReactNode {
  const { announce } = useAnnouncer();
  const { go } = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [intent, setIntent] = useState<RefundIntent | null>(null);
  const [refunding, setRefunding] = useState(false);

  const refresh = useCallback(async () => {
    const [ordersResult, waitlistResult, performancesResult] = await Promise.all([
      api.orders(),
      api.waitlist(),
      api.performances(),
    ]);
    if (ordersResult.data !== undefined) setOrders(ordersResult.data.orders);
    if (waitlistResult.data !== undefined) setEntries(waitlistResult.data.entries);
    if (performancesResult.data !== undefined) setPerformances(performancesResult.data.performances);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveUpdates({}, () => {
    void refresh();
  });

  const changesOpen = (performanceId: string): boolean =>
    performances.find((performance) => performance.id === performanceId)?.changesOpen ?? false;

  const openRefund = (order: Order, ticket: Ticket): void => {
    const issuedLeft = order.tickets.filter(
      (candidate) => candidate.status === 'issued' && candidate.id !== ticket.id,
    ).length;
    setIntent({
      order,
      ticket,
      amountCents: refundAmountCents({ refunded: [ticket], issuedTicketsLeft: issuedLeft }),
      includesOrderFee: issuedLeft === 0,
    });
  };

  const confirmRefund = async (): Promise<void> => {
    if (intent === null) return;
    setRefunding(true);
    const result = await api.refund(intent.order.id, [intent.ticket.id], newIdempotencyKey());
    setRefunding(false);
    setIntent(null);
    if (result.status === 200 && result.data !== undefined) {
      announce(refundConfirmedAnnouncement(result.data.refundCents));
      void refresh();
      return;
    }
    if (result.status === 503) announce(COPY.changePaymentsPaused);
    else if (result.error === 'changes_closed') announce(COPY.changesClosed);
    void refresh();
  };

  return (
    <section className="my-tickets">
      <h1>My tickets</h1>
      {orders.length === 0 ? <p>No tickets yet.</p> : null}
      <ul className="order-list">
        {orders.map((order) => (
          <li key={order.id}>
            <article aria-label={`Order ${order.id}`}>
              <h2>{order.performanceTitle}</h2>
              <p className="start-label figures">{order.startsAtVenue}</p>
              <p className="figures">{`Order ${order.id}`}</p>
              <ul className="ticket-list">
                {order.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <span className="ticket-seat">{ticket.label}</span>
                    <span className="ticket-tier">{ticket.tierName}</span>
                    <span className="figures">{formatMoney(ticket.faceCents)}</span>
                    <span className="figures">{formatMoney(ticket.seatFeeCents)}</span>
                    <span className="ticket-status">{STATUS_WORDS[ticket.status]}</span>
                    {ticket.status === 'issued' && changesOpen(order.performanceId) ? (
                      <>
                        <button
                          type="button"
                          aria-label={`Exchange ${ticket.label}`}
                          onClick={() => go(`/p/${order.performanceId}?exchange=${ticket.id}`)}
                        >
                          Exchange
                        </button>
                        <button
                          type="button"
                          aria-label={`Refund ${ticket.label}`}
                          onClick={() => openRefund(order, ticket)}
                        >
                          Refund
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ul>

      <section className="waitlist" aria-label="Waitlist">
        <h2>Waitlist</h2>
        {entries.length === 0 ? <p>No waitlist places.</p> : null}
        <ul>
          {entries.map((entry) => {
            const performance = performances.find((candidate) => candidate.id === entry.performanceId);
            return (
              <li key={entry.id}>
                <span>{performance?.title ?? entry.performanceId}</span>
                <span>{entry.tierName}</span>
                {entry.position === null ? null : <span className="figures">{`Place ${entry.position}`}</span>}
                {entry.offer !== null && entry.offer.status === 'open' ? (
                  <Link to={`/offers/${entry.offer.token}`} className="action-link">
                    View offer
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {intent !== null ? (
        <Dialog title="Refund ticket" closable={!refunding} onClose={() => setIntent(null)}>
          <h2>Refund ticket</h2>
          <p>{intent.ticket.label}</p>
          <p className="figures">{`Refund ${formatMoney(intent.amountCents)}`}</p>
          {intent.includesOrderFee ? <p>Includes the order fee</p> : null}
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              disabled={refunding}
              onClick={() => {
                void confirmRefund();
              }}
            >
              {refunding ? 'Confirming refund' : 'Confirm refund'}
            </button>
            <button type="button" disabled={refunding} onClick={() => setIntent(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
