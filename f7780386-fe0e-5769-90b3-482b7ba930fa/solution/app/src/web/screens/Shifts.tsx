// Shifts (crew cook home): upcoming shifts the member business booked, each with its own check-in control.

import { useState } from "preact/hooks";
import type { Booking, CheckIn } from "../../shared/api.js";
import { longDate, wallInstant } from "../../shared/zone.js";
import { minutesOf } from "../board/model.js";
import type { Session } from "../App.js";
import { get, post, serverNow } from "../api.js";
import { perform } from "../feedback.js";
import { BOOKING_STATUS_WORDS, kitchenClock } from "../format.js";
import { ScreenHead, useData } from "./shared.js";

export function ShiftsScreen({ session }: { session: Session }) {
  const { user, kitchen } = session;
  const shifts = useData(() => get<{ bookings: Booking[] }>("/api/bookings"), []);
  const [busy, setBusy] = useState<string | null>(null);

  const checkIn = async (booking: Booking) => {
    setBusy(booking.id);
    await perform(
      "Checking in…",
      () => post<{ check_in: CheckIn; booking: Booking }>(`/api/bookings/${booking.id}/check-ins`),
      () => `Checked in for ${booking.station_name}, ${booking.start}–${booking.end}.`,
      (failure) => {
        if (failure.body.error === "food_handler_card_not_current") return { text: "Your food handler card is not approved and current for this shift." };
        if (failure.body.error === "outside_check_in_window") return { text: "Check-in opens 15 minutes before the shift starts and closes when it ends." };
        return null;
      },
    );
    setBusy(null);
    await shifts.reload();
  };

  const notEnded = (b: Booking) => wallInstant(b.date, minutesOf(b.end), kitchen.time_zone) > serverNow();
  const upcoming = (shifts.data?.bookings ?? []).filter((b) => (b.status === "confirmed" || b.status === "checked_in") && notEnded(b));
  return (
    <section class="screen">
      <ScreenHead title="Shifts">
        <p class="screen-head__note">Shifts {user.business_name} booked. Check in from 15 minutes before the start under your own food handler card.</p>
      </ScreenHead>
      {!shifts.data && <p class="panel">Loading…</p>}
      {shifts.data && upcoming.length === 0 && <p class="panel">No upcoming shifts.</p>}
      <ul class="shifts" aria-label="Upcoming shifts">
        {upcoming.map((b) => {
          const mine = b.check_ins.find((c) => c.crew_cook_id === user.id);
          return (
            <li key={b.id} class="shift">
              <div class="shift__when">
                <p class="shift__station">{b.station_name}</p>
                <p class="num">
                  {longDate(b.date)} · {b.start}–{b.end}
                </p>
              </div>
              <div class="shift__state">
                <span class="status-word">{BOOKING_STATUS_WORDS[b.status]}</span>
                {b.payment === "payment_pending" && <span class="stamp">Payment pending</span>}
                {mine ? (
                  <span class="shift__checked num">Checked in {kitchenClock(mine.at, kitchen.time_zone)}</span>
                ) : (
                  <button type="button" class="button button--primary" disabled={busy !== null} aria-busy={busy === b.id ? "true" : "false"} aria-label={`Check in: ${b.station_name}, ${b.date} ${b.start}`} onClick={() => void checkIn(b)}>
                    Check in
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
