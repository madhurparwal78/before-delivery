import { audit, lockKitchenDates, pool, transaction } from "../db.js";
import type { BookingRow } from "../domain.js";
import { cancellationEmail } from "../emails.js";
import { refuse } from "../errors.js";
import { json, route } from "../http.js";
import { postCharges, postCredit } from "../killbill.js";
import { isCalendarDate, kitchenDate } from "../kitchenTime.js";
import { stage } from "../mail.js";
import { dollars } from "../money.js";
import { cancelInWindow, type DayAction, dayTransition, requireCancellable } from "../rules.js";
import { requireUp } from "../services.js";
import { BOOKING_COLUMNS, bookingFor, loadKitchen, loadStations, memberFor } from "../store.js";
import { recordMovement } from "../bookingUnit.js";
import { allow, authed } from "../validate.js";
import { bookingView } from "../views.js";

// Without a date the list is every booking (members see their history, cancellations included);
// with a date it is that day's sheet: the bookings that occupy or are charged for the day.
route(
  "GET",
  "/api/bookings",
  authed(async (request, user, now) => {
    const date = request.query.get("date");
    if (date !== null && !isCalendarDate(date)) throw refuse.validation({ date: "Choose a date as YYYY-MM-DD." });
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const found = await pool.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM bookings
        WHERE kitchen_id = $1 AND ($2::text IS NULL OR member_id = $2)
          AND ($3::date IS NULL OR (date = $3 AND state <> 'cancelled_in_window'))`,
      [kitchen.id, user.role === "member" ? user.member_id : null, date],
    );
    const today = kitchenDate(kitchen.timezone, now);
    const upcoming = (b: BookingRow): number => (b.date >= today ? 0 : 1);
    const bookings = found.rows.sort(
      (a, b) =>
        upcoming(a) - upcoming(b) ||
        (upcoming(a) === 0 ? a.starts_at.getTime() - b.starts_at.getTime() : b.starts_at.getTime() - a.starts_at.getTime()) ||
        a.ref.localeCompare(b.ref),
    );
    return json(200, { bookings: bookings.map((b) => bookingView(b, stations)) });
  }),
);

route(
  "GET",
  "/api/bookings/:booking_id",
  authed(async (request, user) => {
    const booking = await bookingFor(user, request.params.booking_id ?? "");
    const stations = await loadStations(user.kitchen_id);
    return json(200, { booking: bookingView(booking, stations) });
  }),
);

route(
  "POST",
  "/api/bookings/:booking_id/cancel",
  authed(async (request, user, now) => {
    const found = await bookingFor(user, request.params.booking_id ?? "");
    allow(user, "operator", "member");
    requireCancellable(found.state);
    requireUp("billing", "mail");
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const member = await memberFor(user, found.member_id);
    return transaction(async (client) => {
      await lockKitchenDates(client, kitchen.id, [found.date]);
      await client.query("SELECT id FROM members WHERE id = $1 FOR NO KEY UPDATE", [member.id]);
      const booking = await bookingFor(user, found.id, client, true);
      requireCancellable(booking.state);
      const inWindow = cancelInWindow(booking.starts_at, booking.cancellation_window_hours, now);
      const state = inWindow ? "cancelled_in_window" : "cancelled_late";
      let refundQuarters = 0;
      if (inWindow) {
        const draws = await client.query<{ id: string; quarters: number }>(
          `SELECT m.id, m.quarters FROM movements m
            WHERE m.booking_id = $1 AND m.kind = 'draw' AND NOT EXISTS (SELECT 1 FROM movements r WHERE r.reverses = m.id)`,
          [booking.id],
        );
        for (const draw of draws.rows) {
          await recordMovement(client, member.id, "refund", draw.quarters, booking.id, draw.id, now);
          refundQuarters += draw.quarters;
        }
      }
      const refundCents = inWindow ? booking.total_cents : 0;
      await client.query("UPDATE bookings SET state = $1, refund_cents = $2, cancelled_at = $3 WHERE id = $4", [
        state,
        refundCents,
        now,
        booking.id,
      ]);
      await audit(client, user.id, "booking", booking.id, booking.state, state, now);
      const email = await stage(cancellationEmail(kitchen, member, booking, inWindow, refundCents, refundQuarters));
      try {
        if (refundCents > 0) await postCredit(client, member, refundCents, `${booking.ref} cancelled in window`);
      } catch (error) {
        email.abandon();
        throw error;
      }
      try {
        await email.accept();
      } catch (error) {
        if (refundCents > 0) {
          await postCharges(client, member, [{ amountCents: refundCents, description: `${booking.ref} cancellation reversed` }]).catch(() => undefined);
        }
        throw error;
      }
      return json(200, {
        booking: bookingView({ ...booking, state, refund_cents: refundCents, cancelled_at: now }, stations),
        refund: { pack_quarters: refundQuarters, amount_cents: refundCents, amount: dollars(refundCents) },
      });
    });
  }),
);

function dayAction(action: DayAction) {
  return authed(async (request, user, now) => {
    const found = await bookingFor(user, request.params.booking_id ?? "");
    allow(user, "operator");
    const kitchen = await loadKitchen(user.kitchen_id);
    const today = kitchenDate(kitchen.timezone, now);
    const stations = await loadStations(kitchen.id);
    return transaction(async (client) => {
      const booking = await bookingFor(user, found.id, client, true);
      const target = dayTransition(booking.state, action, booking.date, today);
      await client.query("UPDATE bookings SET state = $1 WHERE id = $2", [target, booking.id]);
      await audit(client, user.id, "booking", booking.id, booking.state, target, now);
      return json(200, { booking: bookingView({ ...booking, state: target }, stations) });
    });
  });
}

route("POST", "/api/bookings/:booking_id/check-in", dayAction("check_in"));
route("POST", "/api/bookings/:booking_id/complete", dayAction("complete"));
route("POST", "/api/bookings/:booking_id/no-show", dayAction("no_show"));
