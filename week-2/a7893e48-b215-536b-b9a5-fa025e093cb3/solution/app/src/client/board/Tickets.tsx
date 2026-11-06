import { useLayoutEffect, useRef } from "react";
import { clock, hours, localDate, money, stampParts, STATUS_STAMPS } from "../format.js";
import { MOTION, tween } from "../tween.js";
import type { Booking } from "../types.js";

/** Payment label of a booking: Paid, Pack, or Balance due by <local date> <HH:MM>. */
export function paymentLabel(booking: Booking, zone: string): { label: string; amount: string } {
  if (booking.status.includes("cancelled")) {
    const { card_refund_cents: card, deposit_refund_cents: deposit, pack_minutes_returned: pack } = booking.refund;
    if (booking.status === "cancelled_refunded") return { label: "Refunded", amount: `${money(card)} card · ${money(deposit)} deposit · ${hours(pack)} h` };
    return { label: booking.status === "unpaid_cancelled" ? "Deposit kept" : "Nothing refunded", amount: money(0) };
  }
  if (booking.paid && booking.card_minutes === 0) return { label: "Pack", amount: `${hours(booking.pack_minutes)} h` };
  if (booking.paid) return { label: "Paid", amount: money(booking.card_cents) };
  const due = booking.balance_due_by ?? booking.start_at;
  return { label: `Balance due by ${localDate(zone, due)} ${clock(zone, due)}`, amount: money(booking.balance_due_cents) };
}

interface TicketProps {
  booking: Booking;
  zone: string;
  entering: boolean;
  onOpen: (booking: Booking, opener: HTMLElement) => void;
}

/** A printed order slip: perforated top edge, mono numerals and a boxed status stamp. */
function Ticket({ booking, zone, entering, onOpen }: TicketProps) {
  const item = useRef<HTMLLIElement>(null);
  const slides = useRef(entering);
  useLayoutEffect(() => {
    const element = item.current;
    if (!slides.current || !element) return undefined;
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    return tween(MOTION.slide, (progress) => {
      element.style.opacity = String(progress);
      element.style.transform = progress >= 1 ? "" : `translateX(${(56 * (1 - progress)).toFixed(2)}px)`;
    });
  }, []);
  const start = stampParts(booking.local_start);
  const end = stampParts(booking.local_end);
  const payment = paymentLabel(booking, zone);
  const cancelled = booking.status.includes("cancelled");
  return (
    <li ref={item} className={`ticket-item${cancelled ? " ticket-void" : ""}`}>
      <button type="button" className="ticket slip" onClick={(event) => onOpen(booking, event.currentTarget)}>
        <span className="ticket-head">
          <span className="ticket-station">{booking.station_name}</span>
          <span className={`stamp stamp-${booking.status}`}>{STATUS_STAMPS[booking.status]}</span>
        </span>
        <span className="ticket-date mono">{start.date}</span>
        <span className="ticket-time mono">{start.time} – {end.date === start.date ? end.time : `${end.date} ${end.time}`}</span>
        <span className="ticket-foot">
          <span className="ticket-hours mono">{hours(booking.minutes)} h</span>
          <span className="ticket-pay"><span>{payment.label}</span> <span className="mono">{payment.amount}</span></span>
        </span>
        <span className="ticket-business">{booking.renter_business}</span>
      </button>
    </li>
  );
}

interface TicketListProps {
  bookings: Booking[] | null;
  zoneOf: (siteId: string) => string;
  onOpen: (booking: Booking, opener: HTMLElement) => void;
  className: string;
  empty: string;
}

/** The rail or list of tickets; tickets that appear after the first load slide in from the right. */
export function TicketList({ bookings, zoneOf, onOpen, className, empty }: TicketListProps) {
  const seen = useRef<Set<string> | null>(null);
  const known = seen.current;
  useLayoutEffect(() => {
    if (bookings) seen.current = new Set(bookings.map((booking) => booking.id));
  }, [bookings]);
  if (!bookings) {
    return (
      <ul aria-label="Booking tickets" className={className} aria-busy="true">
        <li className="ticket-item ticket-placeholder" aria-hidden="true"><span className="ticket slip" /></li>
        <li className="ticket-item ticket-placeholder" aria-hidden="true"><span className="ticket slip" /></li>
      </ul>
    );
  }
  return (
    <ul aria-label="Booking tickets" className={className}>
      {bookings.length === 0 ? (
        <li className="ticket-empty">
          <svg aria-hidden="true" viewBox="0 0 64 64" width="56" height="56"><path d="M32 6v16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="32" cy="6" r="3" fill="currentColor" /><path d="M14 26h36v30l-6-4-6 4-6-4-6 4-6-4-6 4z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /><path d="M22 36h20M22 44h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span>{empty}</span>
        </li>
      ) : bookings.map((booking) => (
        <Ticket key={booking.id} booking={booking} zone={zoneOf(booking.site_id)} entering={known !== null && !known.has(booking.id)} onOpen={onOpen} />
      ))}
    </ul>
  );
}
