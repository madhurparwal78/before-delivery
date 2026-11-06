import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Live, useApp, type Message } from "../app.js";
import { BookingDetails } from "../board/BookingDetails.js";
import { TicketList } from "../board/Tickets.js";
import type { Booking } from "../types.js";

export function Tickets() {
  const { sites } = useApp();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [open, setOpen] = useState<Booking | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const load = useCallback(async () => setBookings((await api<{ bookings: Booking[] }>("GET", "/api/bookings")).bookings), []);
  useEffect(() => { void load(); }, [load]);
  const zoneOf = (siteId: string): string => sites.find((site) => site.id === siteId)?.time_zone ?? "UTC";
  return (
    <main className="page tickets-page">
      <header className="page-head">
        <h1>Tickets</h1>
        <p className="lede">Every booking you hold, printed as a ticket. Open one for its invoice, terms and actions.</p>
      </header>
      <Live label="Tickets status" message={message} />
      <TicketList bookings={bookings} className="ticket-grid" zoneOf={zoneOf} onOpen={setOpen} empty="No tickets yet. Claim time on the Board to print your first one." />
      {open ? (
        <BookingDetails bookingId={open.id} zone={zoneOf(open.site_id)} announce={setMessage} onChanged={() => void load()} onClose={() => setOpen(null)} />
      ) : null}
    </main>
  );
}
