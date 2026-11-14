import { useCallback, useEffect, useState } from "react";
import { ApiError, type Booking as BookingBody, call, messageOf } from "../api";
import { setServerNow } from "../clock";
import { ErrorBand } from "../components/Feedback";
import { clubDate, clubDateTime, clubTime, euros } from "../format";
import { NotFound } from "./NotFound";

const refreshMs = 10_000;
const statusWords: Record<string, string> = {
  held: "Held",
  paid: "Paid",
  released: "Released",
  "checked-in": "Checked in",
  "no-show": "No-show",
  cancelled: "Cancelled",
};
const shareWords = { due: "Due", paid: "Paid", void: "Void", covered: "Covered" } as const;

export function Booking({ id }: { id: string }) {
  const [booking, setBooking] = useState<BookingBody | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await call<BookingBody>(`/api/bookings/${encodeURIComponent(id)}`);
      setServerNow(body.server_now);
      setBooking(body);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setError(messageOf(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(timer);
  }, [load]);

  if (missing) return <NotFound />;
  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">Booking</h1>
        {error && !booking && <ErrorBand>{error}</ErrorBand>}
        {!booking && !error && <p className="muted">Loading…</p>}
        {booking && (
          <>
            <article className="card booking-card">
              <p className="booking-card__slot">
                Court {booking.court}, {clubDate(booking.start)} {clubTime(booking.start)} · {booking.minutes} minutes
              </p>
              <p>
                <span className={`status-word status-word--${booking.status}`}>{statusWords[booking.status]}</span>{" "}
                <span className="muted">{euros(booking.total_cents)} in all</span>
              </p>
              {booking.note && <p>Note: {booking.note}</p>}
              {booking.kind === "booking" && booking.settle_at && booking.shares.length > 1 && (
                <p>Unpaid shares go on the organiser&apos;s card at {clubDateTime(booking.settle_at)}.</p>
              )}
            </article>
            <div className="table-card" tabIndex={0}>
              <table role="table" aria-label="Shares" className="data-table">
                <thead>
                  <tr role="row">
                    <th role="columnheader">Player</th>
                    <th role="columnheader">Amount</th>
                    <th role="columnheader">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {booking.shares.map((share) => (
                    <tr role="row" key={share.position}>
                      <td role="cell" data-label="Player">
                        {share.player.name}
                      </td>
                      <td role="cell" data-label="Amount">
                        {euros(share.amount_cents)}
                      </td>
                      <td role="cell" data-label="Status">
                        <span className={`status-word status-word--${share.status}`}>{shareWords[share.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
