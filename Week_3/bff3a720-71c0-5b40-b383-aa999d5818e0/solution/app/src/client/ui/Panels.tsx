import { useState, type ReactElement } from "react";
import type { Booking, BookingWithChange } from "../../shared/api";
import { euros } from "../../shared/money";
import { hhmm, shortDate } from "../../shared/time";
import { leftText } from "../lib/format";
import { api, errorMessage } from "../lib/http";
import { Link } from "../lib/router";
import { Alert } from "./Bits";

/** The passenger's request: waiting, or how it ended. */
export function RequestPanel({ booking, onChanged, withdrawable }: { booking: Booking; onChanged?: (b: Booking) => void; withdrawable?: boolean }): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const driver = booking.driver.display_name;
  const price = euros(booking.price_cents);

  const withdraw = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      onChanged?.(await api<Booking>("POST", `/api/bookings/${booking.id}/withdraw`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  let body: ReactElement;
  if (booking.state === "requested") {
    const expires = booking.expires_at ? new Date(booking.expires_at) : null;
    body = (
      <>
        <p>
          {expires
            ? `Waiting for ${driver} to answer. This request expires at ${hhmm(expires)} on ${shortDate(expires)} (${leftText(booking.expires_in_seconds ?? 0)} left).`
            : `Waiting for ${driver} to answer.`}
        </p>
        {withdrawable ? (
          <button type="button" onClick={() => void withdraw()}>
            {pending ? "Working" : "Withdraw request"}
          </button>
        ) : (
          <Link href={`/bookings/${booking.id}`}>Open your booking</Link>
        )}
        <Alert>{error}</Alert>
      </>
    );
  } else if (booking.state === "expired") {
    body = (
      <>
        <h3 tabIndex={-1}>This request expired</h3>
        <p>{price} is back in your wallet.</p>
      </>
    );
  } else if (booking.state === "declined") {
    body = <p>{`Request declined by ${driver}. ${price} is back in your wallet.`}</p>;
  } else if (booking.state === "withdrawn") {
    body = <p>{`Request withdrawn. ${price} is back in your wallet.`}</p>;
  } else {
    body = <p>{`Request accepted by ${driver}.`}</p>;
  }
  return (
    <section aria-label="Your request" className="panel" data-id={booking.id}>
      {body}
    </section>
  );
}

/** Banner for a booked passenger when the driver moved the departure or cancelled the ride. */
export function RideUpdate({ booking }: { booking: BookingWithChange }): ReactElement | null {
  let text = "";
  if (booking.state === "cancelled_by_driver") {
    text = `${booking.driver.display_name} cancelled this ride. ${euros(booking.price_cents)} is back in your wallet.`;
  } else if (booking.ride_change) {
    const from = new Date(booking.ride_change.from_time);
    const to = new Date(booking.ride_change.to_time);
    text = `Departure moved from ${hhmm(from)} to ${hhmm(to)}.`;
    if (booking.free_cancel_until) {
      const until = new Date(booking.free_cancel_until);
      text += ` You can cancel for free until ${hhmm(until)} on ${shortDate(until)}.`;
    }
  }
  if (!text) return null;
  return (
    <section aria-label="Ride update" className="banner">
      <p>{text}</p>
    </section>
  );
}
