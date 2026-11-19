// My tickets: the buyer's orders newest first, each ticket's status and changes, and their waitlist places.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatMoney, refundCents } from "../../shared/rules.js";
import type { Entry, Order, Performance, Ticket, TicketStatus } from "../../shared/types.js";
import { announce } from "../announce.js";
import { get, newKey, request } from "../api.js";
import { Dialog, EmptyState, Link, NoticeRegion } from "../components.js";
import { CHANGES_CLOSED, TICKET_PAUSED } from "../copy.js";
import { useLive, useLoader } from "../live.js";
import { navigate } from "../router.js";

const STATUS_WORDS: Record<TicketStatus, string> = {
  payment_pending: "Payment pending",
  issued: "Issued",
  exchange_pending: "Exchange pending",
  refund_pending: "Refund pending",
  refunded: "Refunded",
};

const ENTRY_WORDS: Record<Entry["status"], string> = {
  waiting: "Waiting",
  offered: "Offered",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Offer ended",
};

interface RefundTarget {
  order: Order;
  ticket: Ticket;
}

export function MyTickets(): JSX.Element {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [shows, setShows] = useState<Map<string, Performance>>(new Map());
  const [refunding, setRefunding] = useState<RefundTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingRefund, setPendingRefund] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  const refresh = useLoader(async () => {
    const [orderAnswer, entryAnswer, showAnswer] = await Promise.all([
      get<{ orders: Order[] }>("/api/orders"),
      get<{ entries: Entry[] }>("/api/waitlist"),
      get<{ performances: Performance[] }>("/api/performances"),
    ]);
    if (orderAnswer.ok) setOrders(orderAnswer.data.orders);
    if (entryAnswer.ok) setEntries(entryAnswer.data.entries);
    if (showAnswer.ok) setShows(new Map(showAnswer.data.performances.map((p) => [p.id, p])));
  });
  useEffect(refresh, []);
  useLive((event) => {
    if (event.type === "buyer" || event.type === "resync" || event.type === "offer") refresh();
  });

  const exchange = (order: Order, ticket: Ticket): void => {
    const [section] = ticket.seatId.split("-");
    navigate(`/p/${order.performanceId}?section=${section}&seat=${ticket.seatId}&tier=all&exchange=${ticket.id}`);
  };

  const confirmRefund = async (): Promise<void> => {
    if (!refunding) return;
    const { order, ticket } = refunding;
    setPendingRefund(ticket.id);
    setMessage("");
    const result = await request<{ order: Order; refundCents: number }>("POST", `/api/orders/${order.id}/refunds`, { ticketIds: [ticket.id] }, newKey());
    setPendingRefund(null);
    if (result.ok) {
      announce(`Refund confirmed: ${formatMoney(result.data.refundCents)}.`);
      setOrders((list) => list?.map((o) => (o.id === order.id ? result.data.order : o)) ?? null);
      setDialogOpen(false);
    } else {
      const copy = result.error.error === "changes_closed" ? CHANGES_CLOSED
        : result.error.error === "payments_unavailable" ? TICKET_PAUSED
          : Object.values(result.error.fields ?? {})[0] ?? "";
      if (copy) announce(copy);
      setMessage(copy);
    }
    refresh();
  };

  const statusOf = (ticket: Ticket): TicketStatus => (pendingRefund === ticket.id ? "refund_pending" : ticket.status);

  return (
    <div class="page-narrow">
      <div class="page-head">
        <p class="kicker">Box office</p>
        <h1 tabIndex={-1} ref={heading}>My tickets</h1>
      </div>
      {orders === null ? (
        <div aria-busy="true"><div class="skeleton-line" /><div class="skeleton-line" /></div>
      ) : orders.length === 0 ? (
        <EmptyState text="No tickets yet.">
          <p><Link href="/" class="button quiet">See the programme</Link></p>
        </EmptyState>
      ) : orders.map((order) => {
        const changesOpen = shows.get(order.performanceId)?.changesOpen ?? false;
        return (
          <article class="order" key={order.id} aria-labelledby={`order-${order.id}`}>
            <h2 id={`order-${order.id}`} class="order-number">Order {order.id}</h2>
            <p><strong>{order.performanceTitle}</strong> · {order.startsAtVenue}</p>
            <ul class="ticket-list">
              {order.tickets.map((ticket) => {
                const status = statusOf(ticket);
                return (
                  <li class="ticket" key={ticket.id}>
                    <div>
                      <p class="seat-name">{ticket.label}</p>
                      <p class="seat-tier">{ticket.tierName}</p>
                      <p><span class="status-word" data-status={status}>{STATUS_WORDS[status]}</span></p>
                    </div>
                    <div class="seat-amounts">
                      <span>Face</span> <span class="amount">{formatMoney(ticket.faceCents)}</span>
                      <span>Seat fee</span> <span class="amount">{formatMoney(ticket.seatFeeCents)}</span>
                    </div>
                    {status === "issued" && changesOpen ? (
                      <div class="ticket-actions">
                        <button type="button" class="quiet" aria-label={`Exchange ${ticket.label}`} onClick={() => exchange(order, ticket)}>Exchange</button>
                        <button type="button" class="quiet" aria-label={`Refund ${ticket.label}`} onClick={() => {
                          setRefunding({ order, ticket });
                          setMessage("");
                          setDialogOpen(true);
                        }}>Refund</button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}

      <section aria-labelledby="waitlist-heading" class="waitlist" role="region">
        <h2 id="waitlist-heading">Waitlist</h2>
        {entries.length === 0 ? <p class="empty-line">You are not on any waitlist.</p> : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <span>
                  <strong>{shows.get(entry.performanceId)?.title ?? entry.performanceId}</strong> · {entry.tierName}
                </span>
                <span>
                  {entry.status === "waiting" && entry.position !== null ? <span class="fig">Place {entry.position}</span>
                    : entry.offer?.status === "open" ? <Link href={`/offers/${entry.offer.token}`} class="button">View offer</Link>
                      : <span class="status-word">{ENTRY_WORDS[entry.status]}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {refunding ? (
        <Dialog label="Refund ticket" open={dialogOpen} busy={pendingRefund !== null} onClose={() => setDialogOpen(false)}
          fallbackFocus={() => heading.current}>
          <div class="dialog-body">
            <h2>Refund ticket</h2>
            <p>{refunding.ticket.label} · {refunding.ticket.tierName}</p>
            {(() => {
              const amount = refundCents(refunding.order.tickets, [refunding.ticket.id]);
              return (
                <div class="ledger">
                  <div class="ledger-row ledger-total"><span>Refund {formatMoney(amount.refundCents)}</span></div>
                  {amount.includesOrderFee ? <p>Includes the order fee</p> : null}
                </div>
              );
            })()}
            <NoticeRegion label="Refund notice" text={message} />
            <div class="dialog-actions">
              <button type="button" disabled={pendingRefund !== null} onClick={() => void confirmRefund()}>
                {pendingRefund ? "Confirming refund" : "Confirm refund"}
              </button>
              <button type="button" class="quiet" onClick={() => setDialogOpen(false)}>Cancel</button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
