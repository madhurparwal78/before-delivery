// The ticket rail: the member's live holds and bookings for the shown date as paper slips, in time order
// ("HH:MM" strings sort as times), plus the prepaid balance.

import { formatHours } from "../../shared/rules.js";
import { shortDate } from "../../shared/zone.js";
import { countdown } from "../format.js";

export interface Ticket {
  kind: "hold" | "booking";
  id: string;
  stationName: string;
  date: string;
  start: string;
  end: string;
  /** hold, confirmed or payment pending */
  state: "hold" | "confirmed" | "payment pending";
  expiresAt: number | null;
}

interface Props {
  tickets: Ticket[];
  balanceMinutes: number | null;
  now: number;
  onOpen: (ticket: Ticket, opener: HTMLElement) => void;
}

function EmptyRail() {
  return (
    <div class="rail__empty">
      <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true" focusable="false">
        <path d="M4 6h40l8 8v22H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3" />
        <path d="M12 18h24M12 26h16" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <p>No tickets on this date. Drag across a free row to paint a run.</p>
    </div>
  );
}

export function Rail({ tickets, balanceMinutes, now, onOpen }: Props) {
  const ordered = [...tickets].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <section class="rail" aria-label="My tickets">
      <p class="rail__balance num">
        Prepaid <strong>{formatHours(balanceMinutes ?? 0)}</strong> h
      </p>
      {ordered.length === 0 ? (
        <EmptyRail />
      ) : (
        <ul class="rail__list">
          {ordered.map((ticket) => (
            <li key={ticket.id} class="rail__item">
              <button
                type="button"
                class={`ticket ticket--${ticket.kind}`}
                data-ticket={ticket.id}
                aria-label={`Ticket ${ticket.stationName}, ${ticket.date} ${ticket.start}–${ticket.end}, ${ticket.state}`}
                onClick={(event) => onOpen(ticket, event.currentTarget)}
              >
                <span class="ticket__station">{ticket.stationName}</span>
                <span class="ticket__when num">
                  <span>{shortDate(ticket.date)}</span>
                  <span>
                    {ticket.start}–{ticket.end}
                  </span>
                </span>
                {ticket.state === "payment pending" && <span class="stamp">Payment pending</span>}
                {ticket.kind === "hold" && ticket.expiresAt !== null && (
                  <span class="ticket__timer">
                    <span class="ticket__timer-label">Hold</span>
                    <span role="timer" aria-label="Hold time left" class="num">
                      {countdown(ticket.expiresAt - now)}
                    </span>
                  </span>
                )}
                {ticket.kind === "booking" && <span class="ticket__state">Booked</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
