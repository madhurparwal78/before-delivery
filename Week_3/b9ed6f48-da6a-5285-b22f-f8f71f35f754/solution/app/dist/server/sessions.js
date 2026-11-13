// Guided sessions and bookings (brief: Business rules › Session status, Seat allocation).
// Seats are held as a pending booking under the session row lock before charging, so
// simultaneous bookings for the last seats have one winner on any number of instances.
import { randomBytes, randomUUID } from "node:crypto";
import { one, pool, rows, tx } from "./db.js";
import { fail } from "./http.js";
import { assertBillingReachable, chargeInvoice, payInvoice } from "./killbill.js";
import { assertStorageReachable } from "./storage.js";
import { catalogVersions, ticketPriceAt } from "./catalog.js";
import { deliverNow } from "./mail.js";
import { accountCurrency, chargeApproved, currencyLocked, declined, ensureAccount, newOrderId, nextReceiptNumber, orderById, orderJson, outcomeClass, recordOrder, settledAt, storeReceipt, } from "./payments.js";
import { COPY } from "../shared/copy.js";
import { formatLisbonDateTime, toLisbonIso } from "../shared/lisbon.js";
import { isCurrency, minorToMajor } from "../shared/money.js";
import { cardDigits } from "../shared/cards.js";
const BOOKING_CLOSES_BEFORE_MS = 30 * 60_000;
const MAX_SEATS = 4;
/** Status by the server clock: on sale until 30 minutes before the start (the one booking window rule). */
export function sessionStatus(s, now) {
    const starts = s.starts_at.getTime();
    if (s.cancelled_at)
        return "cancelled";
    if (now >= starts + s.duration_minutes * 60_000)
        return "held";
    if (now >= starts - BOOKING_CLOSES_BEFORE_MS)
        return "closed";
    return "on_sale";
}
/** Capacity minus the seats of live and held bookings, computed from the rows every time. */
const seatsLeft = (s) => s.capacity - s.seats_taken;
const SESSION_SELECT = `SELECT s.*, COALESCE((SELECT SUM(b.seats) FROM bookings b WHERE b.session_id = s.id AND b.state IN ('pending', 'live')), 0)::int AS seats_taken FROM guided_sessions s`;
export async function sessionById(db, id, lock = false) {
    if (lock)
        await db.query("SELECT id FROM guided_sessions WHERE id = $1 FOR UPDATE", [id]);
    return one(db, `${SESSION_SELECT} WHERE s.id = $1`, [id]);
}
export function sessionJson(s, now, price) {
    const starts = s.starts_at.getTime();
    return {
        id: s.id,
        title: s.title,
        starts_at: toLisbonIso(starts),
        starts_at_display: formatLisbonDateTime(starts),
        duration_minutes: s.duration_minutes,
        capacity: s.capacity,
        seats_left: seatsLeft(s),
        status: sessionStatus(s, now),
        booking_closes_at: toLisbonIso(starts - BOOKING_CLOSES_BEFORE_MS),
        ...(price ? { price_minor: price.minor, currency: price.currency } : {}),
    };
}
export async function listSessions() {
    return rows(pool, `${SESSION_SELECT} ORDER BY s.starts_at, s.id`);
}
function ticketCode() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return `T-${[...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}
/** 409s judged against the session at commit, then 422s, then reachability; holds the seats. */
async function holdSeats(payer, sessionId, input) {
    return tx(async (db) => {
        const session = await sessionById(db, sessionId, true);
        if (!session)
            throw fail.notFound();
        if (session.cancelling || sessionStatus(session, Date.now()) !== "on_sale")
            throw fail.conflict("booking_closed", COPY.bookingClosed);
        const seats = input.seats;
        const seatsValid = typeof seats === "number" && Number.isInteger(seats) && seats >= 1 && seats <= MAX_SEATS;
        const locked = await accountCurrency(payer.id);
        if (locked && isCurrency(input.currency) && input.currency !== locked)
            throw currencyLocked(locked);
        if (seatsValid && seats > seatsLeft(session))
            throw fail.conflict("sold_out", COPY.soldOut);
        const fields = {};
        if (!seatsValid)
            fields.seats = COPY.seatsField;
        if (!isCurrency(input.currency))
            fields.currency = "Choose EUR, GBP, USD or JPY.";
        const digits = typeof input.card_number === "string" ? cardDigits(input.card_number) : null;
        if (!digits)
            fields.card_number = COPY.cardField;
        if (Object.keys(fields).length)
            throw fail.validation(fields);
        await assertStorageReachable().catch(() => {
            throw fail.storage(COPY.storagePurchase);
        });
        await assertBillingReachable().catch(() => {
            throw fail.billing();
        });
        const bookingId = randomUUID();
        await db.query("INSERT INTO bookings (id, session_id, user_id, seats, state) VALUES ($1, $2, $3, $4, 'pending')", [bookingId, sessionId, payer.id, seats]);
        return { bookingId, session, seats: seats, currency: input.currency, digits: digits };
    });
}
export async function bookSeats(payer, sessionId, input) {
    const hold = await holdSeats(payer, sessionId, input);
    try {
        const accountId = await ensureAccount(payer, hold.currency);
        if (!(await chargeApproved(payer.id, outcomeClass(hold.digits))))
            throw declined();
        const amountMinor = ticketPriceAt(await catalogVersions(), hold.currency, Date.now()) * hold.seats;
        const orderId = newOrderId();
        const description = `Guided session: ${hold.session.title} × ${hold.seats}`;
        const invoiceId = await chargeInvoice(accountId, minorToMajor(amountMinor, hold.currency), hold.currency, description);
        const payment = await payInvoice(accountId, invoiceId, minorToMajor(amountMinor, hold.currency), `pay-${orderId}`);
        const code = ticketCode();
        const datetime = formatLisbonDateTime(hold.session.starts_at.getTime());
        const settlement = {
            orderId,
            receiptNumber: await nextReceiptNumber(),
            payer,
            kind: "ticket",
            description,
            currency: hold.currency,
            amountMinor,
            last4: hold.digits.slice(-4),
            invoiceId,
            payment,
            settledAt: settledAt(payment, amountMinor, hold.currency),
            ticket: { code, seats: hold.seats, datetime },
        };
        await storeReceipt(settlement);
        const mailId = await tx(async (db) => {
            const id = await recordOrder(db, settlement, hold.session.title);
            await db.query("UPDATE bookings SET state = 'live', ticket_code = $2, order_id = $3 WHERE id = $1", [hold.bookingId, code, orderId]);
            return id;
        });
        const order = (await orderById(pool, orderId));
        return {
            status: 201,
            body: {
                booking: { id: hold.bookingId, ticket_code: code, session_id: sessionId, seats: hold.seats },
                order: orderJson(order),
                receipt_email: await deliverNow([mailId]),
            },
        };
    }
    catch (error) {
        await pool.query("DELETE FROM bookings WHERE id = $1 AND state = 'pending'", [hold.bookingId]);
        throw error;
    }
}
