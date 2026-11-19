// Bookings: confirming a hold, the manage link, cancelling, the host's seat/clear/no-show and walk-ins.
import type pg from "pg";
import type { Booking, BookingReceipt, BookingSource, DepositState, ManageResponse } from "../shared/api.js";
import { targetById, type Target } from "./catalog.js";
import { claimWindow, releaseWindow } from "./claims.js";
import { instantIso, now } from "./clock.js";
import { config } from "./config.js";
import { EXCLUSION_VIOLATION, isPgError, pool, rows, transaction } from "./db.js";
import { refundsIfCancelledAt } from "./domain/deposit.js";
import { fitsParty } from "./domain/fit.js";
import { loadOccupancy } from "./domain/occupancy.js";
import { currentSlot } from "./domain/slots.js";
import { guestCancellation, hostTransition, linkIsAlive, occupiesTable, type HostAction } from "./domain/transitions.js";
import { turnWindow, type TurnWindow } from "./domain/turn.js";
import { cancellationEmail, confirmationEmail, queueEmail } from "./emails.js";
import { apiErrors } from "./errors.js";
import { publishEvent, type EventDetail } from "./events.js";
import { effectiveStatus } from "./holds.js";
import { newId, newToken } from "./ids.js";
import { exclusively } from "./locks.js";
import { purchaseDeposit, refundDeposit, type Settled } from "./killbill.js";
import { lisbonDate, slotInstant } from "./lisbon.js";
import { reserveReference } from "./reference.js";
import { BOOKING_COLUMNS, HOLD_COLUMNS, toBooking, type BookingRow, type HoldRow } from "./records.js";
import { requireAnswering } from "./valkey.js";
import { MESSAGES, objectBody, parseEmail, parseName, parsePartySize, parsePhone, parseTarget, rejectInvalid } from "./validation.js";

export function manageUrl(token: string): string {
  return `${config.publicUrl}/manage/${token}`;
}

interface NewBooking {
  reference: string;
  token: string | null;
  source: BookingSource;
  status: "booked" | "seated";
  target: Target;
  date: string;
  time: string;
  startsAt: Date;
  window: TurnWindow;
  partySize: number;
  name: string;
  email: string | null;
  phone: string | null;
  depositCents: number;
  depositState: DepositState;
}

/** Writes the booking and its table occupancy; the database refuses any overlapping window on a table. */
export async function insertBooking(client: pg.PoolClient, input: NewBooking): Promise<BookingRow> {
  const [row] = await rows<BookingRow>(
    client,
    `INSERT INTO bookings (reference, token, status, source, date, time, starts_at, party_size, target_id, table_ids, name, email, phone, deposit_cents, deposit_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING ${BOOKING_COLUMNS}`,
    [
      input.reference, input.token, input.status, input.source, input.date, input.time, input.startsAt, input.partySize,
      input.target.targetId, input.target.tableIds, input.name, input.email, input.phone, input.depositCents, input.depositState,
    ],
  );
  if (row === undefined) throw new Error("the booking was not written");
  for (const tableId of input.target.tableIds) {
    await client.query("INSERT INTO booking_tables (reference, table_id, occupied) VALUES ($1, $2, tstzrange($3, $4))", [
      input.reference, tableId, input.window.start, input.window.end,
    ]);
  }
  return row;
}

export async function recordPayment(client: pg.PoolClient, reference: string, kind: "purchase" | "refund", cents: number, settled: Settled): Promise<void> {
  await client.query(
    `INSERT INTO payments (reference, kind, amount_cents, killbill_account_id, killbill_payment_id, killbill_transaction_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [reference, kind, cents, settled.accountId, settled.paymentId, settled.transactionId],
  );
}

export function bookingEvent(type: EventDetail["type"], row: BookingRow): EventDetail {
  return { type, startsAt: row.starts_at, tableIds: row.table_ids, partySize: row.party_size, reference: row.reference, name: row.name };
}

interface GuestDetails {
  name: string;
  email: string;
  phone: string | null;
}

/** Validates name, email, phone and the deposit acceptance, reporting every failing input. */
function parseGuestDetails(body: unknown, depositCents: number): GuestDetails {
  const input = objectBody(body);
  const name = parseName(input["name"]);
  const email = parseEmail(input["email"]);
  const phone = parsePhone(input["phone"]);
  const accepted = depositCents === 0 || input["accept_deposit"] === true;
  if (name === null || email === null || phone === null || !accepted) {
    throw rejectInvalid({
      name: [name, MESSAGES.name],
      email: [email, MESSAGES.email],
      phone: [phone, MESSAGES.phone],
      accept_deposit: [accepted, MESSAGES.deposit],
    });
  }
  return { name, email, phone: phone ?? null };
}

export async function confirmHold(holdId: string, body: unknown): Promise<BookingReceipt> {
  return exclusively(`hold:${holdId}`, async () => {
    const at = now();
    const [hold] = await rows<HoldRow>(pool, `SELECT ${HOLD_COLUMNS} FROM holds WHERE hold_id = $1`, [holdId]);
    if (hold === undefined) throw apiErrors.notFound();
    const status = effectiveStatus(hold, at);
    if (status === "expired" || status === "released") throw apiErrors.holdExpired();
    const guest = parseGuestDetails(body, hold.deposit_cents);
    if (status === "confirmed") throw apiErrors.holdClosed();
    await requireAnswering();
    const reference = await reserveReference(hold.hold_id);
    const target = targetById(hold.target_id);
    if (target === undefined) throw new Error(`hold ${hold.hold_id} names an unknown table`);
    const token = newToken();
    const window = { start: hold.window_start, end: hold.window_end };

    const client = await pool.connect();
    let charge: Settled | null = null;
    try {
      await client.query("BEGIN");
      const [locked] = await rows<{ status: string }>(client, "SELECT status FROM holds WHERE hold_id = $1 FOR UPDATE", [holdId]);
      if (locked?.status === "confirmed") throw apiErrors.holdClosed();
      if (locked?.status !== "live") throw apiErrors.holdExpired();
      if (hold.deposit_cents > 0) charge = await purchaseDeposit(reference, guest.name, guest.email, hold.deposit_cents);
      const booking = await insertBooking(client, {
        reference, token, source: "online", status: "booked", target, date: hold.date, time: hold.time,
        startsAt: hold.window_start, window, partySize: hold.party_size, name: guest.name, email: guest.email,
        phone: guest.phone, depositCents: hold.deposit_cents, depositState: charge === null ? "none" : "paid",
      });
      if (charge !== null) await recordPayment(client, reference, "purchase", hold.deposit_cents, charge);
      await client.query("UPDATE holds SET status = 'confirmed' WHERE hold_id = $1", [holdId]);
      await queueEmail(client, confirmationEmail(booking, guest.email));
      await client.query("COMMIT");
      await releaseWindow(hold.hold_id, hold.table_ids, window).catch(() => undefined);
      void publishEvent(bookingEvent("booking.created", booking));
      return { booking: toBooking(booking), manage_url: manageUrl(token) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (charge !== null) await refundDeposit(reference, charge.paymentId, hold.deposit_cents).catch(() => undefined);
      throw isPgError(error, EXCLUSION_VIOLATION) ? apiErrors.tableTaken() : error;
    } finally {
      client.release();
    }
  });
}

async function findByToken(db: pg.Pool | pg.PoolClient, token: string, lock: boolean): Promise<BookingRow> {
  const [row] = await rows<BookingRow>(db, `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE token = $1${lock ? " FOR UPDATE" : ""}`, [token]);
  if (row === undefined) throw apiErrors.notFound();
  return row;
}

export async function readManage(token: string): Promise<ManageResponse> {
  const at = now();
  const row = await findByToken(pool, token, false);
  if (!linkIsAlive(row.status)) throw apiErrors.linkExpired();
  return {
    booking: toBooking(row),
    server_now: instantIso(at),
    refund_if_cancelled_now: refundsIfCancelledAt(row.starts_at, at),
  };
}

export async function cancelBooking(token: string): Promise<{ booking: Booking }> {
  return exclusively(`booking:${token}`, async () => {
    const at = now();
    const cancelled = await transaction(async (client) => {
      const row = await findByToken(client, token, true);
      const status = guestCancellation(row, at);
      let depositState = row.deposit_state;
      if (row.deposit_state === "paid") {
        if (status === "cancelled_refunded") {
          const [paid] = await rows<{ killbill_account_id: string; killbill_payment_id: string }>(
            client,
            "SELECT killbill_account_id, killbill_payment_id FROM payments WHERE reference = $1 AND kind = 'purchase'",
            [row.reference],
          );
          if (paid === undefined) throw new Error(`booking ${row.reference} has no recorded deposit`);
          const transactionId = await refundDeposit(row.reference, paid.killbill_payment_id, row.deposit_cents);
          await recordPayment(client, row.reference, "refund", row.deposit_cents, {
            accountId: paid.killbill_account_id,
            paymentId: paid.killbill_payment_id,
            transactionId,
          });
          depositState = "refunded";
        } else {
          depositState = "retained";
        }
      }
      const [updated] = await rows<BookingRow>(
        client,
        `UPDATE bookings SET status = $2, deposit_state = $3 WHERE reference = $1 RETURNING ${BOOKING_COLUMNS}`,
        [row.reference, status, depositState],
      );
      if (updated === undefined) throw new Error("the cancelled booking vanished");
      await freeTables(client, updated);
      if (updated.email !== null) await queueEmail(client, cancellationEmail(updated, updated.email));
      return updated;
    });
    void publishEvent(bookingEvent("booking.cancelled", cancelled));
    return { booking: toBooking(cancelled) };
  });
}

/** Ends a booking's occupation of its tables and queues the freed tables for the waitlist. */
async function freeTables(client: pg.PoolClient, row: BookingRow): Promise<void> {
  if (occupiesTable(row.status)) return;
  await client.query("DELETE FROM booking_tables WHERE reference = $1", [row.reference]);
  await client.query("INSERT INTO freed_tables (date, table_ids) VALUES ($1, $2)", [row.date, row.table_ids]);
}

const HOST_EVENTS = { seat: "booking.seated", clear: "booking.completed", no_show: "booking.no_show" } as const;

export async function changeBookingStatus(reference: string, action: HostAction): Promise<{ booking: Booking }> {
  const at = now();
  const changed = await transaction(async (client) => {
    const [row] = await rows<BookingRow>(client, `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE reference = $1 FOR UPDATE`, [reference]);
    if (row === undefined) throw apiErrors.notFound();
    const status = hostTransition(row, action, at);
    const retained: DepositState = action === "no_show" && row.deposit_state === "paid" ? "retained" : row.deposit_state;
    const [updated] = await rows<BookingRow>(
      client,
      `UPDATE bookings SET status = $2, deposit_state = $3 WHERE reference = $1 RETURNING ${BOOKING_COLUMNS}`,
      [reference, status, retained],
    );
    if (updated === undefined) throw new Error("the booking vanished");
    await freeTables(client, updated);
    return updated;
  });
  void publishEvent(bookingEvent(HOST_EVENTS[action], changed));
  return { booking: toBooking(changed) };
}

export async function listTonightsBookings(): Promise<{ date: string; bookings: Booking[] }> {
  const date = lisbonDate(now());
  const found = await rows<BookingRow>(pool, `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE date = $1 ORDER BY time, sequence`, [date]);
  return { date, bookings: found.map(toBooking) };
}

export async function seatWalkIn(body: unknown): Promise<{ booking: Booking }> {
  const at = now();
  const input = objectBody(body);
  const target = parseTarget(input["table_id"]);
  const partySize = parsePartySize(input["party_size"]);
  if (target === null || partySize === null) {
    throw rejectInvalid({ table_id: [target, MESSAGES.table], party_size: [partySize, MESSAGES.party] });
  }

  const date = lisbonDate(at);
  const time = currentSlot(at);
  const startsAt = slotInstant(date, time);
  const window = turnWindow(partySize, startsAt);
  if (!fitsParty(target, partySize)) throw apiErrors.tableNotForParty();
  if (!(await loadOccupancy(pool, window.start, window.end, at)).isFree(target, window)) throw apiErrors.tableTaken();

  const walkInId = newId();
  if (!(await claimWindow(pool, walkInId, target.tableIds, window, config.holdSeconds * 1000))) throw apiErrors.tableTaken();
  try {
    const reference = await reserveReference(walkInId);
    const booking = await transaction((client) =>
      insertBooking(client, {
        reference, token: null, source: "walk_in", status: "seated", target, date, time, startsAt, window, partySize,
        name: "Walk-in", email: null, phone: null, depositCents: 0, depositState: "none",
      }),
    );
    void publishEvent({ type: "walkin.seated", startsAt, tableIds: target.tableIds, partySize });
    return { booking: toBooking(booking) };
  } catch (error) {
    throw isPgError(error, EXCLUSION_VIOLATION) ? apiErrors.tableTaken() : error;
  } finally {
    await releaseWindow(walkInId, target.tableIds, window).catch(() => undefined);
  }
}
