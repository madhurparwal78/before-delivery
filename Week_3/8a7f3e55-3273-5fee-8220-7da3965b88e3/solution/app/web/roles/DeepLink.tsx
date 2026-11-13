import { useState } from "react";
import type { Booking, SessionUser } from "../../shared/api";
import { Detail } from "../components/Detail";
import { NotAvailable } from "../components/ListParts";
import { ApiFailure, apiGet } from "../lib/api";
import { usePolled } from "../lib/refresh";

/** `/bookings/<id>`: the same detail as the role's home shows, or the not-available message and no booking data. */
export function DeepLink({ id, user }: { id: string; user: SessionUser }) {
  const booking = usePolled<Booking>(`deep:${id}`, () => apiGet<Booking>(`/api/bookings/${id}`));
  const [gone, setGone] = useState(false);
  const missing = gone || (booking.failure instanceof ApiFailure && booking.failure.status === 404);
  return (
    <main className="screen screen--single">
      <div className="detail-pane">
        {booking.data !== undefined && !missing ? (
          <Detail
            key={booking.data.id}
            booking={booking.data}
            user={user}
            focusToken={0}
            onBack={null}
            onBooking={booking.put}
            onWithdrawn={() => setGone(true)}
            onClaimed={booking.put}
          />
        ) : missing ? (
          <NotAvailable />
        ) : (
          <section className="detail detail--empty" aria-label="Loading booking">
            <p className="empty-note">Loading…</p>
          </section>
        )}
      </div>
    </main>
  );
}
