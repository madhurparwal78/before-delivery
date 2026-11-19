import { useEffect, useState } from 'react';
import type { Entry, Order, Performance } from '../shared/api-types';
import { api } from './api';
import { announce } from './live';
import { Dialog } from './dialog';
import { TopBar, UpdatesRegion } from './shell';
import { formatCents } from './seat-map-core';

export function MyTicketsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [refundTicket, setRefundTicket] = useState<{ orderId: string; ticketId: string; label: string; amount: number; includesFee: boolean } | null>(null);
  const [announcedOfferIds, setAnnouncedOfferIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, []);

  const load = async () => {
    const ordersResult = await api<{ orders: Order[] }>('/api/orders');
    if (ordersResult.ok) setOrders(ordersResult.value.orders);
    const entriesResult = await api<{ entries: Entry[] }>('/api/waitlist');
    if (entriesResult.ok) {
      const nextEntries = entriesResult.value.entries;
      for (const entry of nextEntries) {
        if (entry.offer && entry.offer.status === 'open' && !announcedOfferIds.has(entry.offer.token)) {
          announce(`A seat is offered to you: ${entry.offer.label}.`);
          setAnnouncedOfferIds((current) => new Set([...current, entry.offer!.token]));
        }
      }
      setEntries(nextEntries);
    }
    const performancesResult = await api<{ performances: Performance[] }>('/api/performances');
    if (performancesResult.ok) setPerformances(performancesResult.value.performances);
  };

  const refund = async (orderId: string, ticketIds: string[]) => {
    if (!refundTicket) return;
    const result = await api<{ order: Order; refundCents: number }>(`/api/orders/${orderId}/refunds`, {
      method: 'POST',
      body: { ticketIds },
      idempotencyKey: `refund-${orderId}-${ticketIds.join(',')}-${Math.random().toString(36).slice(2)}`,
    });
    if (result.ok) {
      announce(`Refund confirmed: ${formatCents((result.value as { refundCents: number }).refundCents)}.`);
      setRefundTicket(null);
      void load();
      return;
    }
    if (result.error === 'changes_closed') {
      announce('Exchanges and refunds closed 24 hours before the performance.');
      setRefundTicket(null);
      return;
    }
    if (result.error === 'payments_unavailable') {
      announce('Payments are paused right now. Your ticket is unchanged. Please try again shortly.');
      return;
    }
  };

  return (
    <div className="page">
      <TopBar active="tickets" />
      <UpdatesRegion />
      <main className="content my-tickets">
        <h1>My tickets</h1>
        {orders.length === 0 && entries.length === 0 && <p className="empty-state">No tickets yet.</p>}
        {orders.map((order) => (
          <article key={order.id} aria-label={`Order ${order.id}`} className="ticket-order">
            <h2>Order {order.id}</h2>
            <p className="order-title">{order.performanceTitle}</p>
            <p className="start-label">{order.startsAtVenue}</p>
            <ul className="ticket-list">
              {order.tickets.map((ticket) => (
                <li key={ticket.id} className="ticket-line">
                  <span className="ledger-seat">{ticket.label}</span>
                  <span>{ticket.tierName}</span>
                  <span className="amount">{formatCents(ticket.faceCents)}</span>
                  <span className="amount">{formatCents(ticket.seatFeeCents)}</span>
                  <span className="ticket-status">{statusWord(ticket.status)}</span>
                  {ticket.status === 'issued' && (
                    <>
                      <a className="button-link" href={`/p/${order.performanceId}?exchange=${ticket.id}`}>Exchange</a>
                      <button
                        className="refund-button"
                        onClick={() => {
                          const remainingIssued = order.tickets.filter((t) => t.status === 'issued' && t.id !== ticket.id).length;
                          const includesFee = remainingIssued === 0;
                          const amount = ticket.faceCents + ticket.seatFeeCents + (includesFee ? order.orderFeeCents : 0);
                          setRefundTicket({ orderId: order.id, ticketId: ticket.id, label: ticket.label, amount, includesFee });
                        }}
                      >
                        Refund
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
        {entries.length > 0 && (
          <section role="region" aria-label="Waitlist" className="waitlist-region">
            <h2>Waitlist</h2>
            <ul>
              {entries.map((entry) => (
                <li key={entry.id} className="waitlist-line">
                  <span>{performanceTitleOf(performances, orders, entry.performanceId)}</span>
                  <span>{entry.tierName}</span>
                  {entry.status === 'waiting' && <span>Place {entry.position}</span>}
                  {entry.offer && entry.offer.status === 'open' && (
                    <a className="button-link" href={`/offers/${entry.offer.token}`}>View offer</a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Dialog label="Refund ticket" open={refundTicket !== null} onClose={() => setRefundTicket(null)}>
        {refundTicket && (
          <>
            <h2>Refund ticket</h2>
            <p className="difference-line">Refund {formatCents(refundTicket.amount)}</p>
            {refundTicket.includesFee && <p>Includes the order fee</p>}
            <div className="dialog-actions">
              <button className="pay-button" onClick={() => void refund(refundTicket.orderId, [refundTicket.ticketId])}>
                Confirm refund
              </button>
              <button onClick={() => setRefundTicket(null)}>Cancel</button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

function performanceTitleOf(performances: Performance[], orders: Order[], performanceId: string): string {
  const fromOrders = orders.find((o) => o.performanceId === performanceId)?.performanceTitle;
  if (fromOrders) return fromOrders;
  return performances.find((p) => p.id === performanceId)?.title ?? performanceId;
}

function statusWord(status: string): string {
  switch (status) {
    case 'payment_pending':
      return 'Payment pending';
    case 'issued':
      return 'Issued';
    case 'exchange_pending':
      return 'Exchange pending';
    case 'refund_pending':
      return 'Refund pending';
    case 'refunded':
      return 'Refunded';
    default:
      return status;
  }
}
