import { Pool } from "pg";
import { Tx } from "./config";
import { queueEmail } from "./mail";
import { formatDayShort, formatRange, formatTimeHM, formatMoney } from "../shared/time";
import { LANGUAGES } from "../shared/domain";
import { AssignmentRow, SeatRow } from "./assignments";

interface QualifiedInterpreter {
  email: string;
  name: string;
}

export async function activeInterpretersForLanguage(tx: Tx, language: string): Promise<QualifiedInterpreter[]> {
  const res = await tx.query(
    `SELECT p.email, p.name
       FROM people p
       JOIN interpreter_languages il ON il.person_id = p.id
      WHERE p.role = 'interpreter' AND p.active = true AND il.language_code = $1`,
    [language],
  );
  return res.rows as QualifiedInterpreter[];
}

function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function shortTime(a: AssignmentRow): string {
  return `${formatDayShort(a.start_at)} ${formatTimeHM(a.start_at)}`;
}

/** One offer email per active interpreter qualified in the language; offer-safe fields only. */
export async function sendOfferEmails(tx: Tx, a: AssignmentRow): Promise<number> {
  const interpreters = await activeInterpretersForLanguage(tx, a.language_code);
  const subject = `Open seat ${a.number}: ${languageName(a.language_code)}, ${shortTime(a)}`;
  for (const interp of interpreters) {
    const body = [
      `Hello ${interp.name},`,
      ``,
      `An open seat is available on request ${a.number}.`,
      ``,
      `Language: ${languageName(a.language_code)}`,
      `Setting: ${a.setting}`,
      `City: ${a.city}`,
      `Time: ${formatRange(a.start_at, a.end_at)} (${a.duration_minutes} min)`,
      ``,
      `Sign in to Teamseat and claim it from Open seats.`,
      ``,
      `Northfold Language Access`,
    ].join("\r\n");
    await queueEmailTx(tx, interp.email, subject, body);
  }
  return interpreters.length;
}

type MailSink = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

// The outbox write is a single INSERT, either inside a transaction or on the pool.
async function queueEmailTx(sink: MailSink, to: string, subject: string, body: string): Promise<void> {
  await queueEmail(sink as unknown as Pool, to, subject, body);
}

export async function sendClaimConfirmation(tx: Tx, a: AssignmentRow, seat: number, interp: { email: string; name: string }): Promise<void> {
  const subject = `Seat ${seat} confirmed on ${a.number}`;
  const body = [
    `Hello ${interp.name},`,
    ``,
    `Seat ${seat} on request ${a.number} is yours.`,
    ``,
    `Language: ${languageName(a.language_code)}`,
    `Setting: ${a.setting}`,
    `Street address: ${a.street_address}`,
    `City: ${a.city}`,
    `Time: ${formatRange(a.start_at, a.end_at)} (${a.duration_minutes} min)`,
    ``,
    `Requested by ${a.scheduler_name} (${a.scheduler_phone}).`,
    ``,
    `Please arrive on time and verify the seat after the job.`,
    ``,
    `Northfold Language Access`,
  ].join("\r\n");
  await queueEmailTx(tx, interp.email, subject, body);
}

export async function sendCoverageReceipt(tx: Tx, a: AssignmentRow, seats: SeatRow[], schedulerEmail: string): Promise<void> {
  const subject = `${a.number} is fully covered`;
  const seatLines = seats.map((s) => `Seat ${s.seat}: ${s.holder_initials ?? ""}`.trimEnd());
  const body = [
    `Hello ${a.scheduler_name},`,
    ``,
    `Every seat on request ${a.number} is now covered.`,
    ``,
    `Language: ${languageName(a.language_code)}`,
    `Setting: ${a.setting}`,
    `Time: ${formatRange(a.start_at, a.end_at)}`,
    ``,
    ...seatLines,
    ``,
    `Northfold Language Access`,
  ].join("\r\n");
  await queueEmailTx(tx, schedulerEmail, subject, body);
}

export async function sendCancellationNotices(
  tx: Tx,
  a: AssignmentRow,
  feeApplies: boolean,
  feeCents: number,
  schedulerEmail: string,
  holderEmails: { email: string; name: string }[],
): Promise<void> {
  const feeWord = feeApplies ? "fee applies" : "no fee";
  const subject = `${a.number} cancelled — ${feeWord}`;
  const feeLine = feeApplies ? `A late-cancellation fee of ${formatMoney(feeCents)} applies.` : `No fee applies.`;
  const recipients = [{ email: schedulerEmail, name: a.scheduler_name }, ...holderEmails];
  for (const r of recipients) {
    const body = [
      `Hello ${r.name},`,
      ``,
      `Request ${a.number} (${languageName(a.language_code)}, ${formatRange(a.start_at, a.end_at)}) has been cancelled.`,
      ``,
      feeLine,
      ``,
      `Northfold Language Access`,
    ].join("\r\n");
    await queueEmailTx(tx, r.email, subject, body);
  }
}

export async function sendTimeChangeNotices(
  tx: Tx,
  a: AssignmentRow,
  schedulerEmail: string,
  freedEmails: { email: string; name: string }[],
): Promise<void> {
  const subject = `${a.number} changed — no fee`;
  const schedulerBody = [
    `Hello ${a.scheduler_name},`,
    ``,
    `Request ${a.number} moved to ${formatRange(a.start_at, a.end_at)}.`,
    ``,
    `Held seats were reopened and the request was offered again. No fee applies.`,
    ``,
    `Northfold Language Access`,
  ].join("\r\n");
  await queueEmailTx(tx, schedulerEmail, subject, schedulerBody);
  for (const r of freedEmails) {
    const body = [
      `Hello ${r.name},`,
      ``,
      `The time of request ${a.number} changed, so your seat was given back.`,
      ``,
      `New time: ${formatRange(a.start_at, a.end_at)}.`,
      `No fee applies.`,
      ``,
      `You can claim a seat again if the new time fits your calendar.`,
      ``,
      `Northfold Language Access`,
    ].join("\r\n");
    await queueEmailTx(tx, r.email, subject, body);
  }
}

