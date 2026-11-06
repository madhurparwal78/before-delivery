// Holds, confirmations, releases, cancellations, the waitlist, visits opened and no-shows, each serialised on the
// barn day (brief: API, Bookings; Business rules, Bookings, Waitlist, Deposits).
import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import type { Caller } from "../auth.js";
import { config } from "../config.js";
import { type Queryable, db, first, transaction } from "../db.js";
import {
  type StoredBookingStatus,
  bookingTransition,
  holdExpiry,
  isGoneHold,
  isLateCancellation,
  lapsedHoldSql,
  liveBookingSql,
} from "../domain/bookingRules.js";
import { takesBookings } from "../domain/barnDayRules.js";
import { type CountingShare, excuseShares } from "../domain/tripSplit.js";
import { cardTokenError } from "../domain/gateway.js";
import { priceListOn } from "../domain/prices.js";
import { ApiError, FIELD_COPY, conflict, notFound, validation } from "../errors.js";
import { json, route } from "../http.js";
import { bookingCancelledMail, bookingConfirmedMail, excusedMail } from "../mail/messages.js";
import { queueEmail } from "../mail/outbox.js";
import {
  authorisePayment,
  captureDeposit,
  depositToApply,
  forfeitDeposit,
  refundDeposit,
  setCardOnFile,
  voidDeposit,
} from "../payments.js";
import { cutoffAt, startsAt, stamp, stampOrNull, wallClock } from "../practice.js";
import { type DayRecord, dayChange, loadDay, ownerBlocked, visibleDay } from "../days.js";
import { appendEvent, dayStream } from "../streams.js";
import { visibleVisit, visitJson } from "../views.js";
import { WAITLIST_SELECT, allocation } from "./barnDays.js";
import { objectBody } from "./input.js";

// ---- Bookings as the API prints them ----

interface BookingRecord {
  id: string;
  number: number;
  status: StoredBookingStatus;
  barn_day_id: string;
  slot_id: string;
  slot_time: string;
  horse_id: string;
  horse_name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  hold_expires_at: Date | null;
  trip_share_cents: number | null;
  offer: boolean;
  deposit_cents: number;
  payment_id: string | null;
  barn_name: string;
  business_date: string;
  start_time: string;
}

const BOOKING_SELECT = `
  SELECT bk.id, bk.number, bk.status, bk.barn_day_id, bk.slot_id, s.time AS slot_time, bk.horse_id, h.name AS horse_name,
         bk.owner_id, u.name AS owner_name, u.email AS owner_email, bk.hold_expires_at, bk.trip_share_cents, bk.offer,
         bk.deposit_cents, bk.payment_id, b.name AS barn_name, d.business_date, d.start_time
    FROM bookings bk JOIN slots s ON s.id = bk.slot_id JOIN horses h ON h.id = bk.horse_id JOIN users u ON u.id = bk.owner_id
    JOIN barn_days d ON d.id = bk.barn_day_id JOIN barns b ON b.id = d.barn_id`;

function bookingJson(booking: BookingRecord): Record<string, unknown> {
  return {
    id: booking.id,
    number: booking.number,
    status: booking.status,
    barn_day_id: booking.barn_day_id,
    slot_id: booking.slot_id,
    slot_time: booking.slot_time,
    horse: { id: booking.horse_id, name: booking.horse_name },
    hold_expires_at: booking.status === "held" ? stampOrNull(booking.hold_expires_at) : null,
    trip_share_cents: booking.trip_share_cents,
    offer: booking.offer,
    deposit_cents: booking.deposit_cents,
    payment_id: booking.payment_id,
  };
}

const readBooking = async (client: Queryable, id: string): Promise<BookingRecord> =>
  first((await client.query<BookingRecord>(`${BOOKING_SELECT} WHERE bk.id = $1`, [id])).rows);

/** A booking the caller may name: an owner's own, or any for the farrier; unknown ids answer 404. */
async function findBooking(caller: Caller, id: string): Promise<BookingRecord> {
  const { rows } = await db.query<BookingRecord>(
    `${BOOKING_SELECT} WHERE bk.id = $1 ${caller.role === "owner" ? "AND bk.owner_id = $2" : ""}`,
    caller.role === "owner" ? [id, caller.id] : [id],
  );
  const booking = rows[0];
  if (!booking) throw notFound();
  return booking;
}

// ---- Holds ----

interface OwnHorse {
  id: string;
  name: string;
  barn_id: string;
}

async function ownHorse(client: Queryable, caller: Caller, horseId: unknown): Promise<OwnHorse | null> {
  if (typeof horseId !== "string" || horseId === "") return null;
  const { rows } = await client.query<OwnHorse>(`SELECT id, name, barn_id FROM horses WHERE id = $1 AND owner_id = $2`, [horseId, caller.id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

const liveOnDay = async (client: Queryable, dayId: string, horseId: string, at: number): Promise<boolean> =>
  Boolean(
    (await client.query(`SELECT 1 FROM bookings bk WHERE bk.barn_day_id = $1 AND bk.horse_id = $2 AND ${liveBookingSql("bk", "$3")}`, [dayId, horseId, new Date(at)]))
      .rowCount,
  );

/** The 422 for a horse kept elsewhere or a bad card token; a card is needed only when a deposit is due. */
function holdFieldErrors(day: DayRecord, horse: OwnHorse | null, token: unknown, deposit: number): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!horse) errors.horse_id = FIELD_COPY.required;
  else if (horse.barn_id !== day.barn_id) errors.horse_id = `${horse.name} is not kept at ${day.barn_name}.`;
  const cardProblem = deposit > 0 || token !== undefined ? cardTokenError(token) : null;
  if (cardProblem) errors.card_token = cardProblem;
  return errors;
}

type HoldOutcome = { booking: BookingRecord } | { declined: string };

route(
  "POST",
  "/api/barn-days/:id/bookings",
  ["owner"],
  async ({ caller, params, body, now }) => {
    const fields = objectBody(body);
    const outcome = await transaction<HoldOutcome>(async (client) => {
      const visible = await visibleDay(client, caller, params.id ?? "", now);
      if (typeof fields.slot_id === "string" && fields.slot_id !== "" && !visible.slots.some((s) => s.id === fields.slot_id)) throw notFound();
      const horse = await ownHorse(client, caller, fields.horse_id);
      return dayChange(client, visible.id, now, async (day): Promise<HoldOutcome> => {
        if (await ownerBlocked(client, caller.id)) throw conflict("account_blocked");
        if (horse && (await liveOnDay(client, day.id, horse.id, now))) throw conflict("horse_already_booked");
        if (!takesBookings(day.stored, startsAt(day.business_date, day.start_time), now)) {
          throw conflict(day.status === "full" ? "day_full" : "not_open_for_booking");
        }
        if (day.status === "full") throw conflict("day_full");
        const slot = day.slots.find((s) => s.id === fields.slot_id);
        if (slot?.booking_id) throw conflict("slot_taken");
        const deposit = (await priceListOn(client, day.business_date)).deposit_cents;
        const errors = holdFieldErrors(day, horse, fields.card_token, deposit);
        if (!slot) errors.slot_id = FIELD_COPY.required;
        if (!slot || !horse || Object.keys(errors).length) throw validation(errors);
        const token = typeof fields.card_token === "string" ? fields.card_token : null;
        if (token) await setCardOnFile(client, caller.id, token);
        let paymentId: string | null = null;
        if (deposit > 0 && token) {
          const authorised = await authorisePayment(client, {
            kind: "deposit",
            ownerId: caller.id,
            bookingId: null,
            invoiceId: null,
            amountCents: deposit,
            token,
          });
          if (!authorised.result.approved) return { declined: authorised.result.declineCode };
          paymentId = authorised.paymentId;
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO bookings (id, number, barn_day_id, slot_id, horse_id, owner_id, status, hold_expires_at, deposit_cents, payment_id, created_at)
           VALUES ($1, nextval('booking_number_seq'), $2, $3, $4, $5, 'held', $6, $7, $8, $9)`,
          [id, day.id, slot.id, horse.id, caller.id, new Date(holdExpiry(now, config.holdSeconds)), deposit, paymentId, new Date(now)],
        );
        if (paymentId) await client.query(`UPDATE payments SET booking_id = $2 WHERE id = $1`, [paymentId, id]);
        await client.query(`UPDATE waitlist_entries SET left_at = $3, left_reason = 'booked' WHERE barn_day_id = $1 AND horse_id = $2 AND left_at IS NULL`, [
          day.id,
          horse.id,
          new Date(now),
        ]);
        await audit(client, { action: "hold", entityType: "booking", entityId: id, from: null, to: "held" });
        return { booking: await readBooking(client, id) };
      });
    });
    if ("declined" in outcome) throw new ApiError(402, "card_declined", { decline_code: outcome.declined });
    return json(201, bookingJson(outcome.booking));
  },
  { allowance: "hold" },
);

route(
  "POST",
  "/api/barn-days/:id/waitlist",
  ["owner"],
  async ({ caller, params, body, now }) => {
    const fields = objectBody(body);
    const entry = await transaction(async (client) => {
      const visible = await visibleDay(client, caller, params.id ?? "", now);
      const horse = await ownHorse(client, caller, fields.horse_id);
      return dayChange(client, visible.id, now, async (day) => {
        if (await ownerBlocked(client, caller.id)) throw conflict("account_blocked");
        if (horse && (await liveOnDay(client, day.id, horse.id, now))) throw conflict("horse_already_booked");
        if (horse) {
          const waiting = await client.query(`SELECT 1 FROM waitlist_entries WHERE barn_day_id = $1 AND horse_id = $2 AND left_at IS NULL`, [day.id, horse.id]);
          if (waiting.rowCount) throw conflict("already_on_waitlist");
        }
        if (day.status !== "full") throw conflict("day_not_full");
        const deposit = (await priceListOn(client, day.business_date)).deposit_cents;
        const errors = holdFieldErrors(day, horse, fields.card_token, deposit);
        if (!horse || Object.keys(errors).length) throw validation(errors);
        if (typeof fields.card_token === "string") await setCardOnFile(client, caller.id, fields.card_token);
        const id = randomUUID();
        await client.query(`INSERT INTO waitlist_entries (id, barn_day_id, horse_id, owner_id, joined_at) VALUES ($1, $2, $3, $4, $5)`, [
          id,
          day.id,
          horse.id,
          caller.id,
          new Date(now),
        ]);
        const { rows } = await client.query<{ position: number }>(`SELECT position FROM (${WAITLIST_SELECT}) q WHERE q.id = $2`, [day.id, id]);
        return { id, position: rows[0]?.position ?? 0, horse: { id: horse.id, name: horse.name } };
      });
    });
    return json(201, entry);
  },
);

// ---- Confirm, release, cancel ----

/** Settles the booking's day, then reads the booking as the day now stands. */
async function onDay<T>(
  caller: Caller,
  id: string,
  at: number,
  work: (client: Queryable, booking: BookingRecord, day: DayRecord) => Promise<T>,
): Promise<T> {
  const found = await findBooking(caller, id);
  return transaction((client) => dayChange(client, found.barn_day_id, at, async (day) => work(client, await readBooking(client, id), day)));
}

route(
  "POST",
  "/api/bookings/:id/confirm",
  ["owner"],
  async ({ caller, params, now }) => {
    const booking = await onDay(caller, params.id ?? "", now, async (client, current) => {
      if (current.status === "lapsed" || current.status === "removed") throw conflict("hold_expired");
      if (isGoneHold(current.status)) throw notFound();
      if (current.status === "confirmed") return current;
      bookingTransition(current.status, "confirm");
      await client.query(`UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1`, [current.id]);
      await audit(client, { action: "confirm", entityType: "booking", entityId: current.id, from: "held", to: "confirmed" });
      await captureDeposit(client, current.payment_id);
      await queueEmail(
        client,
        `booking-confirmed:${current.id}`,
        bookingConfirmedMail({
          to: current.owner_email,
          name: current.owner_name,
          horse: current.horse_name,
          barn: current.barn_name,
          date: current.business_date,
          slotTime: current.slot_time,
          cutoff: wallClock(cutoffAt(current.business_date, current.start_time)),
          depositCents: current.deposit_cents,
        }),
      );
      return readBooking(client, current.id);
    });
    return json(200, bookingJson(booking));
  },
  { allowance: "hold" },
);

route("DELETE", "/api/bookings/:id", ["owner"], async ({ caller, params, now }) => {
  await onDay(caller, params.id ?? "", now, async (client, current) => {
    if (isGoneHold(current.status)) throw notFound();
    bookingTransition(current.status, "release");
    await client.query(`UPDATE bookings SET status = 'released' WHERE id = $1`, [current.id]);
    await audit(client, { action: "release", entityType: "booking", entityId: current.id, from: "held", to: "released" });
    await voidDeposit(client, current.payment_id);
  });
  return { status: 204 };
});

route("GET", "/api/bookings/:id/cancellation-preview", ["owner", "farrier"], async ({ caller, params, now }) => {
  const booking = await findBooking(caller, params.id ?? "");
  if (isGoneHold(booking.status)) throw notFound();
  const cutoff = cutoffAt(booking.business_date, booking.start_time);
  const late = isLateCancellation(now, cutoff);
  const deposit = await depositToApply(db, booking.payment_id);
  return json(200, { late, cutoff_at: stamp(cutoff), deposit_cents: deposit, deposit_outcome: depositOutcome(deposit, late) });
});

type DepositOutcome = "refund" | "keep" | "none";

/** What a cancellation at instant `at` does to the captured deposit (brief: Deposits; Cancel dialog body). */
const depositOutcome = (capturedCents: number, late: boolean): DepositOutcome => (capturedCents === 0 ? "none" : late ? "keep" : "refund");

route("POST", "/api/bookings/:id/cancel", ["owner", "farrier"], async ({ caller, params, now }) => {
  const result = await onDay(caller, params.id ?? "", now, async (client, current, day) => {
    if (isGoneHold(current.status)) throw notFound();
    // One stored decision instant settles the verdict, the deposit, the refunded amount and the refund's ledger instant.
    const decidedAt = now;
    const late = isLateCancellation(decidedAt, cutoffAt(current.business_date, current.start_time));
    const next = bookingTransition(current.status, "cancel", late);
    if (day.stored !== "published") throw conflict("day_started");
    const captured = await depositToApply(client, current.payment_id);
    await client.query(`UPDATE bookings SET status = $2, decided_at = $3 WHERE id = $1`, [current.id, next, new Date(decidedAt)]);
    await audit(client, { action: "cancel", entityType: "booking", entityId: current.id, from: current.status, to: next });
    if (late) await forfeitDeposit(client, current.payment_id);
    else await refundDeposit(client, current.payment_id, decidedAt);
    await queueEmail(
      client,
      `booking-cancelled:${current.id}`,
      bookingCancelledMail({
        to: current.owner_email,
        name: current.owner_name,
        horse: current.horse_name,
        barn: current.barn_name,
        date: current.business_date,
        tripShareApplies: late,
        capturedCents: captured,
      }),
    );
    const outcome = depositOutcome(captured, late);
    return { booking: await readBooking(client, current.id), late, decidedAt, outcome, refunded: outcome === "refund" ? captured : 0 };
  });
  return json(200, {
    booking: bookingJson(result.booking),
    trip_share_applies: result.late,
    decided_at: stamp(result.decidedAt),
    deposit_outcome: result.outcome,
    refunded_cents: result.refunded,
  });
});

interface CountingRow {
  id: string;
  number: string;
  share: number;
  billed: boolean;
}

/**
 * Excusing a horse: it leaves the trip split, its share moves onto the counting horses not yet billed by the pool
 * rule as appended adjustments, its captured deposit is refunded and its owner told (brief: Excusing a horse).
 */
route("POST", "/api/bookings/:id/excuse", ["farrier"], async ({ caller, params, body, now }) => {
  objectBody(body);
  const found = await findBooking(caller, params.id ?? "");
  const result = await transaction(async (client) => {
    const changed = await dayChange(client, found.barn_day_id, now, async (day) => {
      const current = await readBooking(client, found.id);
      if (isGoneHold(current.status)) throw notFound();
      const next = bookingTransition(current.status, "excuse");
      if (day.stored !== "in_progress") throw conflict("day_not_in_progress");
      const { rows: counting } = await client.query<CountingRow>(
        `SELECT bk.id, bk.number, bk.trip_share_cents AS share,
                EXISTS (SELECT 1 FROM visits v WHERE v.booking_id = bk.id AND v.status <> 'open') AS billed
           FROM bookings bk
          WHERE bk.barn_day_id = $1 AND bk.initial_share_cents IS NOT NULL AND bk.status <> 'excused'
          ORDER BY bk.number`,
        [day.id],
      );
      const share = (row: CountingRow): CountingShare => ({ bookingId: row.id, shareCents: row.share, billed: row.billed });
      const excused: CountingShare = { bookingId: current.id, shareCents: current.trip_share_cents ?? 0, billed: false };
      const shares = excuseShares(day.trip_fee_cents, counting.filter((row) => row.id !== current.id).map(share), excused);
      if (!shares) throw conflict("no_share_recipient");
      const captured = await depositToApply(client, current.payment_id);
      await client.query(`UPDATE bookings SET status = $2 WHERE id = $1`, [current.id, next]);
      await audit(client, { action: "excuse", entityType: "booking", entityId: current.id, from: current.status, to: next });
      await refundDeposit(client, current.payment_id, now);
      const moved = counting.filter((row) => (shares.get(row.id) ?? row.share) !== row.share);
      const { rows: last } = await client.query<{ seq: number }>(
        `SELECT coalesce(max(seq), 0)::int AS seq FROM trip_share_adjustments WHERE barn_day_id = $1`,
        [day.id],
      );
      let seq = last[0]?.seq ?? 0;
      for (const row of moved) {
        const share_ = shares.get(row.id) ?? row.share;
        seq += 1;
        await client.query(
          `INSERT INTO trip_share_adjustments (barn_day_id, seq, booking_id, delta_cents, cause_booking_id, at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [day.id, seq, row.id, share_ - row.share, current.id, new Date(now)],
        );
        await client.query(`UPDATE bookings SET trip_share_cents = $2 WHERE id = $1`, [row.id, share_]);
      }
      await queueEmail(
        client,
        `booking-excused:${current.id}`,
        excusedMail({
          to: current.owner_email,
          name: current.owner_name,
          horse: current.horse_name,
          barn: current.barn_name,
          date: current.business_date,
          capturedCents: captured,
        }),
      );
      return moved.length;
    });
    const day = await loadDay(client, found.barn_day_id, now);
    const body_ = await allocation(client, day);
    if (changed > 0) await appendEvent(client, dayStream(day.id, "farrier"), "allocation_adjusted", body_);
    return { booking: await readBooking(client, found.id), allocation: body_ };
  });
  return json(200, { booking: bookingJson(result.booking), allocation: result.allocation });
});

route("GET", "/api/my/bookings", ["owner"], async ({ caller, now }) => {
  const { rows } = await db.query<BookingRecord>(
    `${BOOKING_SELECT} WHERE bk.owner_id = $1 AND bk.status NOT IN ('released', 'lapsed', 'removed')
       AND NOT ${lapsedHoldSql("bk", "$2")} ORDER BY d.business_date, s.position`,
    [caller.id, new Date(now)],
  );
  return json(200, rows.map(bookingJson));
});

// ---- Working the day (farrier) ----

route("POST", "/api/bookings/:id/visit", ["farrier"], async ({ caller, params, now }) => {
  const visit = await onDay(caller, params.id ?? "", now, async (client, current, day) => {
    if (isGoneHold(current.status)) throw notFound();
    bookingTransition(current.status, "open_visit");
    if (day.stored !== "in_progress") throw conflict("day_not_in_progress");
    const id = randomUUID();
    await client.query(`INSERT INTO visits (id, booking_id, horse_id, business_date, status, created_at) VALUES ($1, $2, $3, $4, 'open', $5)`, [
      id,
      current.id,
      current.horse_id,
      current.business_date,
      new Date(now),
    ]);
    await client.query(`UPDATE bookings SET status = 'worked' WHERE id = $1`, [current.id]);
    await audit(client, { action: "open_visit", entityType: "booking", entityId: current.id, from: "confirmed", to: "worked" });
    await audit(client, { action: "open", entityType: "visit", entityId: id, from: null, to: "open" });
    return id;
  });
  return json(201, await visitJson(db, await visibleVisit(db, caller, visit), caller, now));
});

route("POST", "/api/bookings/:id/no-show", ["farrier"], async ({ caller, params, now }) => {
  const booking = await onDay(caller, params.id ?? "", now, async (client, current, day) => {
    if (isGoneHold(current.status)) throw notFound();
    bookingTransition(current.status, "no_show");
    if (day.stored !== "in_progress") throw conflict("day_not_in_progress");
    await client.query(`UPDATE bookings SET status = 'no_show' WHERE id = $1`, [current.id]);
    await audit(client, { action: "no_show", entityType: "booking", entityId: current.id, from: "confirmed", to: "no_show" });
    await forfeitDeposit(client, current.payment_id);
    return readBooking(client, current.id);
  });
  return json(200, bookingJson(booking));
});
