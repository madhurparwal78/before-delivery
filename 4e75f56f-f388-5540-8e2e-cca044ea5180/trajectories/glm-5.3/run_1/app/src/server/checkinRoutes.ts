import { Router } from "express";
import type { Config } from "./config.js";
import { query } from "./db.js";
import { requireRole } from "./auth.js";
import { conflict, validation } from "./errors.js";
import { venueDate, openCheckinDay } from "./time.js";

export function makeCheckinRouter(cfg: Config): Router {
  const router = Router();

  // GET /api/checkin?q= — frontdesk.
  router.get("/checkin", async (req, res, next) => {
    try {
      await requireRole(req, "frontdesk");
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const venue = venueDate(cfg.benchDaysNow);
      if (q.length < 2) {
        res.status(422).json({ error: "validation", message: "Type at least two characters.", errors: { q: "Type at least two characters." } });
        return;
      }
      const { rows } = await query<{ id: string; attendee_name: string | null; bench: string; day1: Date | null; day2: Date | null }>(
        `SELECT id, attendee_name, bench, checked_in_day1, checked_in_day2
         FROM reservations
         WHERE attendee_name IS NOT NULL AND attendee_name ILIKE '%' || $1 || '%'
           AND state IN ('deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
         ORDER BY attendee_name
         LIMIT 10`,
        [q]
      );
      res.json({
        q,
        venue_date: venue,
        open_day: openCheckinDay(venue),
        results: rows.map((r) => ({
          reservation_id: r.id,
          attendee_name: r.attendee_name,
          bench: r.bench,
          day1: r.day1 !== null,
          day2: r.day2 !== null,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/checkin — frontdesk.
  router.post("/checkin", async (req, res, next) => {
    try {
      await requireRole(req, "frontdesk");
      const reservationId = req.body?.reservation_id;
      const day = req.body?.day;
      if (typeof reservationId !== "string" || (day !== 1 && day !== 2)) {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { reservation_id: "Choose an attendee.", day: "Choose day 1 or 2." } });
        return;
      }
      const venue = venueDate(cfg.benchDaysNow);
      const openDay = openCheckinDay(venue);
      // The conflict order: checkin_closed, no_attendee, already_checked_in,
      // balance_due, not_checked_in_day1.
      const { rows } = await query<{
        id: string; state: string; attendee_name: string | null; attendee_email: string | null;
        attendee_accepted: boolean; checked_in_day1: Date | null; checked_in_day2: Date | null;
      }>(
        "SELECT id, state, attendee_name, attendee_email, attendee_accepted, checked_in_day1, checked_in_day2 FROM reservations WHERE id = $1",
        [reservationId]
      );
      const r = rows[0];
      if (!r) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (!openDay) {
        res.status(409).json({ error: "checkin_closed", message: "Check-in is closed today." });
        return;
      }
      if (r.state === "held" || r.state === "released" || r.state === "cancelled" || r.state === "refunded" || !r.attendee_accepted || !r.attendee_name || !r.attendee_email) {
        res.status(409).json({ error: "no_attendee", message: "This seat has no attendee yet." });
        return;
      }
      if (openDay === 1 && r.checked_in_day1) {
        res.status(409).json({ error: "already_checked_in", message: "Already checked in for day 1." });
        return;
      }
      if (openDay === 2 && r.checked_in_day2) {
        res.status(409).json({ error: "already_checked_in", message: "Already checked in for day 2." });
        return;
      }
      if (r.state === "deposit_paid") {
        res.status(409).json({ error: "balance_due", message: "This seat has a balance due." });
        return;
      }
      if (openDay === 2 && r.state === "paid_in_full" && !r.checked_in_day1) {
        res.status(409).json({ error: "not_checked_in_day1", message: "No day 1 check-in." });
        return;
      }
      if (openDay === 1) {
        await query("UPDATE reservations SET state = 'checked_in_day1', checked_in_day1 = now() WHERE id = $1", [reservationId]);
      } else {
        await query("UPDATE reservations SET state = 'checked_in_day2', checked_in_day2 = now() WHERE id = $1", [reservationId]);
      }
      const { rows: after } = await query<{ id: string; bench: string; tier: string; state: string; attendee_name: string | null; attendee_email: string | null; attendee_accepted: boolean; checked_in_day1: Date | null; checked_in_day2: Date | null }>("SELECT id, bench, tier, state, attendee_name, attendee_email, attendee_accepted, checked_in_day1, checked_in_day2 FROM reservations WHERE id = $1", [reservationId]);
      const row = after[0]!;
      res.status(201).json({
        reservation: {
          id: row.id,
          bench: row.bench,
          tier: row.tier,
          state: row.state,
          attendee: row.attendee_name ? { name: row.attendee_name, email: row.attendee_email, accepted: row.attendee_accepted } : null,
          checked_in: { day1: row.checked_in_day1 !== null, day2: row.checked_in_day2 !== null },
        },
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
