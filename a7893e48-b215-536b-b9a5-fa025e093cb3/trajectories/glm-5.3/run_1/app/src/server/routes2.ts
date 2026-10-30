import type { Router } from "express";
import { asyncRoute, requireUser } from "./auth.js";
import { ApiError, notFound, validation, transition } from "./errors.js";
import { q, withTx, Tx } from "./db.js";
import { loadHold, assertHoldScope, iso, getSite } from "./api-core.js";
import { audit, BookingRow } from "./domain.js";
import { writeMovement, findPackForBooking } from "./pack.js";
import { policiesForSite, versionInForce, cutoffFor, refundTier } from "./policy.js";
import * as kb from "./killbill.js";
import { requireRole, getRenter, visibleSites } from "./scope.js";
import type { Booking, BookingStatus, SessionUser } from "../shared/types.js";
import { hours, termsLine } from "../shared/types.js";
import { localStamp, rangeDates } from "../shared/time.js";

import { reserveKey, finishKey } from "./idempotency.js";

/* ------------------------------ booking helpers ------------------------------- */

const paidCache = new Map<string, { paid: boolean; at: number }>();

export async function bookingPaid(b: BookingRow): Promise<boolean> {
  if (b.card_minutes === 0) return true;
  const cancelled = ["cancelled_refunded", "cancelled_forfeit", "unpaid_cancelled"].includes(b.status);
  if (cancelled && b.time_refunded) return false;
  const cached = paidCache.get(b.id);
  const now = Date.now();
  if (cached && now - cached.at < 10000) return cached.paid;
  let paid: boolean;
  try {
    paid = await kb.paymentHeld(`hs-booking-${b.id}`);
  } catch {
    paid = cached?.paid ?? false;
  }
  paidCache.set(b.id, { paid, at: now });
  return paid;
}

function invalidatePaid(bookingId: string): void {
  paidCache.delete(bookingId);
}

export async function loadBookingRow(id: string): Promise<BookingRow> {
  const r = await q(`SELECT * FROM bookings WHERE id = $1`, [id]);
  const row = r.rows[0] as BookingRow | undefined;
  if (!row) throw notFound();
  return row;
}

export async function assertBookingScope(user: SessionUser, b: BookingRow): Promise<void> {
  if (user.role === "renter") {
    if (user.renter_id !== b.renter_id) throw notFound();
    return;
  }
  const site = await getSite(b.site_id);
  if (!site) throw notFound();
  if (site.operator_id !== user.operator_id) throw notFound();
  if (user.role === "front_desk" && !user.site_ids.includes(b.site_id)) throw notFound();
}

export async function bookingView(b: BookingRow): Promise<Booking> {
  const site = await getSite(b.site_id)!;
  const station = await q(`SELECT name FROM stations WHERE id = $1`, [b.station_id]);
  const renter = await getRenter(b.renter_id);
  const versions = await policiesForSite(b.site_id);
  const policy = versionInForce(versions, b.confirmed_at);
  const paid = await bookingPaid(b);
  const cutoff = cutoffFor(site!.time_zone, b.start_at);
  const balanceDue = b.status === "confirmed" && !paid ? b.card_cents : 0;
  return {
    id: b.id,
    hold_id: b.hold_id,
    site_id: b.site_id,
    station_id: b.station_id,
    station_name: (station.rows[0] as { name: string }).name,
    renter_id: b.renter_id,
    renter_business: renter!.business,
    status: b.status as BookingStatus,
    start_at: iso(b.start_at.getTime()),
    end_at: iso(b.end_at.getTime()),
    local_start: localStamp(site!.time_zone, b.start_at.getTime()),
    local_end: localStamp(site!.time_zone, b.end_at.getTime()),
    minutes: b.minutes,
    pack_minutes: b.pack_minutes,
    card_minutes: b.card_minutes,
    card_cents: b.card_cents,
    deposit_cents: b.deposit_cents,
    paid,
    balance_due_cents: balanceDue,
    balance_due_by: balanceDue > 0 ? iso(cutoff.getTime()) : null,
    policy: {
      version_id: b.policy_version_id,
      notice_hours: policy?.notice_hours ?? 24,
      effective_from: policy?.effective_from ?? "",
    },
    confirmed_at: iso(b.confirmed_at.getTime()),
    checked_in_at: b.checked_in_at ? iso(b.checked_in_at.getTime()) : null,
    checked_out_at: b.checked_out_at ? iso(b.checked_out_at.getTime()) : null,
    overrun_minutes: b.overrun_minutes,
    overrun_cents: b.overrun_cents,
    cleaning_fee_cents: b.cleaning_fee_charged ? site!.cleaning_fee_cents : 0,
    terms: termsLine(policy?.notice_hours ?? 24),
  };
}

async function lockBooking(tx: Tx, bookingId: string): Promise<BookingRow> {
  const r = await tx.query(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
  const row = r.rows[0] as BookingRow | undefined;
  if (!row) throw notFound();
  return row;
}

/* ---------------------------------- routes ----------------------------------- */

export function registerBookingRoutes(router: Router): void {

  router.get("/api/bookings", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const siteId = req.query.site_id;
    const date = req.query.date;
    const status = req.query.status;
    let rows: BookingRow[];
    if (user.role === "renter") {
      rows = (await q(`SELECT * FROM bookings WHERE renter_id = $1 ORDER BY start_at ASC`, [user.renter_id!])).rows as unknown as BookingRow[];
    } else {
      const sites = await visibleSites(user);
      const ids = sites.map(s => s.id);
      rows = (await q(
        `SELECT * FROM bookings WHERE site_id = ANY($1::text[]) ORDER BY start_at ASC`, [ids],
      )).rows as unknown as BookingRow[];
    }
    const out = [];
    for (const b of rows) {
      if (typeof siteId === "string" && siteId && b.site_id !== siteId) continue;
      if (typeof date === "string" && date) {
        const site = await getSite(b.site_id);
        if (site && !rangeDates(site.time_zone, b.start_at.getTime(), b.end_at.getTime()).includes(date)) continue;
      }
      if (typeof status === "string" && status && b.status !== status) continue;
      out.push(await bookingView(b));
    }
    res.json({ bookings: out });
  }));

  router.get("/api/bookings/:id", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    res.json({ booking: await bookingView(b) });
  }));

  router.get("/api/bookings/:id/invoice", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    const site = (await getSite(b.site_id))!;
    const station = await q(`SELECT name FROM stations WHERE id = $1`, [b.station_id]);
    const renter = await getRenter(b.renter_id);
    const versions = await policiesForSite(b.site_id);
    const policy = versionInForce(versions, b.confirmed_at);
    const lines: { description: string; minutes: number | null; amount_cents: number }[] = [
      {
        description: `${(station.rows[0] as { name: string }).name} ${hours(b.minutes - b.card_minutes)} h pack time`,
        minutes: b.minutes - b.card_minutes,
        amount_cents: 0,
      },
      {
        description: `${(station.rows[0] as { name: string }).name} ${hours(b.card_minutes)} h card time`,
        minutes: b.card_minutes,
        amount_cents: b.card_cents,
      },
    ];
    if (b.deposit_cents > 0) lines.push({ description: "Damage deposit", minutes: null, amount_cents: b.deposit_cents });
    if (b.overrun_minutes > 0) lines.push({ description: `Overrun ${b.overrun_minutes} min`, minutes: b.overrun_minutes, amount_cents: b.overrun_cents });
    if (b.cleaning_fee_charged) lines.push({ description: "Cleaning fee", minutes: null, amount_cents: site.cleaning_fee_cents });
    const paid = await bookingPaid(b);
    const total = b.card_cents + b.deposit_cents + b.overrun_cents + (b.cleaning_fee_charged ? site.cleaning_fee_cents : 0);
    const paidNow = b.card_cents + b.deposit_cents + b.overrun_cents + (b.cleaning_fee_charged ? site.cleaning_fee_cents : 0) - (b.status === "confirmed" && !paid ? b.card_cents : 0);
    const refunded = (b.time_refunded ? b.card_cents : 0) + (b.deposit_refunded ? b.deposit_cents : 0);
    res.json({
      booking_id: b.id,
      renter_business: renter!.business,
      site_name: site.name,
      lines,
      total_cents: total,
      paid_cents: b.status === "confirmed" && !paid ? paidNow - b.card_cents : paidNow,
      refunded_cents: refunded,
      balance_due_cents: b.status === "confirmed" && !paid ? b.card_cents : 0,
      terms: termsLine(policy?.notice_hours ?? 24),
    });
  }));

  router.get("/api/bookings/:id/audit", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    const r = await q(`SELECT * FROM audit_events WHERE booking_id = $1 ORDER BY at ASC, id ASC`, [b.id]);
    res.json({
      events: r.rows.map((e: { at: Date; actor_name: string; actor_role: string; action: string; from_status: string; to_status: string; reason: string | null }) => ({
        at: iso(e.at.getTime()),
        actor_name: e.actor_name,
        actor_role: e.actor_role,
        action: e.action,
        from: e.from_status,
        to: e.to_status,
        reason: e.reason,
      })),
    });
  }));

  /* --------------------------- pay, cancel, override -------------------------- */

  router.post("/api/bookings/:id/pay", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const key = String(req.headers["idempotency-key"] ?? "");
    const body = JSON.stringify(req.body ?? {});
    const endpoint = `POST /api/bookings/:id/pay:${req.params.id}`;
    const attempt = await reserveKey(user, endpoint, key, body);
    if (attempt.kind === "replay") { res.status(attempt.stored.status).json(JSON.parse(attempt.stored.body)); return; }
    if (attempt.kind === "reused") throw new ApiError(409, "idempotency_key_reused", "This key was used with a different body.");
    if (attempt.kind === "in_progress") throw new ApiError(409, "request_in_progress", "A request with this key is running.");
    try {
      const b = await loadBookingRow(req.params.id);
      if (user.role !== "renter" || user.renter_id !== b.renter_id) throw notFound();
      if (b.status !== "confirmed") throw transition(b.status, "pay");
      const paid = await bookingPaid(b);
      if (paid) throw transition(b.status, "pay");
      const renter = (await getRenter(b.renter_id))!;
      await kb.purchase(renter, `hs-booking-${b.id}`, b.card_cents);
      invalidatePaid(b.id);
      const out = await bookingView(await loadBookingRow(b.id));
      const responseBody = JSON.stringify({ booking: out });
      await finishKey(user, endpoint, key, 200, responseBody, true);
      res.status(200).json({ booking: out });
    } catch (e) {
      await finishKey(user, endpoint, key, 0, "", false).catch(() => {});
      throw e;
    }
  }));

  async function doCancel(b: BookingRow, actor: { name: string; role: "renter" | "manager" }, reason: string | null, forceFull: boolean): Promise<{ booking: BookingRow; refund: { tier: "full" | "none"; pack_minutes_returned: number; card_refund_cents: number; deposit_refund_cents: number } }> {
    const versions = await policiesForSite(b.site_id);
    const policy = versionInForce(versions, b.confirmed_at);
    const tier = forceFull ? "full" : refundTier(new Date(), b.start_at, policy?.notice_hours ?? 24);
    let packReturned = 0;
    let cardRefund = 0;
    let depositRefund = 0;

    if (tier === "full") {
      // refund pack, card payment and deposit
      const pm = await findPackForBooking(b.renter_id, b.id);
      if (pm) {
        await withTx(async (tx) => {
          await writeMovement(tx, b.renter_id, "release", pm.minutes, b.id, pm.packId);
        });
        packReturned = pm.minutes;
      }
      if (b.card_minutes > 0) {
        await kb.refund(`hs-booking-${b.id}`, b.card_cents);
        cardRefund = b.card_cents;
      }
      if (b.deposit_cents > 0) {
        await kb.refund(`hs-deposit-${b.id}`, b.deposit_cents);
        depositRefund = b.deposit_cents;
      }
    } else {
      const pm = await findPackForBooking(b.renter_id, b.id);
      if (pm) {
        await withTx(async (tx) => {
          await writeMovement(tx, b.renter_id, "forfeit", pm.minutes, b.id, pm.packId);
        });
      }
    }

    await withTx(async (tx) => {
      const cur = await lockBooking(tx, b.id);
      const to = tier === "full" ? "cancelled_refunded" : "cancelled_forfeit";
      await tx.query(
        `UPDATE bookings SET status=$2, time_refunded=$3, deposit_refunded=$4 WHERE id=$1`,
        [b.id, to, tier === "full" && b.card_minutes > 0, tier === "full" && b.deposit_cents > 0],
      );
      await audit(tx, b.id, { name: actor.name, role: actor.role }, "cancel", cur.status, to, reason);
    });
    invalidatePaid(b.id);
    return {
      booking: await loadBookingRow(b.id),
      refund: { tier, pack_minutes_returned: packReturned, card_refund_cents: cardRefund, deposit_refund_cents: depositRefund },
    };
  }

  router.post("/api/bookings/:id/cancel", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const key = String(req.headers["idempotency-key"] ?? "");
    const body = JSON.stringify(req.body ?? {});
    const endpoint = `POST /api/bookings/:id/cancel:${req.params.id}`;
    const attempt = await reserveKey(user, endpoint, key, body);
    if (attempt.kind === "replay") { res.status(attempt.stored.status).json(JSON.parse(attempt.stored.body)); return; }
    if (attempt.kind === "reused") throw new ApiError(409, "idempotency_key_reused", "This key was used with a different body.");
    if (attempt.kind === "in_progress") throw new ApiError(409, "request_in_progress", "A request with this key is running.");
    try {
      const b = await loadBookingRow(req.params.id);
      if (user.role !== "renter" || user.renter_id !== b.renter_id) throw notFound();
      if (b.status !== "confirmed") throw transition(b.status, "cancel");
      const out = await doCancel(b, { name: user.name, role: "renter" }, null, false);
      const view = await bookingView(out.booking);
      const responseBody = JSON.stringify({ booking: view, refund: out.refund });
      await finishKey(user, endpoint, key, 200, responseBody, true);
      res.status(200).json(JSON.parse(responseBody));
    } catch (e) {
      await finishKey(user, endpoint, key, 0, "", false).catch(() => {});
      throw e;
    }
  }));

  router.post("/api/bookings/:id/override", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    const body = req.body as { action?: unknown; reason?: unknown };
    if (body.action !== "cancel_refunded") throw validation({ action: "Only cancel_refunded is supported." });
    if (typeof body.reason !== "string" || body.reason.length < 5 || body.reason.length > 500) {
      throw validation({ reason: "Give a reason of at least 5 characters." });
    }
    if (b.status !== "confirmed") throw transition(b.status, "override cancel");
    const out = await doCancel(b, { name: user.name, role: "manager" }, body.reason, true);
    res.json({ booking: await bookingView(out.booking), refund: out.refund });
  }));

  router.post("/api/holds/:id/override", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const hold = await loadHold(req.params.id);
    await assertHoldScope(user, hold);
    const body = req.body as { action?: unknown; reason?: unknown };
    if (body.action !== "release") throw validation({ action: "Only release is supported." });
    if (typeof body.reason !== "string" || body.reason.length < 5 || body.reason.length > 500) {
      throw validation({ reason: "Give a reason of at least 5 characters." });
    }
    if (hold.status !== "held") {
      throw new ApiError(409, "invalid_transition", `Cannot release a hold that is ${hold.status}.`, { from: hold.status, action: "release" });
    }
    await q(`UPDATE holds SET status='expired' WHERE id=$1 AND status='held'`, [hold.id]);
    res.json({ hold: await loadHold(hold.id) });
  }));

  /* ------------------------- counter: check-in and out ----------------------- */

  router.post("/api/bookings/:id/check-in", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["front_desk", "manager"]);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    if (b.status !== "confirmed") throw transition(b.status, "check in");
    const now = Date.now();
    if (now < b.start_at.getTime() - 30 * 60000 || now >= b.end_at.getTime()) {
      throw new ApiError(409, "outside_check_in_window", "Check-in opens 30 minutes before start.");
    }
    await withTx(async (tx) => {
      const cur = await lockBooking(tx, b.id);
      await tx.query(`UPDATE bookings SET status='checked_in', checked_in_at=now() WHERE id=$1`, [b.id]);
      await audit(tx, b.id, { name: user.name, role: user.role }, "check_in", cur.status, "checked_in");
    });
    res.json({ booking: await bookingView(await loadBookingRow(b.id)) });
  }));

  router.post("/api/bookings/:id/overrun", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["front_desk", "manager"]);
    const key = String(req.headers["idempotency-key"] ?? "");
    const rawBody = JSON.stringify(req.body ?? {});
    const endpoint = `POST /api/bookings/:id/overrun:${req.params.id}`;
    const attempt = await reserveKey(user, endpoint, key, rawBody);
    if (attempt.kind === "replay") { res.status(attempt.stored.status).json(JSON.parse(attempt.stored.body)); return; }
    if (attempt.kind === "reused") throw new ApiError(409, "idempotency_key_reused", "This key was used with a different body.");
    if (attempt.kind === "in_progress") throw new ApiError(409, "request_in_progress", "A request with this key is running.");
    try {
      const b = await loadBookingRow(req.params.id);
      await assertBookingScope(user, b);
      const body = req.body as { minutes?: unknown };
      const minutes = Number(body.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
        throw validation({ minutes: "Overrun minutes must be between 1 and 240." });
      }
      if (b.status !== "checked_in") throw transition(b.status, "charge overrun");
      const station = await q(`SELECT rate_cents FROM stations WHERE id = $1`, [b.station_id]);
      const rate = (station.rows[0] as { rate_cents: number }).rate_cents;
      const cents = Math.round(minutes * rate / 60);
      const renter = (await getRenter(b.renter_id))!;
      await kb.purchase(renter, `hs-overrun-${b.id}`, cents);
      await withTx(async (tx) => {
        const cur = await lockBooking(tx, b.id);
        await tx.query(`UPDATE bookings SET status='overrun_billed', overrun_minutes=$2, overrun_cents=$3 WHERE id=$1`, [b.id, minutes, cents]);
        await audit(tx, b.id, { name: user.name, role: user.role }, "overrun", cur.status, "overrun_billed");
      });
      const out = await bookingView(await loadBookingRow(b.id));
      const responseBody = JSON.stringify({ booking: out });
      await finishKey(user, endpoint, key, 201, responseBody, true);
      res.status(201).json(JSON.parse(responseBody));
    } catch (e) {
      await finishKey(user, endpoint, key, 0, "", false).catch(() => {});
      throw e;
    }
  }));

  router.post("/api/bookings/:id/check-out", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["front_desk", "manager"]);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    if (b.status !== "checked_in" && b.status !== "overrun_billed") throw transition(b.status, "check out");
    await withTx(async (tx) => {
      const cur = await lockBooking(tx, b.id);
      await tx.query(`UPDATE bookings SET status='checked_out', checked_out_at=now() WHERE id=$1`, [b.id]);
      await audit(tx, b.id, { name: user.name, role: user.role }, "check_out", cur.status, "checked_out");
      if (b.pack_minutes > 0) {
        const pm = await findPackForBooking(b.renter_id, b.id);
        if (pm) await writeMovement(tx, b.renter_id, "use", pm.minutes, b.id, pm.packId);
      }
    });
    res.json({ booking: await bookingView(await loadBookingRow(b.id)) });
  }));

  router.post("/api/bookings/:id/cleaning-fee", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["front_desk", "manager"]);
    const key = String(req.headers["idempotency-key"] ?? "");
    const rawBody = JSON.stringify(req.body ?? {});
    const endpoint = `POST /api/bookings/:id/cleaning-fee:${req.params.id}`;
    const attempt = await reserveKey(user, endpoint, key, rawBody);
    if (attempt.kind === "replay") { res.status(attempt.stored.status).json(JSON.parse(attempt.stored.body)); return; }
    if (attempt.kind === "reused") throw new ApiError(409, "idempotency_key_reused", "This key was used with a different body.");
    if (attempt.kind === "in_progress") throw new ApiError(409, "request_in_progress", "A request with this key is running.");
    try {
      const b = await loadBookingRow(req.params.id);
      await assertBookingScope(user, b);
      if (b.status !== "checked_out") throw transition(b.status, "add cleaning fee");
      if (b.cleaning_fee_charged) throw new ApiError(409, "cleaning_fee_already_charged", "A cleaning fee was already charged.");
      const site = (await getSite(b.site_id))!;
      const renter = (await getRenter(b.renter_id))!;
      await kb.purchase(renter, `hs-cleaning-${b.id}`, site.cleaning_fee_cents);
      await withTx(async (tx) => {
        const cur = await lockBooking(tx, b.id);
        await tx.query(`UPDATE bookings SET cleaning_fee_charged=true WHERE id=$1`, [b.id]);
        await audit(tx, b.id, { name: user.name, role: user.role }, "cleaning_fee", cur.status, "checked_out");
      });
      const out = await bookingView(await loadBookingRow(b.id));
      const responseBody = JSON.stringify({ booking: out });
      await finishKey(user, endpoint, key, 201, responseBody, true);
      res.status(201).json(JSON.parse(responseBody));
    } catch (e) {
      await finishKey(user, endpoint, key, 0, "", false).catch(() => {});
      throw e;
    }
  }));

  router.post("/api/bookings/:id/settle", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["front_desk", "manager"]);
    const b = await loadBookingRow(req.params.id);
    await assertBookingScope(user, b);
    if (b.status !== "checked_out") throw transition(b.status, "settle");
    if (b.deposit_cents > 0 && !b.deposit_refunded) {
      await kb.refund(`hs-deposit-${b.id}`, b.deposit_cents);
    }
    await withTx(async (tx) => {
      const cur = await lockBooking(tx, b.id);
      await tx.query(`UPDATE bookings SET status='settled', deposit_refunded=$2 WHERE id=$1`, [b.id, b.deposit_cents > 0]);
      await audit(tx, b.id, { name: user.name, role: user.role }, "settle", cur.status, "settled");
    });
    invalidatePaid(b.id);
    res.json({ booking: await bookingView(await loadBookingRow(b.id)) });
  }));
}
