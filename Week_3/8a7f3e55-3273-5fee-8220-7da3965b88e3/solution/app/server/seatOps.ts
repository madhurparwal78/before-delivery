import type { BookingStatus } from "../shared/api.js";
import { type BookingData, coordinatorCard, loadBooking, statusOf } from "./bookings.js";
import { type Db, one, rows } from "./db.js";
import { assignmentEmail, coverageEmail } from "./emails.js";
import type { Message } from "./services/smtp.js";

export async function recordAudit(
  client: Db,
  bookingId: number,
  actorName: string,
  action: string,
  from: BookingStatus | null,
  to: BookingStatus,
  seat: number | null = null,
  interpreterName: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_entries (booking_id, actor_name, action, from_status, to_status, seat, interpreter_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [bookingId, actorName, action, from, to, seat, interpreterName],
  );
}

/** Queues a message in the caller's transaction; the mail workers send it exactly once. */
export async function enqueueEmail(client: Db, message: Message): Promise<void> {
  await client.query("INSERT INTO emails (to_address, subject, body) VALUES ($1, $2, $3)", [message.to, message.subject, message.body]);
}

export interface InterpreterRow {
  user_id: string;
  name: string;
  email: string;
  initials: string;
  phone: string;
  home_city: string;
  pay_rate_cents: number;
}

const INTERPRETER_SELECT = `SELECT i.user_id, u.name, u.email, i.initials, i.phone, i.home_city, i.pay_rate_cents
                              FROM interpreters i JOIN users u ON u.id = i.user_id`;

export const findInterpreter = (client: Db, id: string): Promise<InterpreterRow | null> =>
  one<InterpreterRow>(client, `${INTERPRETER_SELECT} WHERE i.user_id = $1`, [id]);

export const allInterpreters = (client: Db): Promise<InterpreterRow[]> => rows<InterpreterRow>(client, INTERPRETER_SELECT);

/** Locks the interpreter row so that two seats for one person cannot be filled at overlapping times at once. */
export async function lockInterpreter(client: Db, id: string): Promise<void> {
  await client.query("SELECT user_id FROM interpreters WHERE user_id = $1 FOR UPDATE", [id]);
}

const BUSY_SQL = `SELECT DISTINCT s.interpreter_id
                    FROM seats s JOIN bookings b ON b.id = s.booking_id
                   WHERE s.interpreter_id IS NOT NULL AND b.id <> $1
                     AND b.phase NOT IN ('cancelled', 'cancelled_late')
                     AND b.start_at < $2 AND $3 < COALESCE(b.completed_at, b.end_at)`;

/** Interpreters holding a seat on another booking that is not cancelled and overlaps this one's span; a completed assignment ends at its completion. */
export async function busyInterpreterIds(client: Db, data: BookingData): Promise<Set<string>> {
  const busy = await rows<{ interpreter_id: string }>(client, BUSY_SQL, [data.row.id, data.row.end_at, data.row.start_at]);
  return new Set(busy.map((row) => row.interpreter_id));
}

/** Fills one vacant seat: audit entry, assignment confirmation, and a coverage confirmation when it completes the team. */
export async function fillSeat(
  client: Db,
  data: BookingData,
  seatNumber: number,
  interpreter: InterpreterRow,
  actorName: string,
): Promise<BookingData> {
  const before = statusOf(data);
  await client.query("UPDATE seats SET interpreter_id = $1 WHERE booking_id = $2 AND seat = $3 AND interpreter_id IS NULL", [
    interpreter.user_id,
    data.row.id,
    seatNumber,
  ]);
  const after = await loadBooking(client, data.row.id);
  if (after === null) throw new Error("the booking vanished while filling a seat");
  const seat = after.seats.find((candidate) => candidate.seat === seatNumber);
  if (seat === undefined) throw new Error("the seat vanished while filling it");
  await recordAudit(client, data.row.id, actorName, "seat_filled", before, statusOf(after), seatNumber, interpreter.name);
  await enqueueEmail(client, assignmentEmail(after, seat, interpreter.email));
  if (statusOf(after) === "covered") await enqueueEmail(client, coverageEmail(after));
  return after;
}

/** The coordinator card for an interpreter outside a booking: the interpreter choice list. */
export const choiceCard = (interpreter: InterpreterRow, credentials: { code: string; expires_on: string }[]) =>
  coordinatorCard(
    {
      interpreter_id: interpreter.user_id,
      name: interpreter.name,
      initials: interpreter.initials,
      phone: interpreter.phone,
      email: interpreter.email,
      home_city: interpreter.home_city,
      pay_rate_cents: interpreter.pay_rate_cents,
    },
    credentials,
  );
