// Install-day holds (brief: API › Install day hold, Business rules › Install days, Holds).
import { randomUUID } from "node:crypto";
import { requireCaller } from "../auth.js";
import { applyMove, commissionFor, endLapsedHolds, holdView, latestHold, requiredPieces, type HoldRow } from "../commissions.js";
import { allPiecesPlaced } from "../rules/placement.js";
import { notify, one, pool, tx } from "../db.js";
import { fail, invalid, jsonBody, noContent, ok, record, type Request, type Router } from "../http.js";
import { queueCrmEvent } from "../crm.js";
import { holdExpiresAt, isBookable, isCalendarDate, isoInZone } from "../rules/calendar.js";
import { nextFreeDays } from "./venues.js";

async function hold(req: Request) {
  const caller = await requireCaller(req);
  const date = record(jsonBody(req)).date;
  return tx(async (db) => {
    const now = Date.now();
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (c.clientId !== caller.id) fail(403, "forbidden");
    await endLapsedHolds(db, now, { commissionId: c.id });
    if (!["placed", "held"].includes(c.state)) fail(409, "illegal_state");
    if (!allPiecesPlaced(requiredPieces(c), c.layout)) fail(409, "placement_incomplete");
    if (!isCalendarDate(date)) invalid({ date: "Pick a day from 21 days to one year ahead." });
    await endLapsedHolds(db, now, { venueId: c.venue.id, date });
    const recordedAt = Math.floor(now / 1000) * 1000;
    const expiresAt = holdExpiresAt(recordedAt);
    // A new hold releases this commission's previous one in the same step.
    await db.query("UPDATE holds SET status = 'released', ended_at = $2 WHERE commission_id = $1 AND status = 'held'", [c.id, new Date(now)]);
    const created = await one<HoldRow & Record<string, unknown>>(
      `INSERT INTO holds (id, commission_id, venue_id, date, recorded_at, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'held')
       ON CONFLICT (venue_id, date) WHERE status IN ('held', 'booked') DO NOTHING
       RETURNING id, commission_id, venue_id, date, recorded_at, expires_at, status`,
      [randomUUID(), c.id, c.venue.id, date, new Date(recordedAt), new Date(expiresAt)], db,
    );
    if (!created) {
      await endLapsedHolds(db, now, { venueId: c.venue.id });
      fail(409, "day_taken", { message: "That day was just taken.", nextFreeDays: await nextFreeDays(db, c.venue, date, now) });
    }
    if (!isBookable(date, c.venue.timeZone, now)) invalid({ date: "Pick a day from 21 days to one year ahead." });
    await applyMove(db, c, "held", "system");
    await queueCrmEvent(db, c, "slot.held", { venueId: c.venue.id, date, expiresAt: isoInZone(expiresAt, c.venue.timeZone) });
    await notify(db, "hold.updated", { commissionId: c.id, status: "held" });
    return ok(holdView(created, c.venue.timeZone, now), 201);
  });
}

async function current(req: Request) {
  const caller = await requireCaller(req);
  const now = Date.now();
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  await tx((db) => endLapsedHolds(db, now, { commissionId: c.id }));
  const latest = await latestHold(pool, c.id);
  return latest ? ok(holdView(latest, c.venue.timeZone, now)) : fail(404, "not_found");
}

async function release(req: Request) {
  const caller = await requireCaller(req);
  return tx(async (db) => {
    const now = Date.now();
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (c.clientId !== caller.id) fail(403, "forbidden");
    await endLapsedHolds(db, now, { commissionId: c.id });
    const released = await db.query("UPDATE holds SET status = 'released', ended_at = $2 WHERE commission_id = $1 AND status = 'held'", [c.id, new Date(now)]);
    if (released.rowCount) await applyMove(db, c, "placed", "system");
    await notify(db, "hold.updated", { commissionId: c.id, status: "released" });
    return noContent();
  });
}

export function registerHolds(router: Router): void {
  router.add("POST", "/api/commissions/:id/hold", hold);
  router.add("GET", "/api/commissions/:id/hold", current);
  router.add("DELETE", "/api/commissions/:id/hold", release);
}
