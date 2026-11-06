import { many, pool, tx } from "../db.js";
import { conflict, validation } from "../http.js";
import { lockedReservation, reload, reservationView, transition } from "../reservations.js";
import { SOLD_STATES, checkinConflict, openCourseDay, venueToday, type CheckinConflict } from "../rules.js";
import { route } from "../router.js";
import { fields } from "../validate.js";

const MAX_RESULTS = 10;

const CONFLICT_MESSAGE: Record<CheckinConflict, string> = {
  checkin_closed: "Check-in is closed today.",
  no_attendee: "This seat has no attendee yet. Send them to the registrar.",
  already_checked_in: "This attendee is already checked in for that day.",
  balance_due: "This attendee has a balance due. Send them to the registrar.",
  not_checked_in_day1: "This attendee has no day 1 check-in. Send them to the registrar.",
};

route({
  method: "GET",
  path: "/api/checkin",
  access: ["frontdesk"],
  handle: async (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    if (q.length < 2) throw validation({ q: "Type at least two characters of the name." });
    const today = venueToday(ctx.now);
    const results = await many<{ reservation_id: string; attendee_name: string; bench: string; day1: boolean; day2: boolean }>(
      pool,
      `SELECT id AS reservation_id, attendee_name, bench, checked_in_day1 AS day1, checked_in_day2 AS day2 FROM reservations
       WHERE attendee_name IS NOT NULL AND state = ANY($2) AND attendee_name ILIKE $1
       ORDER BY attendee_name, bench LIMIT ${MAX_RESULTS}`,
      [`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, SOLD_STATES],
    );
    return { status: 200, body: { q, venue_date: today, open_day: openCourseDay(today), results } };
  },
});

route({
  method: "POST",
  path: "/api/checkin",
  access: ["frontdesk"],
  handle: (ctx) =>
    tx(async (db) => {
      const body = fields(ctx.body);
      if (typeof body.reservation_id !== "string") throw validation({ reservation_id: "Choose a reservation." });
      const row = await lockedReservation(db, body.reservation_id);
      const day = body.day === 1 || body.day === 2 ? body.day : null;
      if (!day) throw validation({ day: "Day is 1 or 2." });
      const refused = checkinConflict(
        { state: row.state, attendeeAccepted: row.attendee_accepted, checkedIn: { day1: row.checked_in_day1, day2: row.checked_in_day2 } },
        day,
        venueToday(ctx.now),
      );
      if (refused) throw conflict(refused, CONFLICT_MESSAGE[refused]);
      await transition(db, [row], day === 1 ? "checked_in_day1" : "checked_in_day2", day === 1 ? { checked_in_day1: true } : { checked_in_day2: true });
      return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }),
});
