import { Router } from "express";
import { asyncRoute, checkCredentials, makeSession, requireUser } from "./auth.js";
import { ApiError, notFound, validation } from "./errors.js";
import { visibleSites, siteInScope, stationInScope, renterForStaff, getSite, getRenter } from "./scope.js";
import { q, withStationLock } from "./db.js";
import { HOLD_TTL_SECONDS } from "./config.js";
import {
  buildOccurrences, findConflict, loadHold, assertHoldScope, isDate, isTime, iso, localDate,
  parseIso, resolveWallTime, hhmmOf, dayMinutes, dayTicks, Occ, uid,
} from "./api-core.js";
import type { Segment, SegmentState, SessionUser } from "../shared/types.js";
import { packBalance } from "./pack.js";
import { registerBookingRoutes } from "./routes2.js";
import { registerOtherRoutes } from "./routes3.js";

export const router = Router();
registerBookingRoutes(router);
registerOtherRoutes(router);

/* ---------------------------------- session ---------------------------------- */

function sessionUser(user: SessionUser): Record<string, unknown> {
  return { id: user.id, name: user.name, email: user.email, role: user.role, operator_id: user.operator_id, site_ids: user.site_ids, renter_id: user.renter_id };
}

router.post("/api/session", asyncRoute(async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown };
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
  }
  const user = await checkCredentials(body.email, body.password);
  if (!user) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
  res.setHeader("Set-Cookie", `hs_session=${makeSession(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);
  res.json({ user: sessionUser(user) });
}));

router.delete("/api/session", asyncRoute(async (req, res) => {
  requireUser(req);
  res.setHeader("Set-Cookie", "hs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.status(204).end();
}));

router.get("/api/me", asyncRoute(async (req, res) => {
  const user = requireUser(req);
  res.json({ user: sessionUser(user) });
}));

/* ----------------------------------- sites ----------------------------------- */

router.get("/api/sites", asyncRoute(async (req, res) => {
  const user = requireUser(req);
  const sites = await visibleSites(user);
  const out = [];
  for (const s of sites) {
    const stations = await q(`SELECT id, name, rate_cents FROM stations WHERE site_id = $1 ORDER BY ordinal`, [s.id]);
    out.push({
      id: s.id, name: s.name, time_zone: s.time_zone,
      deposit_cents: s.deposit_cents, cleaning_fee_cents: s.cleaning_fee_cents,
      stations: stations.rows,
    });
  }
  res.json({ sites: out });
}));

/* ----------------------------------- holds ----------------------------------- */

router.post("/api/holds", asyncRoute(async (req, res) => {
  const user = requireUser(req);
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};

  let renterId: string;
  if (user.role === "renter") {
    renterId = user.renter_id!;
  } else {
    if (typeof body.renter_id !== "string" || !body.renter_id) {
      throw validation({ renter_id: "Pick a renter first." });
    }
    const renter = await renterForStaff(user, body.renter_id);
    renterId = renter.id;
  }

  if (typeof body.station_id !== "string") throw notFound();
  const station = await stationInScope(user, body.station_id);
  const site = await getSite(station.site_id);
  const tz = site!.time_zone;

  const dateForm = typeof body.date === "string" && typeof body.start === "string" && typeof body.end === "string";
  const utcForm = typeof body.start_at === "string" && typeof body.end_at === "string";

  let occs: Occ[];
  if (dateForm) {
    const start = body.start as string;
    const end = body.end as string;
    const dateStr = body.date as string;
    if (!isDate(dateStr)) fields.date = "The date must be YYYY-MM-DD.";
    if (!isTime(start) || Number(start.slice(3)) % 15 !== 0) fields.start = "Start must be HH:MM on a quarter hour.";
    if (!isTime(end) || Number(end.slice(3)) % 15 !== 0) fields.end = "End must be HH:MM on a quarter hour.";
    const repeatWeeks = body.repeat_weeks === undefined ? 1 : Number(body.repeat_weeks);
    if (!Number.isInteger(repeatWeeks) || repeatWeeks < 1 || repeatWeeks > 12) fields.repeat_weeks = "Repeat weeks must be 1 to 12.";
    if (Object.keys(fields).length > 0) throw validation(fields);
    occs = buildOccurrences(tz, dateStr, start, end, repeatWeeks);
  } else if (utcForm) {
    const startAt = parseIso(body.start_at as string);
    const endAt = parseIso(body.end_at as string);
    if (isNaN(startAt) || isNaN(endAt) || startAt % 900000 !== 0 || endAt % 900000 !== 0) {
      throw validation({ start_at: "Times must be UTC on quarter hours." });
    }
    occs = [{
      date: localDate(tz, startAt),
      start: hhmmOf(tz, startAt),
      end: hhmmOf(tz, endAt),
      startAt, endAt, minutes: Math.round((endAt - startAt) / 60000),
    }];
  } else {
    throw validation({ date: "Give a date, start and end.", start: "Give a start.", end: "Give an end." });
  }

  for (const o of occs) {
    if (o.minutes < 15 || o.minutes > 720) {
      throw validation({ end: "Each time must last between 15 minutes and 12 hours." });
    }
  }
  const now = Date.now();
  if (occs.some(o => o.startAt <= now)) throw validation({ start: "Start must be in the future." });
  if (occs.some(o => o.startAt > now + 365 * 86400000)) throw validation({ start: "Start must be within the next 365 days." });

  const viewerRenter = user.role === "renter" ? user.renter_id : null;

  const result = await withStationLock(station.id, async (tx) => {
    for (const o of occs) {
      const conflict = await findConflict(tx, station.id, o.startAt, o.endAt, viewerRenter, tz);
      if (conflict) return { conflict, occDate: o.date };
    }
    const holdId = uid("hold");
    const expiresAt = new Date(now + HOLD_TTL_SECONDS * 1000);
    await tx.query(
      `INSERT INTO holds (id, station_id, site_id, renter_id, status, expires_at) VALUES ($1,$2,$3,$4,'held',$5)`,
      [holdId, station.id, station.site_id, renterId, expiresAt.toISOString()],
    );
    for (let i = 0; i < occs.length; i++) {
      const o = occs[i];
      await tx.query(
        `INSERT INTO hold_occurrences (hold_id, ordinal, date, start_time, end_time, start_at, end_at, minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [holdId, i, o.date, o.start, o.end, new Date(o.startAt).toISOString(), new Date(o.endAt).toISOString(), o.minutes],
      );
    }
    return { holdId };
  });

  if ("conflict" in result && result.conflict) {
    const c = result.conflict;
    const occDate = ("occDate" in result && result.occDate) || localDate(tz, Date.parse(c.start_at));
    res.status(409).json({
      error: "slot_taken",
      message: "Another renter just took this time.",
      blocker: { state: c.state, start_at: c.start_at, end_at: c.end_at, label: c.label, date: occDate },
    });
    return;
  }

  const hold = await loadHold(result.holdId);
  res.status(201).json({ hold });
}));

router.get("/api/holds/:id", asyncRoute(async (req, res) => {
  const user = requireUser(req);
  const hold = await loadHold(req.params.id);
  await assertHoldScope(user, hold);
  res.json({ hold });
}));

router.delete("/api/holds/:id", asyncRoute(async (req, res) => {
  const user = requireUser(req);
  const hold = await loadHold(req.params.id);
  await assertHoldScope(user, hold);
  if (hold.status !== "held") {
    throw new ApiError(409, "invalid_transition", `Cannot release a hold that is ${hold.status}.`, { from: hold.status, action: "release" });
  }
  await q(`UPDATE holds SET status = 'expired' WHERE id = $1 AND status = 'held'`, [hold.id]);
  res.status(204).end();
}));

/* ------------------------------- day endpoint -------------------------------- */

router.get("/api/sites/:siteId/day", asyncRoute(async (req, res) => {
  const user = requireUser(req);
  const site = await siteInScope(user, req.params.siteId);
  const date = String(req.query.date ?? "");
  if (!isDate(date)) throw validation({ date: "The date must be YYYY-MM-DD." });
  const tz = site.time_zone;
  const dayStart = resolveWallTime(tz, { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)), hh: 0, mm: 0 });
  const dMin = dayMinutes(tz, date);
  const dayEnd = dayStart + dMin * 60000;

  const stations = await q(`SELECT * FROM stations WHERE site_id = $1 ORDER BY ordinal`, [site.id]);

  const bookings = await q(
    `SELECT b.id, b.station_id, b.renter_id, b.start_at, b.end_at FROM bookings b
     WHERE b.site_id = $1 AND b.status = ANY($2::text[]) AND b.start_at < $4 AND b.end_at > $3`,
    [site.id, ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled"], new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()],
  );
  const holds = await q(
    `SELECT h.id, h.station_id, h.renter_id, ho.start_at, ho.end_at FROM hold_occurrences ho
     JOIN holds h ON h.id = ho.hold_id
     WHERE h.site_id = $1 AND h.status = 'held' AND h.expires_at > now()
       AND ho.start_at < $3 AND ho.end_at > $2`,
    [site.id, new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()],
  );

  const viewerRenter = user.role === "renter" ? user.renter_id : null;
  const businesses = new Map<string, string>();
  const renterIds = new Set<string>();
  for (const b of bookings.rows as { renter_id: string }[]) renterIds.add(b.renter_id);
  for (const h of holds.rows as { renter_id: string }[]) renterIds.add(h.renter_id);
  for (const rid of renterIds) {
    const r = await getRenter(rid);
    businesses.set(rid, r?.business ?? "");
  }

  const segFor = (startMs: number, endMs: number, isBooking: boolean, renterId: string, bookingId: string | null, holdId: string | null): Segment | null => {
    if (endMs <= dayStart || startMs >= dayEnd) return null;
    const own = viewerRenter !== null && renterId === viewerRenter;
    let state: SegmentState;
    if (isBooking) state = own ? "yours_booked" : "booked";
    else state = own ? "yours_held" : "held";
    if (user.role !== "renter") state = isBooking ? "booked" : "held";
    const words = isBooking ? "Booked" : "Held";
    const ownWords = isBooking ? "Your booking" : "Your hold";
    const label = `${own ? ownWords : words} ${hhmmOf(tz, startMs)}–${hhmmOf(tz, endMs)}`;
    const showIds = user.role !== "renter" || own;
    return {
      start_at: iso(startMs),
      end_at: iso(endMs),
      state,
      label,
      booking_id: showIds ? bookingId : null,
      hold_id: showIds ? holdId : null,
      renter_business: user.role === "renter" ? (own ? businesses.get(renterId) ?? null : null) : businesses.get(renterId) ?? null,
    };
  };

  const stationOut: { id: string; name: string; rate_cents: number; segments: Segment[] }[] = [];
  for (const st of stations.rows as { id: string; name: string; rate_cents: number }[]) {
    const segments: Segment[] = [];
    for (const b of bookings.rows as { id: string; station_id: string; renter_id: string; start_at: Date; end_at: Date }[]) {
      if (b.station_id !== st.id) continue;
      const seg = segFor(b.start_at.getTime(), b.end_at.getTime(), true, b.renter_id, b.id, null);
      if (seg) segments.push(seg);
    }
    for (const h of holds.rows as { id: string; station_id: string; renter_id: string; start_at: Date; end_at: Date }[]) {
      if (h.station_id !== st.id) continue;
      const seg = segFor(h.start_at.getTime(), h.end_at.getTime(), false, h.renter_id, null, h.id);
      if (seg) segments.push(seg);
    }
    stationOut.push({ id: st.id, name: st.name, rate_cents: st.rate_cents, segments });
  }

  const packMinutes = user.role === "renter" ? (await packBalance(user.renter_id!)).available : null;
  res.json({
    site_id: site.id,
    date,
    time_zone: tz,
    hours: Math.round(dMin / 60),
    ticks: dayTicks(tz, date),
    pack_minutes_available: packMinutes,
    stations: stationOut,
  });
}));
