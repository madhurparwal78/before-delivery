import type { Router } from "express";
import { asyncRoute, requireUser } from "./auth.js";
import { ApiError, notFound, validation, forbidden } from "./errors.js";
import { q, withTx } from "./db.js";
import {
  loadHold, assertHoldScope, coverOccurrences, isDate, iso,
  dayMinutes, uid, token, getSite,
} from "./api-core.js";
import { audit, BookingRow } from "./domain.js";
import { packBalance, writeMovement, ledgerEntries } from "./pack.js";
import { policiesForSite, versionInForce, cutoffFor } from "./policy.js";
import * as kb from "./killbill.js";
import { confirmationEmail } from "./emails.js";
import { siteInScope, requireRole, getRenter, visibleSites } from "./scope.js";
import type { Booking, SessionUser } from "../shared/types.js";
import { localStamp, localDate as ld, rangeDates, resolveWallTime } from "../shared/time.js";
import { FILE_LIMIT, BINDER_LINK_TTL_SECONDS } from "./config.js";
import { putObject, getObject } from "./s3.js";
import { reserveKey, finishKey } from "./idempotency.js";
import type { Request, Response } from "express";
import { bookingView, bookingPaid } from "./routes2.js";

/* ------------------------------- confirm holds ------------------------------- */

async function confirmHold(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const key = String(req.headers["idempotency-key"] ?? "");
  const rawBody = JSON.stringify(req.body ?? {});
  const endpoint = `POST /api/holds/:id/confirm:${req.params.id}`;
  const attempt = await reserveKey(user, endpoint, key, rawBody);
  if (attempt.kind === "replay") { res.status(attempt.stored.status).json(JSON.parse(attempt.stored.body)); return; }
  if (attempt.kind === "reused") throw new ApiError(409, "idempotency_key_reused", "This key was used with a different body.");
  if (attempt.kind === "in_progress") throw new ApiError(409, "request_in_progress", "A request with this key is running.");
  try {
    const hold = await loadHold(req.params.id);
    await assertHoldScope(user, hold);
    const body = req.body as { use_pack?: unknown; pay_now?: unknown };
    const usePack = body.use_pack === undefined ? true : Boolean(body.use_pack);
    const payNow = Boolean(body.pay_now);

    // 1. live?
    const holdRow = (await q(`SELECT * FROM holds WHERE id = $1`, [hold.id])).rows[0] as { status: string; expires_at: Date; renter_id: string; station_id: string; site_id: string };
    if (holdRow.status === "confirmed") throw new ApiError(409, "invalid_transition", "Cannot confirm a hold that is confirmed.", { from: "confirmed", action: "confirm" });
    if (holdRow.status !== "held" || Date.now() >= holdRow.expires_at.getTime()) {
      throw new ApiError(410, "hold_expired", "Your hold ran out before payment. Nothing was charged.");
    }

    const station = await q(`SELECT * FROM stations WHERE id = $1`, [hold.station_id]);
    const site = (await getSite(hold.site_id))!;
    const renter = (await getRenter(hold.renter_id))!;
    const rate = (station.rows[0] as { rate_cents: number }).rate_cents;
    const stationName = (station.rows[0] as { name: string }).name;

    // 2. certificate gate
    const occs = hold.occurrences;
    const dates: string[] = [];
    for (const o of occs) {
      for (const d of rangeDates(site.time_zone, Date.parse(o.start_at), Date.parse(o.end_at))) {
        if (!dates.includes(d)) dates.push(d);
      }
    }
    const covered = new Set<string>();
    for (const d of dates) {
      const r = await q(
        `SELECT d.id, d.expires_on FROM documents d WHERE d.renter_id = $1 AND d.kind = 'liability'
         AND d.valid_from <= $2 AND d.expires_on >= $2`,
        [renter.id, d],
      );
      for (const row of r.rows as { id: string }[]) {
        const doc = (await q(`SELECT storage_key FROM documents WHERE id = $1`, [row.id])).rows[0] as { storage_key: string };
        const obj = await getObject(doc.storage_key);
        if (obj !== null) covered.add(d);
      }
    }
    const missing = dates.filter(d => !covered.has(d));
    if (missing.length > 0) {
      throw new ApiError(422, "certificate_required", "Upload a liability certificate that covers the booking dates before confirming.", { dates: missing });
    }

    // 3. pack share
    const ordered = [...occs].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const balance = await packBalance(renter.id);
    const quote = coverOccurrences(
      occs.map(o => ({ startAt: Date.parse(o.start_at), minutes: o.minutes })),
      usePack ? balance.available : 0,
      rate,
      site.deposit_cents,
    );
    if (usePack && balance.available === 0 && hold.quote.pack_minutes > 0) {
      throw new ApiError(422, "pack_insufficient", "Your pack no longer covers these hours. Untick Use pack hours or buy a pack.");
    }

    // 4. cutoff check for pay later
    if (!payNow) {
      for (let i = 0; i < ordered.length; i++) {
        const occCard = quote.perOcc[i]?.card ?? 0;
        if (occCard > 0) {
          const cutoff = cutoffFor(site.time_zone, new Date(Date.parse(ordered[i].start_at)));
          if (cutoff.getTime() <= Date.now()) {
            throw new ApiError(422, "pay_now_required", "This booking starts too soon to pay later. Choose Pay now.");
          }
        }
      }
    }

    // 5-6. Kill Bill charges with undo, then one commit
    const bookingIds = ordered.map(() => uid("bk"));
    const charged: { key: string; cents: number }[] = [];
    const renterBilling = { id: renter.id, name: renter.name, email: renter.email };
    try {
      for (let i = 0; i < ordered.length; i++) {
        const occCard = quote.perOcc[i]?.card ?? 0;
        const bookingId = bookingIds[i];
        if (occCard > 0) {
          await kb.purchase(renterBilling, `hs-deposit-${bookingId}`, site.deposit_cents);
          charged.push({ key: `hs-deposit-${bookingId}`, cents: site.deposit_cents });
          if (payNow) {
            const occCents = Math.round(occCard * rate / 60);
            await kb.purchase(renterBilling, `hs-booking-${bookingId}`, occCents);
            charged.push({ key: `hs-booking-${bookingId}`, cents: occCents });
          }
        }
      }
    } catch (e) {
      // undo partial charges
      console.error("confirm KB failure:", e);
      for (const c of charged) {
        try { await kb.refund(c.key, c.cents); } catch { /* best effort */ }
      }
      throw e;
    }

    const versions = await policiesForSite(site.id);
    const now = new Date();
    const policy = versionInForce(versions, now);
    let firstError: unknown = null;
    try {
      await withTx(async (tx) => {
        const holdLock = (await tx.query(`SELECT status FROM holds WHERE id = $1 FOR UPDATE`, [hold.id])).rows[0] as { status: string };
        if (holdLock.status !== "held") {
          throw new ApiError(410, "hold_expired", "Your hold ran out before payment. Nothing was charged.");
        }
        await tx.query(`UPDATE holds SET status='confirmed', confirmed_at=now() WHERE id=$1`, [hold.id]);
        for (let i = 0; i < ordered.length; i++) {
          const o = ordered[i];
          const occPack = quote.perOcc[i]?.pack ?? 0;
          const occCard = quote.perOcc[i]?.card ?? 0;
          const occCents = Math.round(occCard * rate / 60);
          const bookingId = bookingIds[i];
          await tx.query(
            `INSERT INTO bookings (id, hold_id, site_id, station_id, renter_id, status, start_at, end_at, minutes,
               pack_minutes, card_minutes, card_cents, deposit_cents, policy_version_id, confirmed_at)
             VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              bookingId, hold.id, site.id, hold.station_id, renter.id,
              new Date(Date.parse(o.start_at)).toISOString(), new Date(Date.parse(o.end_at)).toISOString(),
              o.minutes, occPack, occCard, occCents, occCard > 0 ? site.deposit_cents : 0,
              policy!.id, now.toISOString(),
            ],
          );
          await audit(tx, bookingId, { name: user.name, role: user.role }, "confirm", "held", "confirmed");
          if (occPack > 0) {
            await writeMovement(tx, renter.id, "reserve", occPack, bookingId, null);
          }
        }
        // One confirmation email, queued in the same commit. Composed from the
        // confirmed occurrences so the transaction needs no external reads.
        const emailLines = ordered.map((o, i) => {
          const occCard = quote.perOcc[i]?.card ?? 0;
          const occPack = quote.perOcc[i]?.pack ?? 0;
          const occCents = Math.round(occCard * rate / 60);
          const occStart = Date.parse(o.start_at);
          const occEnd = Date.parse(o.end_at);
          const cutoff = cutoffFor(site.time_zone, new Date(occStart));
          return {
            station_name: stationName,
            site_name: site.name,
            start_at: occStart,
            end_at: occEnd,
            minutes: o.minutes,
            tz: site.time_zone,
            pack_minutes: occPack,
            deposit_cents: occCard > 0 ? site.deposit_cents : 0,
            paid_now_cents: payNow && occCard > 0 ? occCents : 0,
            balance_cents: !payNow && occCard > 0 ? occCents : 0,
            balance_due_by: !payNow && occCard > 0 ? cutoff.getTime() : null,
            notice_hours: policy!.notice_hours,
          };
        });
        const email = confirmationEmail(emailLines);
        await tx.query(
          `INSERT INTO email_queue (id, to_email, subject, body) VALUES ($1,$2,$3,$4)`,
          [uid("em"), renter.email, email.subject, email.body],
        );
      });
    } catch (e) {
      firstError = e;
    }
    if (firstError) {
      for (const c of charged) {
        try { await kb.refund(c.key, c.cents); } catch { /* best effort */ }
      }
      throw firstError;
    }

    const rows = (await q(`SELECT * FROM bookings WHERE hold_id = $1 ORDER BY start_at ASC`, [hold.id])).rows as unknown as BookingRow[];
    const views: Booking[] = [];
    for (const row of rows) {
      views.push(await bookingView(row));
    }

    const responseBody = JSON.stringify({ bookings: views, email: "queued" });
    await finishKey(user, endpoint, key, 201, responseBody, true);
    res.status(201).json(JSON.parse(responseBody));
  } catch (e) {
    await finishKey(user, endpoint, key, 0, "", false).catch(() => {});
    throw e;
  }
}

/* ------------------------------ packs & ledger ------------------------------- */

async function mePackView(renterId: string): Promise<Record<string, unknown>> {
  const bal = await packBalance(renterId);
  const entries = await ledgerEntries(renterId);
  return {
    available_minutes: bal.available,
    reserved_minutes: bal.reserved,
    used_minutes: bal.used,
    entries: entries.map(e => ({
      id: e.id,
      movement_id: e.movement_id,
      account: e.account,
      minutes: e.minutes,
      reason: e.reason,
      booking_id: e.booking_id,
      pack_id: e.pack_id,
      created_at: e.created_at,
    })),
  };
}

export function registerOtherRoutes(router: Router): void {
  router.post("/api/holds/:id/confirm", asyncRoute(confirmHold));

  router.get("/api/me/pack", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role !== "renter") throw forbidden();
    res.json(await mePackView(user.renter_id!));
  }));

  router.get("/api/renters/:id/pack", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role === "renter") throw forbidden();
    const renter = await renterInScopeOrSelf(user, req.params.id);
    res.json(await mePackView(renter.id));
  }));

  router.post("/api/packs", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role !== "renter") throw forbidden();
    const key = String(req.headers["idempotency-key"] ?? "");
    const rawBody = JSON.stringify(req.body ?? {});
    const endpoint = "POST /api/packs";
    const attempt = await reserveKey(user, endpoint, key, rawBody);
    if (attempt.kind === "replay") { res.status(attempt.stored.status).json(JSON.parse(attempt.stored.body)); return; }
    if (attempt.kind === "reused") throw new ApiError(409, "idempotency_key_reused", "This key was used with a different body.");
    if (attempt.kind === "in_progress") throw new ApiError(409, "request_in_progress", "A request with this key is running.");
    try {
      const body = req.body as { product?: unknown };
      if (body.product !== "20h") throw validation({ product: "Only the 20-hour pack is available." });
      const renter = (await getRenter(user.renter_id!))!;
      const billing = { id: renter.id, name: renter.name, email: renter.email };
      const packId = uid("pk");
      await kb.purchase(billing, `hs-pack-${packId}`, 56000);
      await withTx(async (tx) => {
        await tx.query(`INSERT INTO packs (id, renter_id, minutes, price_cents) VALUES ($1,$2,$3,$4)`, [packId, renter.id, 1200, 56000]);
        await writeMovement(tx, renter.id, "purchase", 1200, null, packId);
      });
      const bal = await packBalance(renter.id);
      const responseBody = JSON.stringify({ pack: { id: packId, minutes: 1200, price_cents: 56000 }, available_minutes: bal.available });
      await finishKey(user, endpoint, key, 201, responseBody, true);
      res.status(201).json(JSON.parse(responseBody));
    } catch (e) {
      await finishKey(user, endpoint, key, 0, "", false).catch(() => {});
      throw e;
    }
  }));

  /* --------------------------- renters & documents ---------------------------- */

  router.get("/api/renters", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["front_desk", "manager"]);
    const qs = String(req.query.q ?? "");
    const r = await q(
      `SELECT r.id, r.name, r.business, r.email, r.home_site_id FROM renters r
       WHERE r.operator_id = $1
         AND (lower(r.name) LIKE '%' || $2 || '%' OR lower(r.business) LIKE '%' || $2 || '%' OR lower(r.email) LIKE '%' || $2 || '%')
       ORDER BY r.business ASC`,
      [user.operator_id, qs.toLowerCase()],
    );
    res.json({ renters: r.rows });
  }));

  router.post("/api/renters", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const body = req.body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const f of ["name", "business", "email", "phone", "password", "home_site_id"] as const) {
      if (typeof body[f] !== "string" || !(body[f] as string).trim()) fields[f] = `${f} is required.`;
    }
    if (typeof body.password === "string" && body.password.length < 10) fields.password = "Password must be at least 10 characters.";
    if (Object.keys(fields).length > 0) throw validation(fields);
    const site = await getSite(body.home_site_id as string);
    if (!site || site.operator_id !== user.operator_id) fields.home_site_id = "Unknown site.";
    if (Object.keys(fields).length > 0) throw validation(fields);
    const taken = await q(`SELECT id FROM app_users WHERE lower(email) = lower($1)`, [body.email as string]);
    if (taken.rowCount && taken.rowCount > 0) throw new ApiError(409, "email_taken", "That email is already in use.");
    const id = uid("rn");
    const userId = uid("usr");
    const { hashPassword } = await import("./seed.js");
    await withTx(async (tx) => {
      await tx.query(
        `INSERT INTO app_users (id, operator_id, name, email, password_hash, role, site_ids, renter_id)
         VALUES ($1,$2,$3,$4,$5,'renter','{}',$6)`,
        [userId, user.operator_id, body.name, body.email, hashPassword(body.password as string, userId + body.email), id],
      );
      await tx.query(
        `INSERT INTO renters (id, operator_id, home_site_id, user_id, name, business, email, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, user.operator_id, body.home_site_id, userId, body.name, body.business, body.email, body.phone],
      );
    });
    res.status(201).json({ renter: { id, name: body.name, business: body.business, email: body.email, phone: body.phone, home_site_id: body.home_site_id } });
  }));

  router.post("/api/documents", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role !== "renter") throw forbidden();
    await handleUpload(req, res, user.renter_id!);
  }));

  router.get("/api/documents", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    if (user.role === "renter") {
      res.json({ documents: await listDocuments(user.renter_id!) });
      return;
    }
    const renterId = String(req.query.renter_id ?? "");
    if (!renterId) throw validation({ renter_id: "renter_id is required." });
    const renter = await renterInScopeOrSelf(user, renterId);
    res.json({ documents: await listDocuments(renter.id) });
  }));

  router.get("/api/documents/:id/file", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    const doc = (await q(`SELECT * FROM documents WHERE id = $1`, [req.params.id])).rows[0] as
      | { id: string; renter_id: string; content_type: string; storage_key: string }
      | undefined;
    if (!doc) throw notFound();
    if (user.role === "renter") {
      if (user.renter_id !== doc.renter_id) throw notFound();
    } else {
      await renterInScopeOrSelf(user, doc.renter_id);
    }
    const bytes = await getObject(doc.storage_key);
    if (!bytes) throw notFound();
    const ext = doc.content_type === "application/pdf" ? "pdf" : doc.content_type === "image/png" ? "png" : "jpg";
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `inline; filename="${doc.id}.${ext}"`);
    res.send(bytes);
  }));

  /* ----------------------------- reports & dashboard ------------------------- */

  router.get("/api/dashboard", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const sites = await visibleSites(user);
    const out: unknown[] = [];
    const totals = { bookings_today: 0, booked_minutes_today: 0, unpaid_balance_cents: 0, expiring_documents: 0 };
    for (const s of sites) {
      const today = ld(s.time_zone, Date.now());
      const dayStart = resolveWallTime(s.time_zone, {
        y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)), d: Number(today.slice(8, 10)), hh: 0, mm: 0,
      });
      const dMin = dayMinutes(s.time_zone, today);
      const dayEnd = dayStart + dMin * 60000;
      const r = await q(
        `SELECT * FROM bookings WHERE site_id = $1 AND status = ANY($2::text[]) AND start_at < $4 AND end_at > $3`,
        [s.id, ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled"], new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()],
      );
      let bookedMinutes = 0;
      let unpaid = 0;
      for (const b of r.rows as unknown as BookingRow[]) {
        const sMs = Math.max(b.start_at.getTime(), dayStart);
        const eMs = Math.min(b.end_at.getTime(), dayEnd);
        bookedMinutes += Math.round((eMs - sMs) / 60000);
        if (b.status === "confirmed" && b.card_minutes > 0 && !(await bookingPaid(b))) {
          const startLocal = ld(s.time_zone, b.start_at.getTime());
          if (startLocal >= today && startLocal <= addDays(today, 30)) unpaid += b.card_cents;
        }
      }
      const today14 = addDays(today, 14);
      const exp = await q(
        `SELECT count(*)::int AS c FROM documents d JOIN renters r ON r.id = d.renter_id
         WHERE r.home_site_id = $1 AND d.expires_on >= $2 AND d.expires_on <= $3`,
        [s.id, today, today14],
      );
      const expiring = (exp.rows[0] as { c: number }).c;
      out.push({
        site_id: s.id, name: s.name, local_date: today,
        bookings_today: r.rows.length, booked_minutes_today: bookedMinutes,
        unpaid_balance_cents: unpaid, expiring_documents: expiring,
      });
      totals.bookings_today += r.rows.length;
      totals.booked_minutes_today += bookedMinutes;
      totals.unpaid_balance_cents += unpaid;
      totals.expiring_documents += expiring;
    }
    res.json({ sites: out, totals });
  }));

  router.get("/api/sites/:id/utilisation", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const site = await siteInScope(user, req.params.id);
    const date = String(req.query.date ?? "");
    if (!isDate(date)) throw validation({ date: "The date must be YYYY-MM-DD." });
    res.json(await utilisation(site, date));
  }));

  router.get("/api/sites/:id/utilisation.csv", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const site = await siteInScope(user, req.params.id);
    const date = String(req.query.date ?? "");
    if (!isDate(date)) throw validation({ date: "The date must be YYYY-MM-DD." });
    const u = await utilisation(site, date);
    const rows = ["station,booked_minutes,day_minutes,utilisation_percent"];
    for (const st of u.stations) {
      rows.push(`${JSON.stringify(st.name)},${st.booked_minutes},${u.day_minutes},${st.utilisation_percent.toFixed(1)}`);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(rows.join("\r\n") + "\r\n");
  }));

  /* ------------------------------ policies ---------------------------------- */

  router.get("/api/sites/:id/policies", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const site = await siteInScope(user, req.params.id);
    const versions = await policiesForSite(site.id);
    res.json({
      versions: versions.map(v => ({
        id: v.id, notice_hours: v.notice_hours, effective_from: v.effective_from,
        effective_at: iso(v.effective_at.getTime()), created_by_name: v.created_by_name, created_at: iso(v.created_at.getTime()),
      })),
    });
  }));

  router.post("/api/sites/:id/policies", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const site = await siteInScope(user, req.params.id);
    const body = req.body as { notice_hours?: unknown; effective_from?: unknown };
    const fields: Record<string, string> = {};
    const notice = Number(body.notice_hours);
    if (!Number.isInteger(notice) || notice < 1 || notice > 168) fields.notice_hours = "Notice hours must be between 1 and 168.";
    if (typeof body.effective_from !== "string" || !isDate(body.effective_from)) fields.effective_from = "Give the effective date.";
    if (Object.keys(fields).length > 0) throw validation(fields);
    const today = ld(site.time_zone, Date.now());
    if (body.effective_from! < today) fields.effective_from = "The date must be today or later.";
    if (Object.keys(fields).length > 0) throw validation(fields);
    const taken = await q(`SELECT id FROM policy_versions WHERE site_id = $1 AND effective_from = $2`, [site.id, body.effective_from]);
    if (taken.rowCount && taken.rowCount > 0) throw new ApiError(409, "policy_date_taken", "A policy already starts on that date.");
    const eff = resolveWallTime(site.time_zone, {
      y: Number((body.effective_from as string).slice(0, 4)), m: Number((body.effective_from as string).slice(5, 7)),
      d: Number((body.effective_from as string).slice(8, 10)), hh: 0, mm: 0,
    });
    const effectiveAt = Math.max(eff, Date.now());
    const id = uid("pol");
    await q(
      `INSERT INTO policy_versions (id, site_id, notice_hours, effective_from, effective_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, site.id, notice, body.effective_from, new Date(effectiveAt).toISOString(), user.id],
    );
    res.status(201).json({
      version: {
        id, notice_hours: notice, effective_from: body.effective_from,
        effective_at: iso(effectiveAt), created_by_name: user.name, created_at: iso(Date.now()),
      },
    });
  }));

  /* ------------------------------ binder links -------------------------------- */

  router.get("/api/sites/:id/binder-links", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const site = await siteInScope(user, req.params.id);
    const r = await q(`SELECT * FROM binder_links WHERE site_id = $1 ORDER BY created_at DESC`, [site.id]);
    res.json({ links: await Promise.all((r.rows as unknown as { id: string; site_id: string; from_date: Date; to_date: Date; expires_at: Date; revoked: boolean; created_at: Date }[]).map(async (l) => linkView(l))) });
  }));

  router.post("/api/sites/:id/binder-links", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const site = await siteInScope(user, req.params.id);
    const body = req.body as { from?: unknown; to?: unknown };
    const fields: Record<string, string> = {};
    if (typeof body.from !== "string" || !isDate(body.from)) fields.from = "Give the from date.";
    if (typeof body.to !== "string" || !isDate(body.to)) fields.to = "Give the to date.";
    if (Object.keys(fields).length > 0) throw validation(fields);
    const from = body.from as string;
    const to = body.to as string;
    if (to < from) throw validation({ to: "To must be on or after from." });
    const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
    if (days > 30) throw validation({ to: "The range may cover at most 31 days." });
    const link = await createBinderLink(site.id, from, to);
    res.status(201).json({ link: await linkView(link) });
  }));

  router.post("/api/binder-links/:id/regenerate", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const link = await binderLinkInScope(user, req.params.id);
    if (link.revoked) {
      throw new ApiError(409, "invalid_transition", "Cannot regenerate a revoked binder link.", { from: "revoked", action: "regenerate" });
    }
    const newLink = await createBinderLink(link.site_id, isoDate(link.from_date), isoDate(link.to_date), link.id);
    res.json({ link: await linkView(newLink) });
  }));

  router.delete("/api/binder-links/:id", asyncRoute(async (req, res) => {
    const user = requireUser(req);
    requireRole(user, ["manager"]);
    const link = await binderLinkInScope(user, req.params.id);
    await q(`UPDATE binder_links SET revoked = true WHERE id = $1`, [link.id]);
    res.status(204).end();
  }));

  /* ------------------------------ binder public -------------------------------- */

  router.all("/api/binder/:token", asyncRoute(async (req, res) => {
    if (req.method !== "GET") throw new ApiError(405, "read_only", "The binder is read-only.");
    const data = await binderData(req.params.token);
    if (!data) throw new ApiError(404, "link_not_found", "This binder link is no longer valid.");
    res.json(data);
  }));

  router.all("/binder/:token", asyncRoute(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") throw new ApiError(405, "read_only", "The binder is read-only.");
    const data = await binderData(req.params.token);
    if (!data) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(deadLinkPage());
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(binderPage(data, req.params.token));
  }));

  router.all("/binder/:token/binder.pdf", asyncRoute(async (req, res) => {
    if (req.method !== "GET") throw new ApiError(405, "read_only", "The binder is read-only.");
    const link = await binderLinkRow(req.params.token);
    if (!link) throw new ApiError(404, "link_not_found", "This binder link is no longer valid.");
    const bytes = await getObject(link.pdf_key);
    if (!bytes) throw new ApiError(404, "link_not_found", "This binder link is no longer valid.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="binder.pdf"');
    res.send(bytes);
  }));
}

/* -------------------------------- helpers ------------------------------------ */

async function renterInScopeOrSelf(user: SessionUser, renterId: string) {
  if (user.role === "renter") {
    if (user.renter_id !== renterId) throw notFound();
    return (await getRenter(renterId))!;
  }
  const renter = await getRenter(renterId);
  if (!renter || renter.operator_id !== user.operator_id) throw notFound();
  return renter;
}

async function listDocuments(renterId: string): Promise<unknown[]> {
  const r = await q(`SELECT * FROM documents WHERE renter_id = $1 ORDER BY uploaded_at DESC`, [renterId]);
  return r.rows.map((d: { id: string; kind: string; valid_from: Date; expires_on: Date; content_type: string; size_bytes: number; uploaded_at: Date }) => ({
    id: d.id,
    kind: d.kind,
    valid_from: d.valid_from.toISOString().slice(0, 10),
    expires_on: d.expires_on.toISOString().slice(0, 10),
    content_type: d.content_type,
    size_bytes: d.size_bytes,
    uploaded_at: iso(d.uploaded_at.getTime()),
  }));
}

async function handleUpload(req: Request, res: Response, renterId: string): Promise<void> {
  const ct = (req.headers["content-type"] ?? "");
  if (!ct.startsWith("multipart/form-data")) throw new ApiError(415, "unsupported_media_type", "Send multipart/form-data.");
  const raw = await readBody(req, 5100000);
  if (!raw) throw new ApiError(413, "body_too_large", "The request body is too large.");
  const parts = parseMultipart(raw, ct);
  const text = (name: string): string => {
    const v = parts.get(name);
    return v && typeof v === "object" && "text" in v && v.text !== undefined ? v.text : "";
  };
  const kind = text("kind");
  const validFrom = text("valid_from");
  const expiresOn = text("expires_on");
  const file = parts.get("file");
  const fields: Record<string, string> = {};
  if (kind !== "liability" && kind !== "food_handler") fields.kind = "Pick a document type.";
  if (!isDate(validFrom)) fields.valid_from = "Give the valid-from date.";
  if (!isDate(expiresOn)) fields.expires_on = "Give the expiry date.";
  if (expiresOn < validFrom) fields.expires_on = "Expiry must be on or after valid from.";
  if (!file || !file.bytes) fields.file = "Attach a file.";
  if (Object.keys(fields).length > 0) throw validation(fields);

  const bytes = file!.bytes!;
  if (bytes.length > FILE_LIMIT) {
    throw new ApiError(413, "file_too_large", "Files must be 5,000,000 bytes or smaller.", { limit_bytes: 5000000 });
  }
  const type = sniffType(bytes);
  if (!type) throw new ApiError(415, "unsupported_file_type", "Files must be PDF, PNG or JPEG.");

  const id = uid("doc");
  const key = `renters/${renterId}/documents/${id}`;
  await putObject(key, bytes, type);
  await q(
    `INSERT INTO documents (id, renter_id, kind, valid_from, expires_on, content_type, size_bytes, storage_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, renterId, kind, validFrom, expiresOn, type, bytes.length, key],
  );
  res.status(201).json({
    document: {
      id, kind, valid_from: validFrom, expires_on: expiresOn,
      content_type: type, size_bytes: bytes.length, uploaded_at: iso(Date.now()),
    },
  });
}

function sniffType(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

async function readBody(req: Request, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += b.length;
    if (size > limit) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

interface MultipartValue {
  text?: string;
  bytes?: Buffer;
}

function parseMultipart(body: Buffer, contentType: string): Map<string, MultipartValue> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = m ? (m[1] ?? m[2]) : "";
  const out = new Map<string, MultipartValue>();
  const delim = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const next = body.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    let part = body.slice(pos + delim.length, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) { pos = next; continue; }
    const headers = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/.exec(headers);
    if (!nameMatch) { pos = next; continue; }
    let value = content;
    if (value[value.length - 2] === 0x0d && value[value.length - 1] === 0x0a) value = value.slice(0, -2);
    if (headers.includes("filename=")) out.set(nameMatch[1], { bytes: value });
    else out.set(nameMatch[1], { text: value.toString("utf8") });
    pos = next;
  }
  return out;
}

interface Utilisation {
  site_id: string;
  date: string;
  time_zone: string;
  day_minutes: number;
  stations: { station_id: string; name: string; booked_minutes: number; utilisation_percent: number }[];
}

async function utilisation(site: { id: string; name: string; time_zone: string }, date: string): Promise<Utilisation> {
  const dayStart = resolveWallTime(site.time_zone, {
    y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)), hh: 0, mm: 0,
  });
  const dMin = dayMinutes(site.time_zone, date);
  const dayEnd = dayStart + dMin * 60000;
  const stations = await q(`SELECT * FROM stations WHERE site_id = $1 ORDER BY ordinal`, [site.id]);
  const bookings = await q(
    `SELECT b.* FROM bookings b WHERE b.site_id = $1 AND b.status = ANY($2::text[]) AND b.start_at < $4 AND b.end_at > $3`,
    [site.id, ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled"], new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()],
  );
  const out = [];
  for (const st of stations.rows as { id: string; name: string }[]) {
    let booked = 0;
    for (const b of bookings.rows as unknown as BookingRow[]) {
      if (b.station_id !== st.id) continue;
      const sMs = Math.max(b.start_at.getTime(), dayStart);
      const eMs = Math.min(b.end_at.getTime(), dayEnd);
      booked += Math.round((eMs - sMs) / 60000);
    }
    out.push({
      station_id: st.id, name: st.name, booked_minutes: booked,
      utilisation_percent: Math.round((booked / dMin) * 1000) / 10,
    });
  }
  return { site_id: site.id, date, time_zone: site.time_zone, day_minutes: dMin, stations: out };
}

function addDays(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface BinderLinkRow {
  id: string;
  site_id: string;
  token: string;
  from_date: Date;
  to_date: Date;
  created_at: Date;
  expires_at: Date;
  revoked: boolean;
  pdf_key: string;
}

async function createBinderLink(siteId: string, from: string, to: string, oldId?: string): Promise<BinderLinkRow> {
  const id = uid("bl");
  const tok = token(18);
  const expiresAt = new Date(Date.now() + BINDER_LINK_TTL_SECONDS * 1000);
  const pdfKey = `sites/${siteId}/binders/${id}.pdf`;
  const oldLink = oldId ? await q(`SELECT * FROM binder_links WHERE id = $1`, [oldId]) : null;
  if (oldLink && oldLink.rows.length > 0) {
    await q(`DELETE FROM binder_links WHERE id = $1`, [oldId]);
  }
  await q(
    `INSERT INTO binder_links (id, site_id, token, from_date, to_date, expires_at, revoked, pdf_key)
     VALUES ($1,$2,$3,$4,$5,$6,false,$7)`,
    [id, siteId, tok, from, to, expiresAt.toISOString(), pdfKey],
  );
  // Generate the PDF now.
  const site = (await getSite(siteId))!;
  const data = await binderRows(site, from, to);
  const pdf = binderPdf(site.name, from, to, data);
  await putObject(pdfKey, pdf, "application/pdf");
  return (await q(`SELECT * FROM binder_links WHERE id = $1`, [id])).rows[0] as unknown as BinderLinkRow;
}

async function linkView(l: { id: string; site_id: string; from_date: Date; to_date: Date; expires_at: Date; revoked: boolean; created_at: Date }): Promise<Record<string, unknown>> {
  return {
    id: l.id,
    site_id: l.site_id,
    from: isoDate(l.from_date),
    to: isoDate(l.to_date),
    url: await binderUrl(l.id),
    expires_at: iso(l.expires_at.getTime()),
    revoked: l.revoked,
    created_at: iso(l.created_at.getTime()),
  };
}

async function binderUrl(linkId: string): Promise<string> {
  const r = await q(`SELECT token FROM binder_links WHERE id = $1`, [linkId]);
  return `/binder/${(r.rows[0] as { token: string }).token}`;
}

async function binderLinkInScope(user: SessionUser, id: string): Promise<BinderLinkRow> {
  const r = await q(`SELECT * FROM binder_links WHERE id = $1`, [id]);
  const link = r.rows[0] as unknown as BinderLinkRow | undefined;
  if (!link) throw notFound();
  const site = await getSite(link.site_id);
  if (!site || site.operator_id !== user.operator_id) throw notFound();
  return link;
}

async function binderLinkRow(tokenStr: string): Promise<BinderLinkRow | null> {
  const r = await q(`SELECT * FROM binder_links WHERE token = $1`, [tokenStr]);
  const link = r.rows[0] as unknown as BinderLinkRow | undefined;
  if (!link) return null;
  if (link.revoked || Date.now() >= link.expires_at.getTime()) return null;
  return link;
}

interface BinderRowData {
  date: string;
  renter_name: string;
  business: string;
  station: string;
  local_start: string;
  local_end: string;
  liability: { status: "current" | "expired" | "missing"; expires_on: string | null };
  food_handler: { status: "current" | "expired" | "missing"; expires_on: string | null };
}

async function binderRows(site: { id: string; name: string; time_zone: string }, from: string, to: string): Promise<BinderRowData[]> {
  const start = resolveWallTime(site.time_zone, { y: Number(from.slice(0, 4)), m: Number(from.slice(5, 7)), d: Number(from.slice(8, 10)), hh: 0, mm: 0 });
  const toEnd = new Date(Date.parse(to + "T00:00:00Z") + 86400000);
  const end = resolveWallTime(site.time_zone, { y: toEnd.getUTCFullYear(), m: toEnd.getUTCMonth() + 1, d: toEnd.getUTCDate(), hh: 0, mm: 0 });
  const bookings = await q(
    `SELECT b.* FROM bookings b WHERE b.site_id = $1 AND b.status = ANY($2::text[]) AND b.start_at < $4 AND b.end_at > $3 ORDER BY b.start_at ASC`,
    [site.id, ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled"], new Date(start).toISOString(), new Date(end).toISOString()],
  );
  const out: BinderRowData[] = [];
  for (const b of bookings.rows as unknown as BookingRow[]) {
    const station = (await q(`SELECT name FROM stations WHERE id = $1`, [b.station_id])).rows[0] as { name: string };
    const renter = (await getRenter(b.renter_id))!;
    const dates = rangeDates(site.time_zone, b.start_at.getTime(), b.end_at.getTime());
    for (const d of dates) {
      if (d < from || d > to) continue;
      out.push({
        date: d,
        renter_name: renter.name,
        business: renter.business,
        station: station.name,
        local_start: localStamp(site.time_zone, b.start_at.getTime()),
        local_end: localStamp(site.time_zone, b.end_at.getTime()),
        liability: await docStatus(b.renter_id, "liability", d),
        food_handler: await docStatus(b.renter_id, "food_handler", d),
      });
    }
  }
  return out;
}

async function docStatus(renterId: string, kind: "liability" | "food_handler", date: string): Promise<{ status: "current" | "expired" | "missing"; expires_on: string | null }> {
  const docs = await q(
    `SELECT * FROM documents WHERE renter_id = $1 AND kind = $2 ORDER BY expires_on ASC`,
    [renterId, kind],
  );
  let latestCurrent: string | null = null;
  let latestExpired: string | null = null;
  for (const d of docs.rows as { valid_from: string; expires_on: string; storage_key: string }[]) {
    if (d.valid_from <= date && d.expires_on >= date) {
      const obj = await getObject(d.storage_key);
      if (obj !== null && (latestCurrent === null || d.expires_on > latestCurrent)) latestCurrent = d.expires_on;
    }
  }
  if (latestCurrent) return { status: "current", expires_on: latestCurrent };
  for (const d of docs.rows as { expires_on: string }[]) {
    if (d.expires_on < date && (latestExpired === null || d.expires_on > latestExpired)) latestExpired = d.expires_on;
  }
  if (latestExpired) return { status: "expired", expires_on: latestExpired };
  return { status: "missing", expires_on: null };
}

async function binderData(tokenStr: string): Promise<Record<string, unknown> | null> {
  const link = await binderLinkRow(tokenStr);
  if (!link) return null;
  const site = (await getSite(link.site_id))!;
  const from = isoDate(link.from_date);
  const to = isoDate(link.to_date);
  const rows = await binderRows(site, from, to);
  return {
    site_name: site.name,
    from,
    to,
    generated_at: iso(Date.now()),
    rows,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function deadLinkPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Compliance binder</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/binder.css">
</head><body class="binder-page"><main class="binder-card"><h1>This binder link is no longer valid</h1></main></body></html>`;
}

function binderPage(data: Record<string, unknown>, tokenStr: string): string {
  const rows = data.rows as BinderRowData[];
  const trs = rows.map(r => {
    const cell = (x: { status: string; expires_on: string | null }) =>
      x.status === "current" ? `Current until ${escapeHtml(x.expires_on!)}` : x.status === "expired" ? `Expired ${escapeHtml(x.expires_on!)}` : "Missing";
    return `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.renter_name)}</td><td>${escapeHtml(r.business)}</td><td>${escapeHtml(r.station)} ${escapeHtml(r.local_start)}–${escapeHtml(r.local_end)}</td><td>${cell(r.liability)}</td><td>${cell(r.food_handler)}</td></tr>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Compliance binder</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/binder.css">
</head><body class="binder-page"><main class="binder-card">
<h1>${escapeHtml(data.site_name as string)}</h1>
<p class="binder-meta">${escapeHtml(data.from as string)} to ${escapeHtml(data.to as string)} · generated ${escapeHtml(data.generated_at as string)}</p>
<p><a class="binder-download" href="/binder/${encodeURIComponent(tokenStr)}/binder.pdf">Download PDF</a></p>
<table class="binder-table"><caption class="sr-only">Compliance binder</caption>
<thead><tr><th>Date</th><th>Renter</th><th>Business</th><th>Station and time</th><th>Liability certificate</th><th>Food handler card</th></tr></thead>
<tbody>${trs}</tbody></table></main></body></html>`;
}

function binderPdf(siteName: string, from: string, to: string, rows: BinderRowData[]): Buffer {
  const lines: string[] = [
    siteName,
    `Compliance binder ${from} to ${to}`,
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "Date         Renter             Station and time            Liability       Food handler",
  ];
  for (const r of rows) {
    const liab = r.liability.status === "current" ? `until ${r.liability.expires_on}` : r.liability.status === "expired" ? `expired ${r.liability.expires_on}` : "Missing";
    const food = r.food_handler.status === "current" ? `until ${r.food_handler.expires_on}` : r.food_handler.status === "expired" ? `expired ${r.food_handler.expires_on}` : "Missing";
    lines.push(`${r.date}  ${r.business.slice(0, 18).padEnd(18)} ${r.station.slice(0, 12).padEnd(12)} ${r.local_start.slice(11)}-${r.local_end.slice(11)}  ${liab.padEnd(15)} ${food}`);
  }
  return multiPagePdf(lines, 52);
}

function multiPagePdf(lines: string[], perPage: number): Buffer {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);
  const catalogId = 1, pagesId = 2, fontId = 3;
  const pageIds: number[] = [];
  const objs: string[] = [];
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = "";
  objs[fontId - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;
  let id = fontId + 1;
  for (const page of pages) {
    const contentId = id++;
    const pageId = id++;
    pageIds.push(pageId);
    const text = page.map((l, i) => `BT /F1 9 Tf 40 ${740 - i * 13} Td (${l.replace(/([()\\])/g, "\\$1")}) Tj ET`).join("\n");
    objs[contentId - 1] = `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
    objs[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 792 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(pid => `${pid} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets[i] = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const maxId = objs.length;
  const xrefPos = out.length;
  out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < maxId; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
