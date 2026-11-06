import { bookingView, findBooking, findBookingWhere } from "./bookings.ts";
import { creditBalance, creditMovements, recordMovement } from "./credit.ts";
import { one, query, transaction } from "./db.ts";
import { enquiryReply } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { findGift, giftView } from "./gifts.ts";
import { newEnquiryRef } from "./ids.ts";
import { addCredit, requireBilling } from "./killbill.ts";
import { activeMembership, kbAccountFor } from "./membership.ts";
import { enqueue, nextMailNumber, wakeOutbox } from "./outbox.ts";
import type { AccountRow, Session } from "./sessions.ts";
import { isoToronto, isoTorontoMs } from "./time.ts";
import { Fields } from "./validate.ts";

export async function accountView(account: AccountRow, now: Date): Promise<Record<string, unknown>> {
  return {
    number: account.number, name: account.name, email: account.email, locale: account.locale, role: account.role,
    membership: await activeMembership(account.id, now), credit_balance_cents: await creditBalance(account.number),
  };
}

async function patronByNumber(number: string): Promise<AccountRow | undefined> {
  return one<AccountRow>("SELECT id, number, email, name, role, locale, kb_account_id FROM accounts WHERE number = $1 AND role = 'patron'", [number.trim().toUpperCase()]);
}

/** Staff lookup by booking ref, ticket code, gift ref or account number (case-insensitive, trimmed). */
export async function lookup(q: string): Promise<Record<string, unknown>> {
  const code = q.trim().toUpperCase();
  const booking = code.startsWith("T-")
    ? (await findBookingWhere("b.ref = (SELECT booking_ref FROM tickets WHERE code = $1)", [code]))[0]
    : code.startsWith("HB-") ? await findBooking(code) : undefined;
  if (booking) {
    const account = booking.account_id ? await one<{ number: string }>("SELECT number FROM accounts WHERE id = $1", [booking.account_id]) : undefined;
    return { kind: "booking", booking: await bookingView(booking), patron: { name: booking.name, email: booking.email, phone: booking.phone, account_number: account?.number ?? null } };
  }
  if (code.startsWith("HG-")) {
    const gift = await findGift(code);
    if (gift) return { kind: "gift", gift: giftView(gift, true) };
  }
  if (code.startsWith("A-")) {
    const account = await patronByNumber(code);
    if (account?.number) return { kind: "account", account: await accountView(account, new Date()), ledger: await creditMovements(account.number) };
  }
  throw new ApiError("not_found");
}

/** A goodwill credit: Kill Bill account credit `GOODWILL <audit id>`, one paired movement and one audit entry. */
export async function issueGoodwill(staff: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const number = typeof body.account_number === "string" ? body.account_number : "";
  const account = number ? await patronByNumber(number) : undefined;
  const fields = new Fields(body);
  if (number && !account) throw new ApiError("not_found");
  fields.text("account_number", 1, 20);
  const cents = fields.integer("amount_cents", 100, 50000, { kind: "credit" });
  const reason = fields.text("reason", 3, 500);
  fields.done();
  requireBilling();
  if (!account?.number) throw new ApiError("not_found");
  const accountNumber = account.number;
  const kbAccount = await kbAccountFor(account);
  return transaction(async (tx) => {
    const audit = await one<{ id: number }>(
      "INSERT INTO audit_log (actor, action, target, amount_cents, reason) VALUES ($1, 'goodwill-credit', $2, $3, $4) RETURNING id",
      [staff.account.email, accountNumber, cents, reason], tx,
    );
    const auditId = audit?.id ?? 0;
    const movementId = await recordMovement(tx, accountNumber, "goodwill", cents, `GOODWILL ${auditId}`);
    const balance = await creditBalance(accountNumber, tx);
    // Kill Bill's credit is the last step, so only the commit itself can follow it.
    await addCredit(kbAccount, cents, `GOODWILL ${auditId}`);
    return { credit: { account_number: accountNumber, amount_cents: cents, currency: "CAD", balance_cents: balance, movement_id: movementId, audit_id: auditId } };
  });
}

export async function auditEntries(): Promise<Record<string, unknown>> {
  const rows = await query<{ id: number; at: Date; actor: string; action: string; target: string; amount_cents: number | null; reason: string }>(
    "SELECT id, at, actor, action, target, amount_cents, reason FROM audit_log ORDER BY id DESC LIMIT 500",
  );
  return { entries: rows.map((row) => ({ ...row, at: isoToronto(row.at) })) };
}

export async function outboxMessages(): Promise<Record<string, unknown>> {
  const messages = await query<{ seq: string; key: string; kind: string; to_address: string; subject: string; enqueued_at: Date; state: string }>(
    "SELECT * FROM (SELECT seq, key, kind, to_address, subject, enqueued_at, state FROM outbox ORDER BY seq DESC LIMIT 200) latest ORDER BY seq",
  );
  const attempts = await query<{ seq: string; started_at: Date; finished_at: Date | null; outcome: string | null }>(
    "SELECT seq, started_at, finished_at, outcome FROM outbox_attempts WHERE seq = ANY($1) ORDER BY id", [messages.map((m) => m.seq)],
  );
  return {
    messages: messages.map((m) => ({
      seq: Number(m.seq), key: m.key, kind: m.kind, to: m.to_address, subject: m.subject, enqueued_at: isoTorontoMs(m.enqueued_at), state: m.state,
      attempts: attempts.filter((a) => a.seq === m.seq).map((a) => ({
        started_at: isoTorontoMs(a.started_at), finished_at: a.finished_at ? isoTorontoMs(a.finished_at) : null, outcome: a.outcome,
      })),
    })),
  };
}

type EnquiryRow = { ref: string; name: string; email: string; subject: string; message: string; locale: "en" | "fr"; state: string; received_at: Date };

export async function createEnquiry(body: Record<string, unknown>, locale: "en" | "fr"): Promise<Record<string, unknown>> {
  const fields = new Fields(body);
  const name = fields.text("name", 1, 80);
  const email = fields.email("email");
  const subject = fields.text("subject", 1, 120);
  const message = fields.text("message", 1, 4000);
  fields.done();
  const ref = newEnquiryRef();
  await query("INSERT INTO enquiries (ref, name, email, subject, message, locale, state) VALUES ($1, $2, $3, $4, $5, $6, 'open')", [ref, name, email, subject, message, locale]);
  return { enquiry: { ref, state: "open" } };
}

export async function enquiries(): Promise<Record<string, unknown>> {
  const rows = await query<EnquiryRow>("SELECT * FROM enquiries ORDER BY received_at DESC LIMIT 500");
  return { enquiries: rows.map((row) => ({ ...row, received_at: isoToronto(row.received_at) })) };
}

/** A reply is enqueued as `enquiry-reply:<ref>:<n>` in the enquiry's locale and recorded in the audit list. */
export async function replyToEnquiry(staff: Session, ref: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const enquiry = await one<EnquiryRow>("SELECT * FROM enquiries WHERE ref = $1", [ref.trim().toUpperCase()]);
  if (!enquiry) throw new ApiError("not_found");
  const fields = new Fields(body);
  const text = fields.text("body", 1, 4000);
  fields.done();
  const queued = await transaction(async (tx) => {
    const n = await nextMailNumber(tx, `enquiry-reply:${enquiry.ref}`);
    await enqueue(tx, { key: `enquiry-reply:${enquiry.ref}:${n}`, kind: "enquiry-reply", to: enquiry.email, ...enquiryReply(enquiry.locale, { ref: enquiry.ref, subject: enquiry.subject, body: text }) });
    await tx.query("UPDATE enquiries SET state = 'answered' WHERE ref = $1", [enquiry.ref]);
    await tx.query("INSERT INTO audit_log (actor, action, target, amount_cents, reason) VALUES ($1, 'enquiry-reply', $2, NULL, $3)", [staff.account.email, enquiry.ref, enquiry.subject]);
    return (await one<{ at: Date }>("SELECT now() AS at", [], tx))?.at ?? new Date();
  });
  wakeOutbox();
  return { reply: { enquiry_ref: enquiry.ref, queued_at: isoToronto(queued) }, enquiry: { ref: enquiry.ref, state: "answered" } };
}
