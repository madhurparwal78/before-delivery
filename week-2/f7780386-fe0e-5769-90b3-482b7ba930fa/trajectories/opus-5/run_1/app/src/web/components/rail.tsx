import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Booking, Segment } from '../../shared/api.js';
import { formatHours } from '../../shared/format.js';
import { formatDayMonth } from '../../shared/time.js';
import { formatCountdown, secondsUntil } from '../clock.js';

export interface RailTicket {
  key: string;
  stationName: string;
  date: string;
  start: string;
  end: string;
  state: 'hold' | 'confirmed' | 'payment pending';
  expiresAt: string | null;
  segment: Segment;
  booking: Booking | null;
}

function HoldTimer({ expiresAt }: { expiresAt: string }): ReactNode {
  const [left, setLeft] = useState(() => secondsUntil(expiresAt));
  useEffect(() => {
    setLeft(secondsUntil(expiresAt));
    const handle = window.setInterval(() => setLeft(secondsUntil(expiresAt)), 1000);
    return () => window.clearInterval(handle);
  }, [expiresAt]);
  return (
    <span role="timer" aria-label="Hold time left" className="timer">
      {formatCountdown(left)}
    </span>
  );
}

export interface RailProps {
  tickets: RailTicket[];
  balanceMinutes: number | null;
  expiringHoldIds: ReadonlySet<string>;
  onOpen: (ticket: RailTicket, restoreFocus: () => void) => void;
}

export function Rail(props: RailProps): ReactNode {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  return (
    <section className="rail" aria-label="My tickets">
      {props.tickets.length === 0 ? (
        <span className="rail-empty">No tickets for this date.</span>
      ) : null}
      <ul className="rail-list">
        {props.tickets.map((ticket) => (
            <li key={ticket.key}>
              <button
                type="button"
                className={
                  `ticket ${ticket.state === 'hold' ? 'hold' : 'booked'}` +
                  (props.expiringHoldIds.has(ticket.key) ? ' expiring' : '')
                }
                ref={(element) => {
                  if (element === null) refs.current.delete(ticket.key);
                  else refs.current.set(ticket.key, element);
                }}
                aria-label={
                  `Ticket ${ticket.stationName}, ${ticket.date} ` +
                  `${ticket.start}–${ticket.end}, ${ticket.state}`
                }
                onClick={() =>
                  props.onOpen(ticket, () => refs.current.get(ticket.key)?.focus())
                }
              >
                <span className="ticket-station">{ticket.stationName}</span>
                <span className="ticket-time">{formatDayMonth(ticket.date)}</span>
                <span className="ticket-time">
                  {ticket.start}–{ticket.end}
                </span>
                {ticket.expiresAt === null ? null : <HoldTimer expiresAt={ticket.expiresAt} />}
                {ticket.state === 'payment pending' ? (
                  <span className="pending">Payment pending</span>
                ) : null}
              </button>
            </li>
          ))}
      </ul>
      {props.balanceMinutes === null ? null : (
        <span className="rail-balance">Prepaid {formatHours(props.balanceMinutes)} h</span>
      )}
    </section>
  );
}
