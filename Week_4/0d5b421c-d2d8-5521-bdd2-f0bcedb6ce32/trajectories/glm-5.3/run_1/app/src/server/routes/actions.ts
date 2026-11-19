import express from "express";
import { now } from "../clock.js";
import { BOOKING_LEAD_MINUTES, REFUND_CUTOFF_HOURS } from "../../shared/seed.js";
import {
  TABLE_BY_ID, PAIR_BY_ID, fitsBySeatRange, tableIdsForTarget, maxSeatsForTarget, depositCentsFor,
  turnWindow,
} from "../floor.js";
import { loadWindowsForDate, overlaps, eligibleTargets } from "../occupancy.js";
import { lisbonSlotInstant } from "../config.js";
import { errors } from "../errors.js";
import { Handled } from "../http.js";
import { token, bookingReference, type Outcome } from "../idempotency.js";
import { queueEmail, confirmationEmail, cancellationEmail, offerEmail } from "../mailer.js";
import { publishEvent } from "../events.js";
import { chooseOffer } from "../waitlist.js";
import type { AppCtx } from "../app.js";
import type { HoldResponse } from "../types.js";
import {
  bookingToApi, coerceBooking, overlapsBookedWindow, roomOfTable, tablesOf, type DbBooking,
} from "../bookings.js";
import {
  validDateString, dateInHorizon, isSlotTime, validParty, isoWithLisbonOffset, invalid, partyOrThrow,
} from "./validate.js";

interface HoldRecord {
  hold_id: string;
  table_id: string;
  date: string;
  time: string;
  party_size: number;
  status: "live" | "expired" | "released" | "confirmed";
  expires_at: Date | string;
  deposit_cents: number;
  reserved_reference: string | null;
}

function coerceHold(r: HoldRecord & Record<string, unknown>): HoldRecord & { expires_at: Date } {
  return { ...r, expires_at: new Date(r.expires_at) };
}

export function registerActionRoutes(app: express.Express, ctx: AppCtx): void {
  const { pool, valkey, killbill, idem, cfg } = ctx;

  /** Create a hold: claim every covered slot in Valkey, all or none. */
  app.post("/api/holds", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const date = typeof body.date === "string" ? body.date : "";
    const time = typeof body.time === "string" ? body.time : "";
    const party = validParty(body.party_size) ? (body.party_size as number) : null;
    const tableId = typeof body.table_id === "string" ? body.table_id : "";
    if (!validDateString(date) || !dateInHorizon(date)) fields.date = "Choose a date from today to 30 days ahead.";
    if (!isSlotTime(time)) fields.time = "Choose a time from the list.";
    if (party === null) fields.party_size = "Choose 1 to 8 guests.";
    if (!(TABLE_BY_ID.has(tableId) || PAIR_BY_ID.has(tableId))) fields.table_id = "Pick a table from the plan.";
    if (Object.keys(fields).length > 0) invalid(fields);
    const partySize = partyOrThrow(party);

    const t = now();
    if (!valkey.isHealthy()) throw new Handled(errors.holdsPaused());

    const start = lisbonSlotInstant(date, time);
    if (start.getTime() < t.getTime() + BOOKING_LEAD_MINUTES * 60_000) {
      throw new Handled(errors.slotNotBookable());
    }

    // Fit and occupancy refusals, in the published order.
    if (!fitsBySeatRange(tableId, partySize)) throw new Handled(errors.tableNotForParty());
    const windows = await loadWindowsForDate(pool, date, t);
    const tables = tableIdsForTarget(tableId);
    const { end } = turnWindow(start, partySize);
    if (overlaps(windows, tables, start, end)) throw new Handled(errors.tableTaken());
    const { fitsFree, smallestMaxSeats } = eligibleTargets(windows, date, time, partySize);
    if (smallestMaxSeats !== null && maxSeatsForTarget(tableId) > smallestMaxSeats && fitsFree.length > 0) {
      throw new Handled(errors.tableNotForParty());
    }

    const holdId = token(24);
    const expiresAt = new Date(t.getTime() + cfg.holdSeconds * 1000);
    const deposit = depositCentsFor(partySize, tableId);

    let claimed: boolean;
    try {
      claimed = await valkey.claimWindow(tables, start, partySize, holdId, cfg.holdSeconds * 1000);
    } catch {
      throw new Handled(errors.holdsPaused());
    }
    if (!claimed) throw new Handled(errors.tableTaken());

    let ok = false;
    try {
      await pool.query("BEGIN");
      if (await overlapsBookedWindow(pool, date, tables, start, end)) {
        throw new Handled(errors.tableTaken());
      }
      await pool.query(
        `INSERT INTO holds (hold_id, table_id, date, time, party_size, status, expires_at, deposit_cents)
         VALUES ($1, $2, $3, $4, $5, 'live', $6, $7)`,
        [holdId, tableId, date, time, partySize, expiresAt, deposit],
      );
      await pool.query("COMMIT");
      ok = true;
    } catch (e) {
      await pool.query("ROLLBACK").catch(() => undefined);
      await valkey.releaseWindow(tables, start, partySize).catch(() => undefined);
      throw e;
    }
    if (ok) {
      await publishEvent(pool, valkey, {
        type: "hold.created", date, time, table_ids: tables, party_size: partySize,
      }).catch(() => undefined);
    }

    res.status(201).json({
      hold_id: holdId, table_id: tableId, date, time, party_size: partySize,
      status: "live", expires_at: expiresAt.toISOString(), server_now: t.toISOString(),
      deposit_cents: deposit,
    } satisfies HoldResponse);
  });

  app.get("/api/holds/:holdId", async (req, res) => {
    const r = await pool.query(
      `SELECT hold_id, table_id, date, time, party_size, status, expires_at, deposit_cents
       FROM holds WHERE hold_id = $1`, [req.params.holdId],
    );
    if (r.rows.length === 0) throw new Handled(errors.notFound());
    const h = coerceHold(r.rows[0]);
    res.json({
      hold_id: h.hold_id, table_id: h.table_id, date: h.date, time: h.time,
      party_size: h.party_size, status: h.status, expires_at: h.expires_at.toISOString(),
      server_now: now().toISOString(), deposit_cents: h.deposit_cents,
    });
  });

  /** Release a hold: frees the table at once; a released hold answers 204 too. */
  app.delete("/api/holds/:holdId", async (req, res) => {
    const t = now();
    if (!valkey.isHealthy()) throw new Handled(errors.holdsPaused());
    const r = await pool.query(
      `SELECT hold_id, table_id, date, time, party_size, status, expires_at
       FROM holds WHERE hold_id = $1 FOR UPDATE`, [req.params.holdId],
    );
    if (r.rows.length === 0) throw new Handled(errors.notFound());
    const h = coerceHold(r.rows[0]);
    if (h.status === "confirmed") throw new Handled(errors.holdClosed());
    if (h.status === "released") { res.status(204).end(); return; }
    if (h.status === "live" && t.getTime() >= h.expires_at.getTime()) {
      throw new Handled(errors.holdExpired());
    }
    if (h.status === "live") {
      const start = lisbonSlotInstant(h.date, h.time);
      const tables = tableIdsForTarget(h.table_id);
      await pool.query(`UPDATE holds SET status = 'released' WHERE hold_id = $1 AND status = 'live'`, [h.hold_id]);
      try {
        await valkey.releaseOwned(tables, start, h.party_size, h.hold_id);
      } catch {
        throw new Handled(errors.holdsPaused());
      }
      await publishEvent(pool, valkey, {
        type: "hold.released", date: h.date, time: h.time, table_ids: tables, party_size: h.party_size,
      }).catch(() => undefined);
    }
    res.status(204).end();
  });

  /** Confirm a hold into a booking. Requires an Idempotency-Key. */
  app.post("/api/holds/:holdId/confirm", async (req, res) => {
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
    if (key === "" || !/^[\x21-\x7E]{1,64}$/.test(key)) throw new Handled(errors.idempotencyKeyRequired());

    const holdId = req.params.holdId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "";
    const email = typeof body.email === "string" ? body.email : "";
    const phone = typeof body.phone === "string" ? body.phone : undefined;
    const acceptDeposit = body.accept_deposit;

    const fields: Record<string, string> = {};
    if (name.trim().length < 1 || name.trim().length > 80) fields.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      fields.email = "Enter an email address like name@example.com.";
    }
    if (phone !== undefined && phone.length > 32) fields.phone = "Use 32 characters or fewer.";

    const existing = await pool.query(
      `SELECT deposit_cents FROM holds WHERE hold_id = $1`, [holdId],
    );
    if (existing.rows.length === 0) {
      // Validation happens before the 404 check per precedence: only fields errors.
      if (Object.keys(fields).length > 0) invalid(fields);
      throw new Handled(errors.notFound());
    }
    const depositCents = Number(existing.rows[0].deposit_cents);
    if (depositCents > 0 && acceptDeposit !== true) {
      fields.accept_deposit = "Tick the box to accept the deposit.";
    }
    if (Object.keys(fields).length > 0) invalid(fields);

    if (!valkey.isHealthy()) throw new Handled(errors.holdsPaused());

    const outcome = await idem.run(key, "POST", req.originalUrl, body, async () => confirmHold(holdId, name.trim(), email.trim(), phone));
    if (outcome.store === false && outcome.status !== 0) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    res.status(outcome.status).json(outcome.body);
  });

  async function confirmHold(holdId: string, name: string, email: string, phone?: string): Promise<Outcome> {
    const t = now();
    const r = await pool.query(
      `SELECT hold_id, table_id, date, time, party_size, status, expires_at, deposit_cents, reserved_reference
       FROM holds WHERE hold_id = $1 FOR UPDATE`, [holdId],
    );
    if (r.rows.length === 0) return { status: 404, body: { error: { code: "not_found", message: "We couldn't find that." } }, store: true };
    const hold = coerceHold(r.rows[0]);
    if (hold.status === "confirmed") throw new Handled(errors.holdClosed());
    if (hold.status !== "live" || t.getTime() >= hold.expires_at.getTime()) {
      throw new Handled(errors.holdExpired());
    }

    // The first confirm attempt reserves the booking reference; retries reuse it.
    let reference = hold.reserved_reference;
    if (!reference) {
      reference = bookingReference();
      await pool.query(`UPDATE holds SET reserved_reference = $1 WHERE hold_id = $2`, [reference, holdId]);
    }

    const start = lisbonSlotInstant(hold.date, hold.time);
    const tables = tableIdsForTarget(hold.table_id);
    const deposit = hold.deposit_cents;

    // Deposit first: charge through Kill Bill; continue only on a successful PURCHASE.
    let paymentId: string | null = null;
    let transactionId: string | null = null;
    if (deposit > 0) {
      if (!killbill.isHealthy()) throw new Handled(errors.depositsPaused());
      try {
        const accountId = await killbill.createAccount(email.toLowerCase(), name);
        const pmId = await killbill.ensurePaymentMethod(accountId);
        const charge = await killbill.purchase(accountId, pmId, reference, deposit);
        paymentId = charge.paymentId;
        transactionId = charge.transactionId;
      } catch (e) {
        if (e instanceof Error && e.message === "payment_failed") throw new Handled(errors.paymentFailed());
        if (e instanceof Error && e.message === "killbill_error") throw new Handled(errors.depositsPaused());
        throw e;
      }
    }

    const manageToken = token(24);
    const written = await writeBookingFromHold(hold as HoldRecord & { reserved_reference: string }, reference, name, email, phone, manageToken, paymentId, transactionId);
    if (!written.ok) {
      // The booking could not be written after a successful charge: refund in full.
      if (paymentId) {
        await killbill.refund(paymentId, reference, deposit).catch(() => undefined);
      }
      throw new Handled(errors.tableTaken());
    }

    const manageUrl = `${cfg.publicUrl}/manage/${manageToken}`;
    const booking = bookingToApi(written.booking);
    await queueEmail(pool, {
      to_email: email,
      ...confirmationEmail(
        { reference, starts_at: start, party_size: hold.party_size, table_id: hold.table_id,
          room: roomOfTable(hold.table_id) },
        manageUrl, deposit,
      ),
    });
    await publishEvent(pool, valkey, {
      type: "booking.created", date: hold.date, time: hold.time, table_ids: tables,
      party_size: hold.party_size, reference,
    }).catch(() => undefined);
    return { status: 201, body: { booking, manage_url: manageUrl }, store: true };
  }

  async function writeBookingFromHold(
    hold: HoldRecord & { reserved_reference: string }, reference: string, name: string, email: string,
    phone: string | undefined, manageToken: string, paymentId: string | null, transactionId: string | null,
  ): Promise<{ ok: false } | { ok: true; booking: DbBooking }> {
    const start = lisbonSlotInstant(hold.date, hold.time);
    const tables = tableIdsForTarget(hold.table_id);
    const { end } = turnWindow(start, hold.party_size);
    const client = await pool.connect();
    let booking: DbBooking;
    try {
      await client.query("BEGIN");
      if (await overlapsBookedWindow(client, hold.date, tables, start, end)) {
        await client.query("ROLLBACK");
        return { ok: false };
      }
      const insert = await client.query(
        `INSERT INTO bookings (reference, status, source, date, time, starts_at, party_size, table_id,
           name, email, phone, manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id)
         VALUES ($1, 'booked', 'online', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                   manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
        [reference, hold.date, hold.time, start, hold.party_size, hold.table_id, name, email, phone ?? null,
          manageToken, hold.deposit_cents, hold.deposit_cents > 0 ? "paid" : "none", paymentId, transactionId, hold.hold_id],
      );
      await client.query(`UPDATE holds SET status = 'confirmed' WHERE hold_id = $1`, [hold.hold_id]);
      await client.query("COMMIT");
      booking = coerceBooking(insert.rows[0]);
    } finally {
      client.release();
    }
    // The hold's claims end with the booking.
    await valkey.releaseWindow(tables, start, hold.party_size).catch(() => undefined);
    return { ok: true, booking };
  }

  // ===== Manage link (capability token) =====

  app.get("/api/manage/:token", async (req, res) => {
    const r = await pool.query(
      `SELECT b.reference, b.status, b.source, b.date, b.time, b.starts_at, b.party_size, b.table_id, b.name,
              b.email, b.phone, b.manage_token, b.deposit_cents, b.deposit_state, b.kb_payment_id,
              b.kb_transaction_id, b.hold_id
       FROM bookings b WHERE b.manage_token = $1`, [req.params.token],
    );
    if (r.rows.length === 0) throw new Handled(errors.notFound());
    const b = coerceBooking(r.rows[0]);
    if (b.status === "cancelled_refunded" || b.status === "cancelled_retained" ||
        b.status === "completed" || b.status === "no_show") {
      throw new Handled(errors.linkExpired());
    }
    const t = now();
    const refund = t.getTime() <= b.starts_at.getTime() - REFUND_CUTOFF_HOURS * 3600_000 && b.deposit_cents > 0;
    res.json({ booking: bookingToApi(b), server_now: t.toISOString(), refund_if_cancelled_now: refund });
  });

  /** Cancel from the manage link. Requires an Idempotency-Key. */
  app.post("/api/manage/:token/cancel", async (req, res) => {
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
    if (key === "" || !/^[\x21-\x7E]{1,64}$/.test(key)) throw new Handled(errors.idempotencyKeyRequired());

    const r = await pool.query(
      `SELECT reference FROM bookings WHERE manage_token = $1`, [req.params.token],
    );
    if (r.rows.length === 0) throw new Handled(errors.notFound());

    const outcome = await idem.run(key, "POST", req.originalUrl, req.body ?? {}, async () => cancelBooking(req.params.token));
    res.status(outcome.status).json(outcome.body);
  });

  async function cancelBooking(manageToken: string): Promise<Outcome> {
    const t = now();
    const client = await pool.connect();
    let booking: DbBooking | null = null;
    let refundOutcome: "refunded" | "kept" | "none" = "none";
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT b.reference, b.status, b.source, b.date, b.time, b.starts_at, b.party_size, b.table_id, b.name,
                b.email, b.phone, b.manage_token, b.deposit_cents, b.deposit_state, b.kb_payment_id,
                b.kb_transaction_id, b.hold_id
         FROM bookings b WHERE b.manage_token = $1 FOR UPDATE`, [manageToken],
      );
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return { status: 404, body: { error: { code: "not_found", message: "We couldn't find that." } }, store: true };
      }
      const b = coerceBooking(r.rows[0]);
      if (b.status === "cancelled_refunded" || b.status === "cancelled_retained" ||
          b.status === "completed" || b.status === "no_show") {
        await client.query("ROLLBACK");
        return { status: 410, body: { error: { code: "link_expired", message: "This booking link no longer works." } }, store: true };
      }
      if (b.status === "seated") {
        await client.query("ROLLBACK");
        throw new Handled(errors.invalidTransition());
      }
      if (t.getTime() >= b.starts_at.getTime()) {
        await client.query("ROLLBACK");
        throw new Handled(errors.slotStarted());
      }

      // 24-hour refund edge, judged at the moment the cancel completes.
      const refunded = t.getTime() <= b.starts_at.getTime() - REFUND_CUTOFF_HOURS * 3600_000;
      const newStatus = refunded ? "cancelled_refunded" : "cancelled_retained";

      // A refunded cancel with a paid deposit asks Kill Bill for the full REFUND first.
      if (refunded && b.deposit_cents > 0 && b.deposit_state === "paid") {
        await client.query("ROLLBACK");
        if (!killbill.isHealthy()) throw new Handled(errors.depositsPaused());
        let ok = false;
        try {
          if (b.kb_payment_id) {
            await killbill.refund(b.kb_payment_id, b.reference, b.deposit_cents);
            ok = true;
          } else {
            ok = false;
          }
        } catch (e) {
          if (e instanceof Error && e.message === "killbill_error") throw new Handled(errors.depositsPaused());
          throw e;
        }
        if (!ok) throw new Handled(errors.paymentFailed());
        // Re-open and write the cancellation with deposit.state refunded.
        await client.query("BEGIN");
        const again = await client.query(
          `UPDATE bookings SET status = $1, deposit_state = $2, cancelled_at = now()
           WHERE reference = $3 AND status = 'booked'
           RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                     manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
          [newStatus, "refunded", b.reference],
        );
        if (again.rows.length === 0) {
          await client.query("ROLLBACK");
          throw new Handled(errors.invalidTransition());
        }
        booking = coerceBooking(again.rows[0]);
        refundOutcome = "refunded";
      } else {
        const newState = refunded ? "refunded" : (b.deposit_state === "paid" ? "retained" : "none");
        const again = await client.query(
          `UPDATE bookings SET status = $1, deposit_state = $2, cancelled_at = now()
           WHERE reference = $3 AND status = 'booked'
           RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                     manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
          [newStatus, newState, b.reference],
        );
        if (again.rows.length === 0) {
          await client.query("ROLLBACK");
          throw new Handled(errors.invalidTransition());
        }
        booking = coerceBooking(again.rows[0]);
        refundOutcome = newState === "refunded" ? "refunded" : newState === "retained" ? "kept" : "none";
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    if (!booking) throw new Handled(errors.invalidTransition());
    const tables = tablesOf(booking);
    await publishEvent(pool, valkey, {
      type: "booking.cancelled", date: booking.date, time: booking.time, table_ids: tables,
      party_size: booking.party_size, reference: booking.reference,
    }).catch(() => undefined);
    if (booking.email) {
      await queueEmail(pool, {
        to_email: booking.email,
        ...cancellationEmail(
          { reference: booking.reference, starts_at: booking.starts_at, deposit_cents: booking.deposit_cents },
          refundOutcome,
        ),
      });
    }
    // The table freed: offer it to the waitlist.
    await offerFreedTable(pool, valkey, killbill, cfg, booking.date, tables, now()).catch(() => undefined);
    return { status: 200, body: { booking: bookingToApi(booking) }, store: true };
  }

  /** Waitlist join. */
  app.post("/api/waitlist", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const date = typeof body.date === "string" ? body.date : "";
    const party = validParty(body.party_size) ? (body.party_size as number) : null;
    const earliest = typeof body.earliest === "string" ? body.earliest : "";
    const latest = typeof body.latest === "string" ? body.latest : "";
    const name = typeof body.name === "string" ? body.name : "";
    const email = typeof body.email === "string" ? body.email : "";
    if (!validDateString(date) || !dateInHorizon(date)) fields.date = "Choose a date from today to 30 days ahead.";
    if (!validParty(party)) fields.party_size = "Choose 1 to 8 guests.";
    if (!isSlotTime(earliest)) fields.earliest = "Choose a time from the list.";
    if (!isSlotTime(latest)) fields.latest = "Choose a time from the list.";
    if (name.trim().length < 1 || name.trim().length > 80) fields.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      fields.email = "Enter an email address like name@example.com.";
    }
    if (isSlotTime(earliest) && isSlotTime(latest) && earliest > latest) {
      fields.latest = "Choose a latest time that isn't earlier than the earliest time.";
    }
    if (Object.keys(fields).length > 0) invalid(fields);
    const partySize = partyOrThrow(party);

    const emailLower = email.trim().toLowerCase();
    const existing = await pool.query(
      `SELECT entry_id, status FROM waitlist_entries
       WHERE email_lower = $1 AND date = $2 AND status IN ('waiting','offered')`, [emailLower, date],
    );
    if (existing.rows.length > 0) {
      const position = await positionOf(pool, existing.rows[0].entry_id, date);
      res.status(200).json({ entry_id: existing.rows[0].entry_id, status: existing.rows[0].status, position });
      return;
    }
    const entryId = token(24);
    try {
      await pool.query(
        `INSERT INTO waitlist_entries (entry_id, email_lower, name, date, party_size, earliest, latest, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting')`,
        [entryId, emailLower, name.trim(), date, partySize, earliest, latest],
      );
    } catch {
      // Simultaneous joins for one email and date create exactly one entry.
      const again = await pool.query(
        `SELECT entry_id, status FROM waitlist_entries
         WHERE email_lower = $1 AND date = $2 AND status IN ('waiting','offered')`, [emailLower, date],
      );
      if (again.rows.length > 0) {
        const position = await positionOf(pool, again.rows[0].entry_id, date);
        res.status(200).json({ entry_id: again.rows[0].entry_id, status: again.rows[0].status, position });
        return;
      }
      throw new Handled(errors.notFound());
    }
    const position = await positionOf(pool, entryId, date);
    res.status(201).json({ entry_id: entryId, status: "waiting", position });
  });

  // ===== Offers =====

  app.get("/api/offers/:token", async (req, res) => {
    const r = await pool.query(
      `SELECT o.offer_id, o.token, o.entry_id, o.table_id, o.date, o.time, o.party_size, o.status,
              o.expires_at, o.deposit_cents, o.reserved_reference
       FROM offers o WHERE o.token = $1`, [req.params.token],
    );
    if (r.rows.length === 0) throw new Handled(errors.notFound());
    const o = r.rows[0];
    if (o.status === "claimed") throw new Handled(errors.offerClaimed());
    if (o.status === "lapsed" || now().getTime() >= new Date(o.expires_at).getTime()) {
      throw new Handled(errors.offerExpired());
    }
    const start = lisbonSlotInstant(o.date, o.time);
    res.json({
      status: "offered", date: o.date, time: o.time, starts_at: isoWithLisbonOffset(start),
      party_size: o.party_size, table_id: o.table_id, room: roomOfTable(o.table_id),
      expires_at: new Date(o.expires_at).toISOString(), server_now: now().toISOString(),
      deposit_cents: o.deposit_cents,
    });
  });

  /** Claim an offer. Requires an Idempotency-Key. */
  app.post("/api/offers/:token/claim", async (req, res) => {
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
    if (key === "" || !/^[\x21-\x7E]{1,64}$/.test(key)) throw new Handled(errors.idempotencyKeyRequired());
    const outcome = await idem.run(key, "POST", req.originalUrl, req.body ?? {}, async () => claimOffer(req.params.token));
    res.status(outcome.status).json(outcome.body);
  });

  async function claimOffer(offerToken: string): Promise<Outcome> {
    const t = now();
    const r = await pool.query(
      `SELECT o.offer_id, o.token, o.entry_id, o.table_id, o.date, o.time, o.party_size, o.status,
              o.expires_at, o.deposit_cents, o.reserved_reference
       FROM offers o WHERE o.token = $1 FOR UPDATE`, [offerToken],
    );
    if (r.rows.length === 0) {
      return { status: 404, body: { error: { code: "not_found", message: "We couldn't find that." } }, store: true };
    }
    const o = r.rows[0];
    if (o.status === "claimed") {
      return { status: 410, body: { error: { code: "offer_claimed", message: "This offer link no longer works." } }, store: true };
    }
    if (o.status === "lapsed" || t.getTime() >= new Date(o.expires_at).getTime()) {
      return { status: 410, body: { error: { code: "offer_expired", message: "This offer has ended." } }, store: true };
    }
    if (!valkey.isHealthy()) throw new Handled(errors.holdsPaused());

    let reference = o.reserved_reference;
    if (!reference) {
      reference = bookingReference();
      await pool.query(`UPDATE offers SET reserved_reference = $1 WHERE offer_id = $2`, [reference, o.offer_id]);
    }

    const start = lisbonSlotInstant(o.date, o.time);
    const tables = tableIdsForTarget(o.table_id);
    const deposit = o.deposit_cents;
    const entry = await pool.query(
      `SELECT entry_id, email_lower, name, date, party_size, earliest, latest, status
       FROM waitlist_entries WHERE entry_id = $1`, [o.entry_id],
    );
    const guestEmail = entry.rows[0]?.email_lower ?? "";
    const guestName = entry.rows[0]?.name ?? "Guest";

    let paymentId: string | null = null;
    let transactionId: string | null = null;
    if (deposit > 0) {
      if (!killbill.isHealthy()) throw new Handled(errors.depositsPaused());
      try {
        const accountId = await killbill.createAccount(guestEmail, guestName);
        const pmId = await killbill.ensurePaymentMethod(accountId);
        const charge = await killbill.purchase(accountId, pmId, reference, deposit);
        paymentId = charge.paymentId;
        transactionId = charge.transactionId;
      } catch (e) {
        if (e instanceof Error && e.message === "payment_failed") throw new Handled(errors.paymentFailed());
        if (e instanceof Error && e.message === "killbill_error") throw new Handled(errors.depositsPaused());
        throw e;
      }
    }

    const manageToken = token(24);
    const client = await pool.connect();
    let booking: DbBooking;
    try {
      await client.query("BEGIN");
      const again = await client.query(
        `SELECT status FROM offers WHERE offer_id = $1 FOR UPDATE`, [o.offer_id],
      );
      if (again.rows[0].status !== "offered") {
        await client.query("ROLLBACK");
        if (paymentId) await killbill.refund(paymentId, reference, deposit).catch(() => undefined);
        return { status: 410, body: { error: { code: "offer_claimed", message: "This offer link no longer works." } }, store: true };
      }
      const insert = await client.query(
        `INSERT INTO bookings (reference, status, source, date, time, starts_at, party_size, table_id,
           name, email, manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id)
         VALUES ($1, 'booked', 'waitlist', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL)
         RETURNING reference, status, source, date, time, starts_at, party_size, table_id, name, email, phone,
                   manage_token, deposit_cents, deposit_state, kb_payment_id, kb_transaction_id, hold_id`,
        [reference, o.date, o.time, start, o.party_size, o.table_id, guestName, guestEmail, manageToken,
          deposit, deposit > 0 ? "paid" : "none", paymentId, transactionId],
      );
      await client.query(`UPDATE offers SET status = 'claimed' WHERE offer_id = $1`, [o.offer_id]);
      await client.query(`UPDATE waitlist_entries SET status = 'claimed' WHERE entry_id = $1`, [o.entry_id]);
      await client.query("COMMIT");
      booking = coerceBooking(insert.rows[0]);
    } finally {
      client.release();
    }
    await valkey.releaseWindow(tables, start, o.party_size).catch(() => undefined);
    await valkey.delOffer(o.offer_id).catch(() => undefined);

    const manageUrl = `${cfg.publicUrl}/manage/${manageToken}`;
    await queueEmail(pool, {
      to_email: guestEmail,
      ...confirmationEmail(
        { reference, starts_at: start, party_size: o.party_size, table_id: o.table_id,
          room: roomOfTable(o.table_id) },
        manageUrl, deposit,
      ),
    });
    await publishEvent(pool, valkey, {
      type: "offer.claimed", date: o.date, time: o.time, table_ids: tables,
      party_size: o.party_size, reference,
    }).catch(() => undefined);
    return { status: 201, body: { booking: bookingToApi(booking), manage_url: manageUrl }, store: true };
  }

  // ===== Controlled clock =====

  app.put("/api/clock", async (req, res) => {
    if (!cfg.clockControl) throw new Handled(errors.notFound());
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = typeof body.now === "string" ? body.now : "";
    const parsed = new Date(raw);
    if (raw === "" || Number.isNaN(parsed.getTime())) {
      invalid({ now: "Send an ISO 8601 instant with an offset or Z." });
    }
    const { setNow } = await import("../clock.js");
    setNow(parsed);
    res.json({ server_now: parsed.toISOString() });
  });
}

/** Position: 1 plus the number of live entries for that date that joined earlier. */
async function positionOf(pool: import("pg").Pool, entryId: string, date: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM waitlist_entries
     WHERE date = $1 AND status IN ('waiting','offered') AND joined_at < (SELECT joined_at FROM waitlist_entries WHERE entry_id = $2)`,
    [date, entryId],
  );
  return 1 + (r.rows[0].n as number);
}

/**
 * The waitlist rule for a freed table: find the earliest waiting entry it fits,
 * claim the window and send the offer email. Shared by cancel, clear, release,
 * expiry, lapse and no-show. At most one live offer per table.
 */
export async function offerFreedTable(
  pool: import("pg").Pool, valkey: import("../valkey.js").Valkey,
  killbill: import("../killbill.js").KillBill, cfg: import("../config.js").Config,
  date: string, freedTables: string[], t: Date,
): Promise<void> {
  void killbill;
  if (!valkey.isHealthy()) {
    // Remember the freed tables so the rule runs within 15 seconds of recovery.
    for (const tableId of freedTables) {
      await pool.query(
        `INSERT INTO pending_freed_tables (table_id, date) VALUES ($1, $2)`,
        [tableId, date],
      ).catch(() => undefined);
    }
    return;
  }
  for (const tableId of freedTables) {
    // A table under a live offer gets no second offer.
    const liveOffer = await pool.query(
      `SELECT 1 FROM offers WHERE table_id = $1 AND date = $2 AND status = 'offered' LIMIT 1`,
      [tableId, date],
    );
    if (liveOffer.rows.length > 0) continue;

    const chosen = await chooseOffer(pool, date, tableId, t);
    if (!chosen) continue;
    // The target the freed table completes: the pair for parties of 7 or 8.
    const targetId = chosen.entry.party_size >= 7 ? pairForTable(tableId) ?? tableId : tableId;
    const start = lisbonSlotInstant(date, chosen.time);
    const tables = tableIdsForTarget(targetId);
    const deposit = depositCentsFor(chosen.entry.party_size, targetId);
    const offerId = token(24);
    const offerToken = token(24);
    const expiresAt = new Date(t.getTime() + cfg.offerSeconds * 1000);
    let claimed: boolean;
    try {
      claimed = await valkey.claimWindow(tables, start, chosen.entry.party_size, offerId, cfg.offerSeconds * 1000);
    } catch {
      await pool.query(`INSERT INTO pending_freed_tables (table_id, date) VALUES ($1, $2)`, [tableId, date]).catch(() => undefined);
      return;
    }
    if (!claimed) continue;
    try {
      await valkey.setOffer(offerId, cfg.offerSeconds * 1000);
    } catch {
      await valkey.releaseWindow(tables, start, chosen.entry.party_size).catch(() => undefined);
      await pool.query(`INSERT INTO pending_freed_tables (table_id, date) VALUES ($1, $2)`, [tableId, date]).catch(() => undefined);
      return;
    }
    await pool.query(
      `INSERT INTO offers (offer_id, token, entry_id, table_id, date, time, party_size, status, expires_at, deposit_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'offered', $8, $9)`,
      [offerId, offerToken, chosen.entry.entry_id, targetId, date, chosen.time, chosen.entry.party_size, expiresAt, deposit],
    );
    await pool.query(`UPDATE waitlist_entries SET status = 'offered' WHERE entry_id = $1`, [chosen.entry.entry_id]);
    const offerUrl = `${cfg.publicUrl}/offer/${offerToken}`;
    await queueEmail(pool, {
      to_email: chosen.entry.email_lower,
      ...offerEmail({
        starts_at: start, table_id: targetId, room: roomOfTable(targetId),
        party_size: chosen.entry.party_size, expires_at: expiresAt, deposit_cents: deposit,
      }, offerUrl),
    });
    await publishEvent(pool, valkey, {
      type: "offer.created", date, time: chosen.time, table_ids: tables,
      party_size: chosen.entry.party_size,
    }).catch(() => undefined);
    break; // one offer per freed table
  }
}

function pairForTable(tableId: string): string | null {
  for (const [pairId, pair] of PAIR_BY_ID) {
    if (pair.tables.includes(tableId)) return pairId;
  }
  return null;
}
