import type { Locale } from "../shared/domain.ts";
import { bookingView, findBooking } from "./bookings.ts";
import { creditBalance, recordMovement } from "./credit.ts";
import { one, query, transaction } from "./db.ts";
import { bookingConfirmation } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { claimKey, release, remember } from "./idempotency.ts";
import { newBookingRef, newTicketCode, newToken, sha256 } from "./ids.ts";
import { chargeInvoice, ensureAccount, requireBilling, undoCharge, type BilledInvoice, type Charge } from "./killbill.ts";
import { kbAccountFor } from "./membership.ts";
import { splitCost } from "./money.ts";
import { enqueue, wakeOutbox } from "./outbox.ts";
import { findScreening } from "./screenings.ts";
import type { Session } from "./sessions.ts";
import { requireStepup } from "./stepup.ts";
import { findHold, ownHold, priceHold, requireLiveHold, type Owner } from "./holds.ts";
import { Fields } from "./validate.ts";

export type Replyable = { status: number; text: string; replayed: boolean };

/** The guest's Kill Bill account, keyed `guest-<lowercased email>`. */
export async function guestBillingAccount(name: string, email: string, locale: Locale): Promise<string> {
  const key = email.toLowerCase();
  const known = await one<{ kb_account_id: string }>("SELECT kb_account_id FROM guest_billing_accounts WHERE email = $1", [key]);
  if (known) return known.kb_account_id;
  const id = await ensureAccount({ externalKey: `guest-${key}`, name, email, locale });
  await query("INSERT INTO guest_billing_accounts (email, kb_account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [key, id]);
  return id;
}

function readSplit(fields: Fields, raw: unknown, seats: number): { name: string; seats: number }[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fields.add("split", { kind: "required" });
    return [];
  }
  const payers = raw.map((payer, index) => {
    const entry = new Fields({ payer });
    const name = entry.text("payer.name", 1, 80);
    const count = (payer as { seats?: unknown })?.seats;
    if (!name) fields.add(`split.${index}.name`, entry.has("payer.name") ? { kind: "length", params: { min: 1, max: 80 } } : { kind: "required" });
    return { name, seats: typeof count === "number" && Number.isInteger(count) && count >= 1 ? count : 0 };
  });
  const sum = payers.reduce((total, payer) => total + payer.seats, 0);
  if (payers.length < 2 || payers.length > 6 || payers.some((payer) => payer.seats < 1) || sum !== seats) {
    fields.add("split", { kind: "split", params: { n: seats } });
  }
  return payers;
}

/** Checkout: the booking becomes paid only in the commit that records Kill Bill's payment (or a zero pay-now invoice). */
export async function checkout(body: Record<string, unknown>, session: Session | null, owner: Owner, scope: string, key: string | undefined, locale: Locale): Promise<Replyable> {
  const now = new Date();
  const holdId = typeof body.hold_id === "string" ? body.hold_id : null;
  if (holdId !== null) await ownHold(holdId, owner, now);
  const claimed = await claimKey(scope, key, "/api/checkout", body);
  if ("replay" in claimed) return { status: claimed.replay.status, text: claimed.replay.body, replayed: true };
  const claim = claimed.claim;
  let charged: BilledInvoice | null = null;
  try {
    const text = await transaction(async (tx) => {
      const fields = new Fields(body);
      if (holdId === null) {
        fields.text("hold_id", 1, 64);
        fields.done();
      }
      const peek = await findHold(holdId ?? "", now, tx);
      if (!peek) throw new ApiError("not_found");
      const screening = await findScreening(peek.screening_id, tx, true);
      const hold = await ownHold(peek.id, owner, now, tx, true);
      if (!screening) throw new ApiError("not_found");
      requireStepup(session, { creditApplied: await creditBalance(session?.account.number ?? null, tx), tierChange: false }, now);
      requireLiveHold(hold);
      const { fares, priced } = await priceHold(hold, body, session, now, fields, tx);
      const note = fields.text("note", 0, 200, true);
      const cardholder = fields.text("cardholder_name", 1, 80, priced.pay_now_cents === 0);
      const guest = session ? null : { name: fields.text("guest.name", 1, 80), email: fields.email("guest.email"), phone: fields.phone("guest.phone") };
      const split = hold.is_group ? readSplit(fields, body.split, hold.seats.length) : null;
      fields.done();
      requireBilling();

      const name = guest?.name ?? session?.account.name ?? "";
      const email = guest?.email ?? session?.account.email ?? "";
      const kbAccount = session ? await kbAccountFor(session.account) : await guestBillingAccount(name, email, locale);
      const ref = newBookingRef();
      const charges: Charge[] = priced.lines.flatMap((line): Charge[] => [
        { type: "EXTERNAL_CHARGE", description: `${ref} ADM ${line.fare} x${line.quantity}`, cents: line.subtotal_cents },
        { type: "TAX", description: `${ref} GST ${line.fare}`, cents: line.gst_cents },
        { type: "TAX", description: `${ref} QST ${line.fare}`, cents: line.qst_cents },
      ]);
      if (priced.uplift_cents) charges.push({ type: "EXTERNAL_CHARGE", description: `${ref} UPLIFT`, cents: priced.uplift_cents });
      const invoice = await chargeInvoice(kbAccount, charges, ref);
      charged = invoice;

      const shares = split ? splitCost(invoice.amountCents, split.map((payer) => payer.seats)).map((share, i) => ({ name: split[i]?.name ?? "", seats: split[i]?.seats ?? 0, share_cents: share })) : null;
      const token = session ? null : newToken();
      await tx.query(
        `INSERT INTO bookings (ref, hold_id, screening_id, account_id, name, email, phone, locale, state, lines, admission_cents, gst_cents, qst_cents,
           uplift_cents, total_cents, credit_applied_cents, paid_cents, split, note, cardholder_name, kb_account_id, kb_invoice_id, kb_payment_id,
           guest_token_hash, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'paid', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, now())`,
        [ref, hold.id, screening.id, session?.account.id ?? null, name, email, guest?.phone ?? null, locale, JSON.stringify(priced.lines),
          priced.admission_cents, priced.gst_cents, priced.qst_cents, priced.uplift_cents, invoice.amountCents, invoice.creditAppliedCents,
          invoice.paidCents, shares ? JSON.stringify(shares) : null, note, cardholder, kbAccount, invoice.invoiceId, invoice.paymentId,
          token ? sha256(token) : null],
      );
      const tickets = hold.seats.map((seat, index) => ({ code: newTicketCode(), seat, fare: fares[index] ?? "regular" }));
      for (const ticket of tickets) {
        await tx.query("INSERT INTO tickets (code, booking_ref, screening_id, seat, fare, status) VALUES ($1, $2, $3, $4, $5, 'issued')", [
          ticket.code, ref, screening.id, ticket.seat, ticket.fare,
        ]);
      }
      await tx.query("UPDATE holds SET booking_ref = $2 WHERE id = $1", [hold.id, ref]);
      if (invoice.creditAppliedCents > 0 && session?.account.number) await recordMovement(tx, session.account.number, "spend", invoice.creditAppliedCents, ref);
      await enqueue(tx, {
        key: `booking-confirmed:${ref}`, kind: "booking-confirmed", to: email,
        ...bookingConfirmation({
          locale, ref, filmTitle: screening.film_title, startsAt: screening.starts_at, auditoriumName: screening.auditorium_name,
          auditoriumCode: screening.auditorium, seats: hold.seats, tickets, admission: priced.admission_cents, gst: priced.gst_cents,
          qst: priced.qst_cents, uplift: priced.uplift_cents, creditApplied: invoice.creditAppliedCents, total: invoice.amountCents,
          paid: invoice.paidCents, split: shares, guestToken: token,
        }),
      });
      const booking = await findBooking(ref, tx);
      if (!booking) throw new Error("booking vanished");
      return remember(tx, claim, 201, { booking: await bookingView(booking, tx), guest_link: token ? `/${locale}/b/${token}` : null });
    });
    wakeOutbox();
    return { status: 201, text, replayed: false };
  } catch (error) {
    if (charged) await undoCharge(charged);
    await release(claim);
    throw error;
  }
}
