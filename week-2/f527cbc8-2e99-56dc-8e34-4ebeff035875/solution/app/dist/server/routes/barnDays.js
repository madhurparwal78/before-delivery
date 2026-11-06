// Barn days: the rail, the day sheet's booking list, allocation and waitlist, the live stream, and the day
// transitions, each serialised on the day (brief: API, Barn days; Business rules, Barn day states, Trip-fee split,
// Closing a day).
import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import { advanceInvoice, creatorLease } from "../billing.js";
import { afterCommit } from "../context.js";
import { db, transaction } from "../db.js";
import { dayTransition } from "../domain/barnDayRules.js";
import { bookingTransition } from "../domain/bookingRules.js";
import { tripShares } from "../domain/tripSplit.js";
import { FIELD_COPY, conflict, forbidden, notFound, refuseInvalid } from "../errors.js";
import { json, route } from "../http.js";
import { insertInvoice } from "../invoices.js";
import { bookingCancelledMail } from "../mail/messages.js";
import { queueEmail } from "../mail/outbox.js";
import { applyDeposit, depositToApply, refundDeposit, voidDeposit } from "../payments.js";
import { stamp, today, zone } from "../practice.js";
import { clockPlus, isValidClockTime, isValidDate, wallClockInstant } from "../practiceTime.js";
import { appendEvent, dayStream, serveStream } from "../streams.js";
import { dayChange, dayJson, dayVisibility, loadDay, loadDays, settleForRead, sheetRowFor, sheetRows, visibleDay, } from "../days.js";
import { ALL_ROLES } from "./account.js";
import { inRange, isBlank, objectBody } from "./input.js";
const STAFF = ["farrier", "apprentice"];
/** A visible day, read after any lapse or offer due on it has been written. */
async function freshDay(caller, id, at) {
    await visibleDay(db, caller, id, at);
    await settleForRead([id], at);
    return visibleDay(db, caller, id, at);
}
// ---- Reading ----
route("GET", "/api/barn-days", ALL_ROLES, async ({ caller, now }) => {
    const visibility = dayVisibility(caller);
    const rail = caller.role === "farrier" || caller.role === "apprentice" ? `d.status <> 'cancelled'` : "true";
    const where = `${visibility.sql} AND ${rail}`;
    const ids = (await loadDays(db, where, visibility.params, now)).map((day) => day.id);
    await settleForRead(ids, now);
    return json(200, (await loadDays(db, where, visibility.params, now)).map((day) => dayJson(day, caller)));
});
route("GET", "/api/barn-days/:id", ALL_ROLES, async ({ caller, params, now }) => json(200, dayJson(await freshDay(caller, params.id ?? "", now), caller)));
route("GET", "/api/barn-days/:id/bookings", [...STAFF, "barn_manager"], async ({ caller, params, now }) => {
    const day = await freshDay(caller, params.id ?? "", now);
    const role = caller.role;
    const rows = (await sheetRows(db, day.id)).map((row) => sheetRowFor(role, row)).filter((row) => row !== null);
    return json(200, rows);
});
/** The Allocation body: shares fixed at start in booking order, each with its current share, and every adjustment. */
export async function allocation(client, day) {
    const { rows } = await client.query(`SELECT bk.id AS booking_id, bk.number, h.id AS horse_id, h.name AS horse_name, bk.status,
            bk.initial_share_cents AS initial_cents, bk.trip_share_cents AS share_cents
       FROM bookings bk JOIN horses h ON h.id = bk.horse_id
      WHERE bk.barn_day_id = $1 AND bk.initial_share_cents IS NOT NULL ORDER BY bk.number`, [day.id]);
    const { rows: adjustments } = await client.query(`SELECT a.seq, a.booking_id, bk.number, a.delta_cents, a.cause_booking_id, a.at
       FROM trip_share_adjustments a JOIN bookings bk ON bk.id = a.booking_id
      WHERE a.barn_day_id = $1 ORDER BY a.seq`, [day.id]);
    return {
        barn_day_id: day.id,
        trip_fee_cents: day.trip_fee_cents,
        shares: rows.map((row) => ({
            booking_id: row.booking_id,
            number: Number(row.number),
            horse: { id: row.horse_id, name: row.horse_name },
            status: row.status,
            initial_cents: row.initial_cents,
            share_cents: row.share_cents,
        })),
        adjustments: adjustments.map((a) => ({
            seq: a.seq,
            booking_id: a.booking_id,
            number: Number(a.number),
            delta_cents: a.delta_cents,
            cause_booking_id: a.cause_booking_id,
            at: stamp(a.at),
        })),
    };
}
route("GET", "/api/barn-days/:id/allocation", ["farrier"], async ({ caller, params, now }) => {
    const day = await visibleDay(db, caller, params.id ?? "", now);
    if (day.stored !== "in_progress" && day.stored !== "closed")
        throw conflict("not_started");
    return json(200, await allocation(db, day));
});
/** Waitlist positions are the contiguous integers 1 to n in join order, derived at read time. */
export const WAITLIST_SELECT = `
  SELECT w.id, row_number() OVER (ORDER BY w.join_seq)::int AS position, h.id AS horse_id, h.name AS horse_name, w.joined_at
    FROM waitlist_entries w JOIN horses h ON h.id = w.horse_id
   WHERE w.barn_day_id = $1 AND w.left_at IS NULL`;
route("GET", "/api/barn-days/:id/waitlist", ["farrier"], async ({ caller, params, now }) => {
    const day = await freshDay(caller, params.id ?? "", now);
    const { rows } = await db.query(`${WAITLIST_SELECT} ORDER BY w.join_seq`, [day.id]);
    return json(200, rows.map((row) => ({ id: row.id, position: row.position, horse: { id: row.horse_id, name: row.horse_name }, joined_at: stamp(row.joined_at) })));
});
route("GET", "/api/barn-days/:id/events", [...STAFF, "barn_manager"], async ({ caller, params, now, req, res, requestId }) => {
    const day = await visibleDay(db, caller, params.id ?? "", now);
    if (!caller.sessionHash)
        throw forbidden();
    return serveStream(req, res, dayStream(day.id, caller.role), caller.sessionHash, requestId);
});
/** Unknown barn → 404 before any validation; then every field error at once (422). */
async function barnFee(client, body) {
    if (typeof body.barn_id !== "string" || body.barn_id === "")
        return null;
    const { rows } = await client.query(`SELECT trip_fee_cents FROM barns WHERE id = $1`, [body.barn_id]);
    if (!rows[0])
        throw notFound();
    return rows[0].trip_fee_cents;
}
function dayInput(body, fee, at) {
    const errors = {};
    if (fee === null)
        errors.barn_id = FIELD_COPY.required;
    if (!isValidDate(body.business_date))
        errors.business_date = FIELD_COPY.required;
    else if (body.business_date < today(at))
        errors.business_date = FIELD_COPY.pastDate;
    if (!isValidClockTime(body.start_time))
        errors.start_time = FIELD_COPY.required;
    else if (isValidDate(body.business_date) && wallClockInstant(body.business_date, body.start_time, zone()) === null) {
        errors.start_time = FIELD_COPY.gap(zone());
    }
    if (isBlank(body.slot_count))
        errors.slot_count = FIELD_COPY.required;
    else if (!inRange(body.slot_count, 1, 12))
        errors.slot_count = FIELD_COPY.range(1, 12);
    if (isBlank(body.slot_minutes))
        errors.slot_minutes = FIELD_COPY.required;
    else if (!inRange(body.slot_minutes, 15, 120))
        errors.slot_minutes = FIELD_COPY.range(15, 120);
    if (!isBlank(body.trip_fee_cents) && !inRange(body.trip_fee_cents, 0, 100_000))
        errors.trip_fee_cents = FIELD_COPY.range(0, 100_000);
    refuseInvalid(errors);
    return {
        barn_id: String(body.barn_id),
        business_date: String(body.business_date),
        start_time: String(body.start_time),
        slot_count: Number(body.slot_count),
        slot_minutes: Number(body.slot_minutes),
        trip_fee_cents: isBlank(body.trip_fee_cents) ? (fee ?? 0) : Number(body.trip_fee_cents),
    };
}
async function writeSlots(client, dayId, input) {
    await client.query(`DELETE FROM slots WHERE barn_day_id = $1`, [dayId]);
    for (let position = 0; position < input.slot_count; position += 1) {
        await client.query(`INSERT INTO slots (id, barn_day_id, position, time) VALUES ($1, $2, $3, $4)`, [
            randomUUID(),
            dayId,
            position,
            clockPlus(input.start_time, position * input.slot_minutes),
        ]);
    }
}
route("POST", "/api/barn-days", ["farrier"], async ({ caller, body, now }) => {
    const fields = objectBody(body);
    const input = dayInput(fields, await barnFee(db, fields), now);
    const id = randomUUID();
    const day = await transaction(async (client) => {
        await client.query(`INSERT INTO barn_days (id, barn_id, business_date, start_time, slot_count, slot_minutes, trip_fee_cents, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)`, [id, input.barn_id, input.business_date, input.start_time, input.slot_count, input.slot_minutes, input.trip_fee_cents, new Date(now)]);
        await writeSlots(client, id, input);
        await audit(client, { action: "create", entityType: "barn_day", entityId: id, from: null, to: "draft" });
        return loadDay(client, id, now);
    });
    return json(201, dayJson(day, caller));
});
route("PATCH", "/api/barn-days/:id", ["farrier"], async ({ caller, params, body, now }) => {
    const fields = objectBody(body);
    const day = await transaction(async (client) => {
        await visibleDay(client, caller, params.id ?? "", now);
        const fee = await barnFee(client, fields);
        return dayChange(client, params.id ?? "", now, async (current) => {
            dayTransition(current.status, "edit");
            const input = dayInput(fields, fee, now);
            await client.query(`UPDATE barn_days SET barn_id = $2, business_date = $3, start_time = $4, slot_count = $5, slot_minutes = $6, trip_fee_cents = $7
          WHERE id = $1`, [current.id, input.barn_id, input.business_date, input.start_time, input.slot_count, input.slot_minutes, input.trip_fee_cents]);
            await writeSlots(client, current.id, input);
            await audit(client, { action: "edit", entityType: "barn_day", entityId: current.id, from: "draft", to: "draft" });
            return loadDay(client, current.id, now);
        });
    });
    return json(200, dayJson(day, caller));
});
// ---- Transitions ----
/** Removes a day's open holds and voids their deposits (day start and day cancel). */
async function removeHolds(client, dayId) {
    const { rows } = await client.query(`SELECT id, status, payment_id FROM bookings WHERE barn_day_id = $1 AND status = 'held'`, [dayId]);
    for (const hold of rows) {
        const next = bookingTransition(hold.status, "remove");
        await client.query(`UPDATE bookings SET status = $2 WHERE id = $1`, [hold.id, next]);
        await audit(client, { action: "remove", entityType: "booking", entityId: hold.id, from: hold.status, to: next });
        await voidDeposit(client, hold.payment_id);
    }
}
/** Fixes the counting horses (confirmed or cancelled late at this moment) and stores each one's share once. */
async function startDay(client, day) {
    await removeHolds(client, day.id);
    const { rows } = await client.query(`SELECT id FROM bookings WHERE barn_day_id = $1 AND status IN ('confirmed', 'cancelled_late') ORDER BY number`, [day.id]);
    const shares = tripShares(day.trip_fee_cents, rows.length);
    for (const [index, booking] of rows.entries()) {
        await client.query(`UPDATE bookings SET trip_share_cents = $2, initial_share_cents = $2 WHERE id = $1`, [booking.id, shares[index]]);
    }
}
/** One trip-only invoice per late-cancelled or no-show horse with a share, its kept deposit credited up to the share. */
async function tripInvoices(client, day, at) {
    const open = await client.query(`SELECT 1 FROM bookings bk LEFT JOIN visits v ON v.booking_id = bk.id
      WHERE bk.barn_day_id = $1 AND (bk.status = 'confirmed' OR v.status = 'open') LIMIT 1`, [day.id]);
    if (open.rowCount)
        throw conflict("unresolved_bookings");
    const { rows } = await client.query(`SELECT bk.id, bk.horse_id, bk.owner_id, h.name AS horse, bk.status, bk.trip_share_cents AS share, bk.payment_id
       FROM bookings bk JOIN horses h ON h.id = bk.horse_id
      WHERE bk.barn_day_id = $1 AND bk.status IN ('cancelled_late', 'no_show') AND bk.trip_share_cents > 0
      ORDER BY bk.number`, [day.id]);
    const ids = [];
    for (const row of rows) {
        const why = row.status === "no_show" ? "no-show" : "cancelled late";
        const credit = Math.min(await depositToApply(client, row.payment_id), row.share);
        const items = [{ description: `Trip share — ${day.barn_name} ${day.business_date} (${row.horse}, ${why})`, amount_cents: row.share }];
        if (credit > 0)
            items.push({ description: `Deposit credit — ${row.horse} ${day.business_date}`, amount_cents: -credit });
        const id = await insertInvoice(client, {
            kind: "trip",
            horseId: row.horse_id,
            ownerId: row.owner_id,
            visitId: null,
            bookingId: row.id,
            barnDayId: day.id,
            businessDate: day.business_date,
            items,
            creditCents: credit,
            depositPaymentId: credit > 0 ? row.payment_id : null,
            nextAttemptAt: creatorLease(at),
        });
        if (credit > 0 && row.payment_id)
            await applyDeposit(client, row.payment_id, credit, "trip");
        ids.push(id);
    }
    return ids;
}
/** Day cancelled: holds removed, confirmed bookings cancelled in time, every captured deposit on the day refunded. */
async function cancelDay(client, day, at) {
    await removeHolds(client, day.id);
    const { rows } = await client.query(`SELECT bk.id, bk.status, bk.payment_id, h.name AS horse, u.name AS owner_name, u.email AS owner_email
       FROM bookings bk JOIN horses h ON h.id = bk.horse_id JOIN users u ON u.id = bk.owner_id
      WHERE bk.barn_day_id = $1 AND bk.status IN ('confirmed', 'cancelled_late')`, [day.id]);
    for (const booking of rows) {
        const captured = await depositToApply(client, booking.payment_id);
        await refundDeposit(client, booking.payment_id, at);
        if (booking.status !== "confirmed")
            continue;
        const next = bookingTransition(booking.status, "cancel");
        await client.query(`UPDATE bookings SET status = $2, decided_at = $3 WHERE id = $1`, [booking.id, next, new Date(at)]);
        await audit(client, { action: "cancel", entityType: "booking", entityId: booking.id, from: booking.status, to: next });
        await queueEmail(client, `booking-cancelled:${booking.id}`, bookingCancelledMail({
            to: booking.owner_email,
            name: booking.owner_name,
            horse: booking.horse,
            barn: day.barn_name,
            date: day.business_date,
            tripShareApplies: false,
            capturedCents: captured,
        }));
    }
}
async function transition(ctx, action) {
    const id = ctx.params.id ?? "";
    return transaction(async (client) => {
        await visibleDay(client, ctx.caller, id, ctx.now);
        return dayChange(client, id, ctx.now, async (day) => {
            const next = dayTransition(day.status, action);
            if (action === "publish" && day.business_date < today(ctx.now))
                throw conflict("date_passed");
            if (action === "start" && day.business_date > today(ctx.now))
                throw conflict("too_early");
            if (action === "start")
                await startDay(client, day);
            if (action === "close") {
                for (const invoiceId of await tripInvoices(client, day, ctx.now))
                    afterCommit(() => advanceInvoice(invoiceId, true));
            }
            if (action === "cancel")
                await cancelDay(client, day, ctx.now);
            await client.query(`UPDATE barn_days SET status = $2 WHERE id = $1`, [day.id, next]);
            await audit(client, { action, entityType: "barn_day", entityId: day.id, from: day.status, to: next });
            const updated = await loadDay(client, day.id, ctx.now);
            if (action === "start")
                await appendEvent(client, dayStream(day.id, "farrier"), "allocation_fixed", await allocation(client, updated));
            return updated;
        });
    });
}
for (const action of ["publish", "start", "close", "cancel"]) {
    route("POST", `/api/barn-days/:id/${action}`, ["farrier"], async (ctx) => json(200, dayJson(await transition(ctx, action), ctx.caller)));
}
