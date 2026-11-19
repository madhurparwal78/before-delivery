import express, { type Request, type Response } from "express";
import { now } from "../clock.js";
import { HOST_SESSION_HOURS, NO_SHOW_AFTER_MINUTES, SLOT_TIMES } from "../../shared/seed.js";
import {
  TABLES, ROOMS, PAIR_BY_ID, fitsBySeatRange, tableIdsForTarget, turnWindow, PAIRS,
} from "../floor.js";
import { loadWindowsForDate, coversFreeByRoom, totalCoversFree, overlaps } from "../occupancy.js";
import { lisbonSlotInstant, todayInLisbon, currentSlot } from "../config.js";
import { errors } from "../errors.js";
import { Handled } from "../http.js";
import { verifyPassword } from "../db.js";
import { token, bookingReference, type Outcome } from "../idempotency.js";
import { publishEvent } from "../events.js";
import type { AppCtx } from "../app.js";
import { bookingToApi, coerceBooking, type DbBooking } from "../bookings.js";
import { offerFreedTable } from "./actions.js";
import { validParty, invalid, partyOrThrow } from "./validate.js";
import type { HostFloorResponse, HostFloorTable, HostSessionResponse } from "../types.js";

const HOST_COOKIE = "host_session";

interface HostSession {
  host_id: number;
  token: string;
  signed_in_at: Date;
}

/** A host session is live while the server's now is earlier than sign-in plus 12 hours. */
function sessionLive(s: HostSession, t: Date): boolean {
  return t.getTime() < s.signed_in_at.getTime() + HOST_SESSION_HOURS * 3600_000;
}

export function registerHostRoutes(app: express.Express, ctx: AppCtx): void {
  const { pool, valkey, killbill, idem, cfg } = ctx;
  const sessions = new Map<string, HostSession>();

  const cookieToken = (req: Request): string | null => {
    const cookie = req.headers.cookie ?? "";
    const m = /(?:^|;\s*)host_session=([^;]+)/.exec(cookie);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
  };

  const loadSession = async (req: Request): Promise<HostSession | null> => {
    const tokenValue = cookieToken(req);
    if (!tokenValue) return null;
    const cached = sessions.get(tokenValue);
    const t = now();
    if (cached) {
      if (sessionLive(cached, t)) return cached;
      sessions.delete(tokenValue);
      return null;
    }
    const r = await pool.query<{ host_id: number; token: string; signed_in_at: Date | string }>(
      `SELECT host_id, token, signed_in_at FROM host_sessions WHERE token = $1`, [tokenValue],
    );
    if (r.rows.length === 0) return null;
    const row: HostSession = { host_id: r.rows[0].host_id, token: r.rows[0].token, signed_in_at: new Date(r.rows[0].signed_in_at) };
    sessions.set(tokenValue, row);
    return sessionLive(row, t) ? row : (sessions.delete(tokenValue), null);
  };

  const requireSession = async (req: Request, res: Response): Promise<HostSession | null> => {
    const s = await loadSession(req);
    if (!s) {
      res.status(401).json({ error: { code: "unauthenticated", message: "Sign in to continue." } });
      return null;
    }
    return s;
  };

  app.post("/api/host/session", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const r = await pool.query<{ id: number; email: string; name: string; password_hash: string }>(
      `SELECT id, email, name, password_hash FROM hosts WHERE email = $1`, [email],
    );
    if (r.rows.length === 0 || !verifyPassword(password, r.rows[0].password_hash)) {
      throw new Handled(errors.invalidCredentials());
    }
    const host = r.rows[0];
    const sessionToken = token(24);
    const t = now();
    await pool.query(
      `INSERT INTO host_sessions (id, host_id, token, signed_in_at) VALUES ($1, $2, $3, $4)`,
      [token(16), host.id, sessionToken, t],
    );
    const session: HostSession = { host_id: host.id, token: sessionToken, signed_in_at: t };
    sessions.set(sessionToken, session);
    const expires = new Date(t.getTime() + HOST_SESSION_HOURS * 3600_000);
    res.setHeader("Set-Cookie", `${HOST_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ host: { email: host.email, name: host.name }, expires_at: expires.toISOString() } satisfies HostSessionResponse);
  });

  app.delete("/api/host/session", async (req, res) => {
    const tokenValue = cookieToken(req);
    if (tokenValue) {
      await pool.query(`DELETE FROM host_sessions WHERE token = $1`, [tokenValue]);
      sessions.delete(tokenValue);
    }
    res.setHeader("Set-Cookie", `${HOST_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.status(204).end();
  });

  app.get("/api/host/floor", async (req, res) => {
    const s = await requireSession(req, res);
    if (!s) return;
    const t = now();
    const date = todayInLisbon(t);
    const timeParam = typeof req.query.time === "string" ? req.query.time : "";
    if (timeParam !== "" && !SLOT_TIMES.includes(timeParam)) invalid({ time: "Choose a time from the list." });
    const time = timeParam !== "" ? timeParam : currentSlot(t) ?? "22:00";
    const slotInstant = lisbonSlotInstant(date, time);

    const windows = await loadWindowsForDate(pool, date, t);
    const coversMap = coversFreeByRoom(windows, slotInstant);

    const holds = await pool.query(
      `SELECT hold_id, table_id, time, party_size, expires_at FROM holds WHERE date = $1 AND status = 'live'`, [date],
    );
    const offers = await pool.query(
      `SELECT offer_id, table_id, time, party_size, expires_at FROM offers WHERE date = $1 AND status = 'offered'`, [date],
    );
    const bookings = await pool.query(
      `SELECT reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
              manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id
       FROM bookings WHERE date = $1 AND status IN ('booked','seated')`, [date],
    );

    const holdByTable = new Map<string, { party_size: number; expires_at: Date; time: string }>();
    for (const h of holds.rows) {
      if (t.getTime() >= new Date(h.expires_at).getTime()) continue;
      for (const tb of tableIdsForTarget(h.table_id)) {
        holdByTable.set(tb, { party_size: h.party_size, expires_at: new Date(h.expires_at), time: h.time });
      }
    }
    const offerByTable = new Map<string, { expires_at: Date; time: string }>();
    for (const o of offers.rows) {
      if (t.getTime() >= new Date(o.expires_at).getTime()) continue;
      for (const tb of tableIdsForTarget(o.table_id)) {
        offerByTable.set(tb, { expires_at: new Date(o.expires_at), time: o.time });
      }
    }
    const bookingByTable = new Map<string, DbBooking>();
    for (const b of bookings.rows) {
      const coerced = coerceBooking(b);
      for (const tb of tableIdsForTarget(coerced.table_id)) bookingByTable.set(tb, coerced);
    }

    const tables: HostFloorTable[] = TABLES.map((tb) => {
      const hold = holdByTable.get(tb.table_id) ?? null;
      const offer = offerByTable.get(tb.table_id) ?? null;
      const booking = bookingByTable.get(tb.table_id) ?? null;
      const bookedAtSlot = booking !== null && booking.starts_at.getTime() <= slotInstant.getTime() &&
        slotInstant.getTime() < turnWindow(booking.starts_at, booking.party_size).end.getTime();
      const heldAtSlot = hold !== null &&
        lisbonSlotInstant(date, hold.time).getTime() <= slotInstant.getTime() &&
        slotInstant.getTime() < turnWindow(lisbonSlotInstant(date, hold.time), hold.party_size).end.getTime();
      const offeredAtSlot = offer !== null && booking === null && !heldAtSlot &&
        lisbonSlotInstant(date, offer.time).getTime() <= slotInstant.getTime() &&
        slotInstant.getTime() < turnWindow(lisbonSlotInstant(date, offer.time), 2).end.getTime();
      const joinedWith = (() => {
        for (const pair of PAIRS) {
          if (pair.tables.includes(tb.table_id)) return pair.tables.find((x) => x !== tb.table_id) ?? null;
        }
        return null;
      })();
      let status: HostFloorTable["status"] = "free";
      if (bookedAtSlot && booking?.status === "seated") status = "seated";
      else if (bookedAtSlot) status = "booked";
      else if (heldAtSlot) status = "held";
      else if (offeredAtSlot) status = "offered";
      return {
        table_id: tb.table_id,
        room_id: tb.room_id,
        status,
        joined_with: joinedWith,
        hold: hold ? { party_size: hold.party_size, expires_at: hold.expires_at.toISOString() } : null,
        offer: offer ? { expires_at: offer.expires_at.toISOString() } : null,
        booking: booking ? bookingToApi(booking) : null,
      };
    });

    res.json({
      date, time, server_now: t.toISOString(),
      totals: {
        covers_free: totalCoversFree(coversMap),
        rooms: ROOMS.map((r) => ({
          room_id: r.room_id, name: r.name, seats: r.seats, covers_free: coversMap.get(r.room_id) ?? 0,
        })),
      },
      tables,
    } satisfies HostFloorResponse);
  });

  app.get("/api/host/bookings", async (req, res) => {
    const s = await requireSession(req, res);
    if (!s) return;
    const t = now();
    const date = todayInLisbon(t);
    const r = await pool.query(
      `SELECT reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
              manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id
       FROM bookings WHERE date = $1
       ORDER BY time, created_at`, [date],
    );
    res.json({ date, bookings: r.rows.map((b) => bookingToApi(coerceBooking(b))) });
  });

  /** Seat a booked table, only on the booking's Lisbon date. */
  app.post("/api/host/bookings/:reference/seat", async (req, res) => {
    const s = await requireSession(req, res);
    if (!s) return;
    const t = now();
    const date = todayInLisbon(t);
    const client = await pool.connect();
    let booking: DbBooking;
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id
         FROM bookings WHERE reference = $1 FOR UPDATE`, [req.params.reference],
      );
      if (r.rows.length === 0) { await client.query("ROLLBACK"); throw new Handled(errors.notFound()); }
      const b = coerceBooking(r.rows[0]);
      if (b.status !== "booked") { await client.query("ROLLBACK"); throw new Handled(errors.invalidTransition()); }
      if (b.date !== date) { await client.query("ROLLBACK"); throw new Handled(errors.notTonight()); }
      const upd = await client.query(
        `UPDATE bookings SET status = 'seated' WHERE reference = $1 AND status = 'booked'
         RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                   manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
        [req.params.reference],
      );
      await client.query("COMMIT");
      booking = coerceBooking(upd.rows[0]);
    } finally {
      client.release();
    }
    await publishEvent(pool, valkey, {
      type: "booking.seated", date: booking.date, time: booking.time,
      table_ids: tableIdsForTarget(booking.table_id), party_size: booking.party_size, reference: booking.reference,
    }).catch(() => undefined);
    res.json({ booking: bookingToApi(booking) });
  });

  /** Clear a seated table: the window ends at the moment of clearing. */
  app.post("/api/host/bookings/:reference/clear", async (req, res) => {
    const s = await requireSession(req, res);
    if (!s) return;
    const client = await pool.connect();
    let booking: DbBooking;
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id
         FROM bookings WHERE reference = $1 FOR UPDATE`, [req.params.reference],
      );
      if (r.rows.length === 0) { await client.query("ROLLBACK"); throw new Handled(errors.notFound()); }
      const b = coerceBooking(r.rows[0]);
      if (b.status !== "seated") { await client.query("ROLLBACK"); throw new Handled(errors.invalidTransition()); }
      const upd = await client.query(
        `UPDATE bookings SET status = 'completed', cleared_at = now() WHERE reference = $1 AND status = 'seated'
         RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                   manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
        [req.params.reference],
      );
      await client.query("COMMIT");
      booking = coerceBooking(upd.rows[0]);
    } finally {
      client.release();
    }
    await publishEvent(pool, valkey, {
      type: "booking.completed", date: booking.date, time: booking.time,
      table_ids: tableIdsForTarget(booking.table_id), party_size: booking.party_size, reference: booking.reference,
    }).catch(() => undefined);
    await offerFreedTable(pool, valkey, killbill, cfg, booking.date, tableIdsForTarget(booking.table_id), now()).catch(() => undefined);
    res.json({ booking: bookingToApi(booking) });
  });

  /** Mark a no-show, only from 15 minutes after the slot starts. The deposit is retained. */
  app.post("/api/host/bookings/:reference/no-show", async (req, res) => {
    const s = await requireSession(req, res);
    if (!s) return;
    const t = now();
    const client = await pool.connect();
    let booking: DbBooking;
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id
         FROM bookings WHERE reference = $1 FOR UPDATE`, [req.params.reference],
      );
      if (r.rows.length === 0) { await client.query("ROLLBACK"); throw new Handled(errors.notFound()); }
      const b = coerceBooking(r.rows[0]);
      if (b.status !== "booked") { await client.query("ROLLBACK"); throw new Handled(errors.invalidTransition()); }
      if (t.getTime() < b.starts_at.getTime() + NO_SHOW_AFTER_MINUTES * 60_000) {
        await client.query("ROLLBACK");
        const fromInstant = new Date(b.starts_at.getTime() + NO_SHOW_AFTER_MINUTES * 60_000);
        const hhmm = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(fromInstant);
        throw new Handled(errors.tooEarly(hhmm));
      }
      const newState = b.deposit_state === "paid" ? "retained" : b.deposit_state;
      const upd = await client.query(
        `UPDATE bookings SET status = 'no_show', deposit_state = $2 WHERE reference = $1 AND status = 'booked'
         RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                   manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
        [req.params.reference, newState],
      );
      await client.query("COMMIT");
      booking = coerceBooking(upd.rows[0]);
    } finally {
      client.release();
    }
    await publishEvent(pool, valkey, {
      type: "booking.no_show", date: booking.date, time: booking.time,
      table_ids: tableIdsForTarget(booking.table_id), party_size: booking.party_size, reference: booking.reference,
    }).catch(() => undefined);
    await offerFreedTable(pool, valkey, killbill, cfg, booking.date, tableIdsForTarget(booking.table_id), now()).catch(() => undefined);
    res.json({ booking: bookingToApi(booking) });
  });

  /** Walk-in: created directly as seated, no deposit, no email. */
  app.post("/api/host/walk-ins", async (req, res) => {
    const s = await requireSession(req, res);
    if (!s) return;
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
    if (key === "" || !/^[\x21-\x7E]{1,64}$/.test(key)) throw new Handled(errors.idempotencyKeyRequired());
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tableId = typeof body.table_id === "string" ? body.table_id : "";
    const party = validParty(body.party_size) ? (body.party_size as number) : null;
    const fields: Record<string, string> = {};
    const known = TABLES.some((tb) => tb.table_id === tableId) || PAIR_BY_ID.has(tableId);
    if (!known) fields.table_id = "Pick a table from the plan.";
    if (party === null) fields.party_size = "Choose 1 to 8 guests.";
    if (Object.keys(fields).length > 0) invalid(fields);
    const partySize = partyOrThrow(party);
    const outcome = await idem.run(key, "POST", req.originalUrl, body, async () => walkIn(tableId, partySize));
    res.status(outcome.status).json(outcome.body);
  });

  async function walkIn(tableId: string, party: number): Promise<Outcome> {
    const t = now();
    if (!valkey.isHealthy()) throw new Handled(errors.holdsPaused());
    if (!fitsBySeatRange(tableId, party)) throw new Handled(errors.tableNotForParty());
    const slot = currentSlot(t);
    if (!slot) throw new Handled(errors.tableTaken());
    const date = todayInLisbon(t);
    const start = lisbonSlotInstant(date, slot);
    const tables = tableIdsForTarget(tableId);
    const { end } = turnWindow(start, party);
    const windows = await loadWindowsForDate(pool, date, t);
    if (overlaps(windows, tables, start, end)) throw new Handled(errors.tableTaken());

    const reference = bookingReference();
    let claimed: boolean;
    try {
      claimed = await valkey.claimWindow(tables, start, party, reference, cfg.holdSeconds * 1000);
    } catch {
      throw new Handled(errors.holdsPaused());
    }
    if (!claimed) throw new Handled(errors.tableTaken());

    const client = await pool.connect();
    let booking: DbBooking;
    try {
      await client.query("BEGIN");
      const conflict = await client.query(
        `SELECT 1 FROM bookings
         WHERE date = $1 AND status IN ('booked','seated') AND table_id = ANY($2)
           AND tstzrange(starts_at, starts_at + make_interval(mins => $3)) && tstzrange($4, $5)
         LIMIT 1`,
        [date, tables, Math.round((end.getTime() - start.getTime()) / 60000), start, end],
      );
      if (conflict.rows.length > 0) throw new Handled(errors.tableTaken());
      const r = await client.query(
        `INSERT INTO bookings (reference, status, source, date, time, starts_at, party_size, table_id, name,
           deposit_cents, deposit_state)
         VALUES ($1, 'seated', 'walk_in', $2, $3, $4, $5, $6, 'Walk-in', 0, 'none')
         RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                   manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
        [reference, date, slot, start, party, tableId],
      );
      await client.query("COMMIT");
      booking = coerceBooking(r.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      await valkey.releaseWindow(tables, start, party).catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    // The walk-in's claims exist only while it is being written.
    await valkey.releaseWindow(tables, start, party).catch(() => undefined);
    await publishEvent(pool, valkey, {
      type: "walkin.seated", date, time: slot, table_ids: tables, party_size: party, reference,
    }).catch(() => undefined);
    return { status: 201, body: { booking: bookingToApi(booking) }, store: true };
  }
}
