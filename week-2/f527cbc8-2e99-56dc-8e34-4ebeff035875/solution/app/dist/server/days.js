// Barn days: loading and visibility, the role field projection of booking rows, and the one place a barn day
// changes. Every change runs under the day's row lock (brief: One barn day at a time): it first writes any hold
// that has lapsed at its stored instant, runs the waitlist offer pass, does its work, runs the pass again, and
// emits each role's row events with contiguous ids (brief: Bookings, Holds; Waitlist; Live streams).
import { randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { SYSTEM, currentContext, runAs } from "./context.js";
import { db, first, transaction } from "./db.js";
import { MANAGER_VISIBLE_STORED, OWNER_VISIBLE_STORED, dayStatus, takesBookings, } from "./domain/barnDayRules.js";
import { bookingTransition, holdExpiry, lapsedHoldSql, liveBookingSql } from "./domain/bookingRules.js";
import { ownerBlockedSql } from "./domain/dunning.js";
import { priceListOn } from "./domain/prices.js";
import { notFound } from "./errors.js";
import { offerLapsedMail, offerMail } from "./mail/messages.js";
import { queueEmail } from "./mail/outbox.js";
import { authorisePayment, voidDeposit } from "./payments.js";
import { clockSeconds, cutoffAt, stamp, startsAt, zone } from "./practice.js";
import { appendEvent, dayStream } from "./streams.js";
/** Barn days a caller may read: everything for the farrier and apprentice, the rail's days for owners and managers. */
export function dayVisibility(caller, offset = 0) {
    const p = (n) => `$${offset + n}`;
    if (caller.role === "owner") {
        return {
            sql: `d.status = ANY(${p(2)}::text[]) AND d.barn_id IN (SELECT barn_id FROM horses WHERE owner_id = ${p(1)})`,
            params: [caller.id, OWNER_VISIBLE_STORED],
        };
    }
    if (caller.role === "barn_manager")
        return { sql: `d.status = ANY(${p(2)}::text[]) AND d.barn_id = ${p(1)}`, params: [caller.barn_id, MANAGER_VISIBLE_STORED] };
    return { sql: "true", params: [] };
}
/** `where` numbers its own parameters from $1. */
export async function loadDays(client, where, params, at) {
    const { rows } = await client.query(`SELECT d.id, d.barn_id, b.name AS barn_name, d.business_date, d.start_time, d.slot_count, d.slot_minutes, d.trip_fee_cents, d.status
       FROM barn_days d JOIN barns b ON b.id = d.barn_id
      WHERE ${where}
      ORDER BY d.business_date, d.start_time, d.created_at`, params);
    if (!rows.length)
        return [];
    const slots = await client.query(`SELECT s.id, s.barn_day_id, s.time, live.id AS booking_id, live.owner_id
       FROM slots s
       LEFT JOIN LATERAL (SELECT bk.id, bk.owner_id FROM bookings bk WHERE bk.slot_id = s.id AND ${liveBookingSql("bk", "$2")}) live ON true
      WHERE s.barn_day_id = ANY($1)
      ORDER BY s.position`, [rows.map((row) => row.id), new Date(at)]);
    return rows.map(({ status: stored, ...row }) => {
        const own = slots.rows.filter((slot) => slot.barn_day_id === row.id).map(({ id, time, booking_id, owner_id }) => ({ id, time, booking_id, owner_id }));
        const booked = own.filter((slot) => slot.booking_id !== null).length;
        return { ...row, stored, slots: own, booked_count: booked, status: dayStatus(stored, booked, row.slot_count) };
    });
}
export const loadDay = async (client, id, at) => first(await loadDays(client, "d.id = $1", [id], at));
/** A barn day the caller may read, or 404. */
export async function visibleDay(client, caller, id, at) {
    const visibility = dayVisibility(caller, 1);
    const [day] = await loadDays(client, `d.id = $1 AND ${visibility.sql}`, [id, ...visibility.params], at);
    if (!day)
        throw notFound();
    return day;
}
export function dayJson(day, caller) {
    const start = startsAt(day.business_date, day.start_time);
    const manager = caller.role === "barn_manager";
    return {
        id: day.id,
        barn: { id: day.barn_id, name: day.barn_name },
        business_date: day.business_date,
        start_time: day.start_time,
        time_zone: zone(),
        starts_at: stamp(start),
        cancellation_cutoff_at: stamp(cutoffAt(day.business_date, day.start_time)),
        slot_count: day.slot_count,
        slot_minutes: day.slot_minutes,
        booked_count: day.booked_count,
        ...(manager ? {} : { trip_fee_cents: day.trip_fee_cents }),
        status: day.status,
        slots: day.slots.map((slot) => ({
            id: slot.id,
            time: slot.time,
            state: slot.booking_id ? "taken" : "open",
            ...(manager ? {} : { my_booking_id: slot.owner_id === caller.id ? slot.booking_id : null }),
        })),
    };
}
const SHEET_ROLES = ["farrier", "apprentice", "barn_manager"];
const MANAGER_STATUSES = ["confirmed", "worked", "no_show"];
/** Every booking a day sheet can list (held and gone holds never appear), in slot order. */
export async function sheetRows(client, dayId) {
    const { rows } = await client.query(`SELECT bk.id AS booking_id, bk.number, s.time AS slot_time, h.id AS horse_id, h.name AS horse_name, h.stall, bk.status,
            u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone, bk.trip_share_cents,
            v.id AS visit_id, v.status AS visit_status, inv.status AS invoice_status, inv.total_cents AS invoice_total_cents
       FROM bookings bk
       JOIN slots s ON s.id = bk.slot_id
       JOIN horses h ON h.id = bk.horse_id
       JOIN users u ON u.id = bk.owner_id
       LEFT JOIN visits v ON v.booking_id = bk.id
       LEFT JOIN LATERAL (
         SELECT i.status, i.total_cents FROM invoices i
          WHERE (v.id IS NOT NULL AND i.visit_id = v.id)
             OR (i.kind = 'trip' AND i.booking_id = bk.id AND bk.status IN ('cancelled_late', 'no_show'))
          LIMIT 1
       ) inv ON true
      WHERE bk.barn_day_id = $1 AND bk.status IN ('confirmed', 'cancelled_in_time', 'cancelled_late', 'worked', 'no_show', 'excused')
      ORDER BY s.position, bk.number`, [dayId]);
    return rows;
}
/** The booking list's exact field set per role, or null when the row is not in that role's list (brief: API, Barn days). */
export function sheetRowFor(role, row) {
    if (role === "barn_manager") {
        return MANAGER_STATUSES.includes(row.status) ? { slot_time: row.slot_time, horse_name: row.horse_name, stall: row.stall } : null;
    }
    const shared = {
        booking_id: row.booking_id,
        slot_time: row.slot_time,
        horse_id: row.horse_id,
        horse_name: row.horse_name,
        stall: row.stall,
        status: row.status,
        visit_id: row.visit_id,
        visit_status: row.visit_status,
    };
    if (role === "apprentice")
        return shared;
    return {
        ...shared,
        number: row.number,
        owner_name: row.owner_name,
        owner_email: row.owner_email,
        owner_phone: row.owner_phone,
        trip_share_cents: row.trip_share_cents,
        invoice_status: row.invoice_status,
        invoice_total_cents: row.invoice_total_cents,
    };
}
async function observe(client, dayId, at) {
    const [rows, day] = await Promise.all([sheetRows(client, dayId), loadDay(client, dayId, at)]);
    return { rows: new Map(rows.map((row) => [row.booking_id, row])), status: day.status, stored: day.stored };
}
async function emitChanges(client, dayId, before, after) {
    // Row events go out in ascending booking number (brief: Live streams, Excuse events).
    const number = (id) => Number((after.rows.get(id) ?? before.rows.get(id))?.number ?? 0);
    const ids = [...new Set([...before.rows.keys(), ...after.rows.keys()])].sort((a, b) => number(a) - number(b));
    for (const role of SHEET_ROLES) {
        const stream = dayStream(dayId, role);
        for (const id of ids) {
            const old = before.rows.get(id);
            const now_ = after.rows.get(id);
            const was = old ? sheetRowFor(role, old) : null;
            const is = now_ ? sheetRowFor(role, now_) : null;
            if (!was && is)
                await appendEvent(client, stream, "booking_added", is);
            else if (was && !is)
                await appendEvent(client, stream, "booking_removed", was);
            else if (was && is && JSON.stringify(was) !== JSON.stringify(is))
                await appendEvent(client, stream, "booking_moved", is);
        }
        if (before.status !== after.status)
            await appendEvent(client, stream, "day_status", { status: after.status });
    }
}
// ---- Lapse and the offer pass ----
/** Writes holds that lapsed at their stored instant as lapsed, voiding their deposits, as the system. */
async function lapseHolds(client, dayId, at) {
    const { rows } = await client.query(`SELECT id, status, payment_id FROM bookings WHERE barn_day_id = $1 AND ${lapsedHoldSql("bookings", "$2")}`, [dayId, new Date(at)]);
    for (const booking of rows) {
        const next = bookingTransition(booking.status, "lapse");
        await client.query(`UPDATE bookings SET status = $2 WHERE id = $1`, [booking.id, next]);
        await audit(client, { action: "lapse", entityType: "booking", entityId: booking.id, from: booking.status, to: next });
        await voidDeposit(client, booking.payment_id);
    }
}
/** True when the owner holds an invoice in the blocked dunning state (brief: Dunning). */
export async function ownerBlocked(client, ownerId) {
    const { rows } = await client.query(`SELECT ${ownerBlockedSql("$1")} AS blocked`, [ownerId]);
    return rows[0]?.blocked ?? false;
}
/**
 * While a slot is free on a published day before its start, the lowest-position horse whose owner is not blocked
 * gets a timed hold on the earliest open slot, its deposit authorised on the owner's card on file. A declined card
 * removes that entry and moves on (brief: Waitlist, Offer pass).
 */
async function offerPass(client, dayId, at) {
    for (;;) {
        const day = await loadDay(client, dayId, at);
        if (!takesBookings(day.stored, startsAt(day.business_date, day.start_time), at))
            return;
        const slot = day.slots.find((s) => s.booking_id === null);
        if (!slot)
            return;
        const { rows: waiting } = await client.query(`SELECT w.id, w.horse_id, h.name AS horse_name, w.owner_id, u.name AS owner_name, u.email AS owner_email, u.card_token
         FROM waitlist_entries w JOIN horses h ON h.id = w.horse_id JOIN users u ON u.id = w.owner_id
        WHERE w.barn_day_id = $1 AND w.left_at IS NULL
          AND NOT ${ownerBlockedSql("w.owner_id")}
        ORDER BY w.join_seq LIMIT 1`, [dayId]);
        const entry = waiting[0];
        if (!entry)
            return;
        const deposit = (await priceListOn(client, day.business_date)).deposit_cents;
        let paymentId = null;
        if (deposit > 0) {
            const authorised = entry.card_token
                ? await authorisePayment(client, {
                    kind: "deposit",
                    ownerId: entry.owner_id,
                    bookingId: null,
                    invoiceId: null,
                    amountCents: deposit,
                    token: entry.card_token,
                })
                : null;
            if (!authorised?.result.approved) {
                await client.query(`UPDATE waitlist_entries SET left_at = $2, left_reason = 'declined' WHERE id = $1`, [entry.id, new Date(at)]);
                await queueEmail(client, `offer-lapsed:${entry.id}`, offerLapsedMail({ to: entry.owner_email, name: entry.owner_name, horse: entry.horse_name, barn: day.barn_name, date: day.business_date }));
                continue;
            }
            paymentId = authorised.paymentId;
        }
        const bookingId = randomUUID();
        const expires = holdExpiry(at, config.waitlistOfferSeconds);
        await client.query(`INSERT INTO bookings (id, number, barn_day_id, slot_id, horse_id, owner_id, status, hold_expires_at, offer, deposit_cents, payment_id, created_at)
       VALUES ($1, nextval('booking_number_seq'), $2, $3, $4, $5, 'held', $6, true, $7, $8, $9)`, [bookingId, dayId, slot.id, entry.horse_id, entry.owner_id, new Date(expires), deposit, paymentId, new Date(at)]);
        if (paymentId)
            await client.query(`UPDATE payments SET booking_id = $2 WHERE id = $1`, [paymentId, bookingId]);
        await client.query(`UPDATE waitlist_entries SET left_at = $2, left_reason = 'offered' WHERE id = $1`, [entry.id, new Date(at)]);
        await audit(client, { action: "offer", entityType: "booking", entityId: bookingId, from: null, to: "held" });
        await queueEmail(client, `offer:${bookingId}`, offerMail({
            to: entry.owner_email,
            name: entry.owner_name,
            horse: entry.horse_name,
            barn: day.barn_name,
            date: day.business_date,
            slotTime: slot.time,
            holdEnd: `${clockSeconds(expires)} (${zone()})`,
        }));
    }
}
/** Lapses and offers are the system's doing, whichever request or job happens to touch the day first. */
async function settle(client, dayId, at) {
    await runAs({ ...currentContext(), actor: SYSTEM }, async () => {
        await lapseHolds(client, dayId, at);
        await offerPass(client, dayId, at);
    });
}
/**
 * The one way a barn day changes: lock it, settle lapses and offers, run `work`, settle again (a freed slot goes to
 * the waitlist before anyone else), and emit each role's events for what changed.
 */
export async function dayChange(client, dayId, at, work) {
    const locked = await client.query(`SELECT 1 FROM barn_days WHERE id = $1 FOR UPDATE`, [dayId]);
    if (!locked.rowCount)
        throw notFound();
    const before = await observe(client, dayId, at);
    await settle(client, dayId, at);
    const result = await work(await loadDay(client, dayId, at));
    await settle(client, dayId, at);
    await emitChanges(client, dayId, before, await observe(client, dayId, at));
    return result;
}
/** Days among `ids` with a lapse to write or an offer to make, settled before a read answers. */
export async function settleForRead(ids, at) {
    if (!ids.length)
        return;
    const { rows } = await db.query(`SELECT d.id FROM barn_days d
      WHERE d.id = ANY($1) AND (
        EXISTS (SELECT 1 FROM bookings bk WHERE bk.barn_day_id = d.id AND ${lapsedHoldSql("bk", "$2")})
        OR (d.status = 'published'
            AND EXISTS (SELECT 1 FROM waitlist_entries w WHERE w.barn_day_id = d.id AND w.left_at IS NULL)
            AND (SELECT count(*) FROM slots s WHERE s.barn_day_id = d.id)
                > (SELECT count(*) FROM bookings bk WHERE bk.barn_day_id = d.id AND ${liveBookingSql("bk", "$2")})))`, [ids, new Date(at)]);
    for (const row of rows)
        await transaction((client) => dayChange(client, row.id, at, async () => undefined));
}
/** Days the offer job should settle: lapses to write or free slots with people waiting, before the start. */
export async function daysNeedingSettle(at) {
    const { rows } = await db.query(`SELECT d.id FROM barn_days d
      WHERE d.status IN ('published', 'in_progress') AND (
        EXISTS (SELECT 1 FROM bookings bk WHERE bk.barn_day_id = d.id AND ${lapsedHoldSql("bk", "$1")})
        OR EXISTS (SELECT 1 FROM waitlist_entries w WHERE w.barn_day_id = d.id AND w.left_at IS NULL))`, [new Date(at)]);
    return rows.map((row) => row.id);
}
/** `work` under several barn days' serialisation at once, locked in id order, each day emitting its own row events. */
export async function daysChange(client, ids, at, work) {
    const [first_, ...rest] = [...ids].sort();
    if (first_ === undefined)
        return work();
    return dayChange(client, first_, at, () => daysChange(client, rest, at, work));
}
