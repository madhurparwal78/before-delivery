import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { query, withTransaction, recordKbAccount } from './database';
import type { Config } from '../config';
import type { KillBillClient, KbInvoice } from './killbill';
import type { OutboxService } from './outbox';
import { ApiError } from '../http/errors';
import {
  costSplit, payerMin, payerMax, type Fare, type Locale, type PayerShare,
} from '../domain/model';
import { iso, dateOnly, timeOnly } from '../time';
import { bookingRef, ticketCode, sha256Hex, capabilityToken } from '../domain/ids';
import { bookingConfirmationEmail, emailText, emailHtml } from '../mail/templates';
import { kbSafe } from './kb-safe';
import { nextMovementId } from './finance';
import { seatSort } from '../domain/seats';
import type { QuoteResult } from './checkout-core';

export interface CheckoutInput {
  sessionToken: string | null;
  accountId: number | null;
  accountNumber: string | null;
  accountName: string | null;
  accountEmail: string | null;
  idempotencyKey: string | null;
  cardholderName: string;
  note: string;
  guest: { name: string; email: string; phone: string } | null;
  split: { name: string; seats: number }[] | null;
  locale: Locale;
}

export interface CheckoutResult {
  status: number;
  body: Record<string, unknown>;
  replayed: boolean;
}

function callerKey(input: CheckoutInput): string {
  return input.accountId !== null ? `account:${input.accountId}` : `session:${input.sessionToken ?? 'anonymous'}`;
}

/**
 * The one idempotency rule: a replay returns the stored response before any
 * later check; the same key with a different body is a conflict; a missing
 * key is a validation error.
 */
export async function idempotencyReplay(
  input: CheckoutInput,
  rawBody: string,
): Promise<Record<string, unknown> | null> {
  const key = input.idempotencyKey;
  if (!key) {
    throw new ApiError('validation', {
      fields: { idempotency_key: input.locale === 'en' ? 'A retry key is required.' : 'Une clé de reprise est requise.' },
    });
  }
  const bodyHash = sha256Hex(rawBody);
  const caller = callerKey(input);
  const existing = await query<{ body_hash: string; caller: string; state: string; response_body: unknown }>(
    'SELECT body_hash, caller, state, response_body FROM idempotency WHERE key = $1',
    [key],
  );
  const row = existing.rows[0];
  if (row && row.state === 'in_progress') {
    throw new ApiError('idempotency_in_progress');
  }
  if (row && row.state === 'done') {
    if (row.body_hash !== bodyHash || row.caller !== caller) {
      throw new ApiError('idempotency_conflict');
    }
    return row.response_body as Record<string, unknown>;
  }
  await query(
    `INSERT INTO idempotency (key, caller, body_hash, state) VALUES ($1,$2,$3,'in_progress')
     ON CONFLICT (key) DO NOTHING`,
    [key, caller, bodyHash],
  );
  return null;
}

export async function storeIdempotent(
  key: string,
  status: number,
  body: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE idempotency SET state='done', status=$2, response_body=$3 WHERE key=$1`,
    [key, status, JSON.stringify(body)],
  );
}

/** Builds the Kill Bill invoice items for a booking, with the published descriptions. */
export function bookingInvoiceItems(
  ref: string,
  lines: { fare: Fare; quantity: number; subtotal_cents: number; gst_cents: number; qst_cents: number }[],
  upliftCents: number,
): { itemType: string; description: string; amountCents: number }[] {
  const items: { itemType: string; description: string; amountCents: number }[] = [];
  for (const line of lines) {
    items.push({ itemType: 'EXTERNAL_CHARGE', description: `${ref} ADM ${line.fare} x${line.quantity}`, amountCents: line.subtotal_cents });
    items.push({ itemType: 'EXTERNAL_CHARGE', description: `${ref} TAX GST ${line.fare}`, amountCents: line.gst_cents });
    items.push({ itemType: 'EXTERNAL_CHARGE', description: `${ref} TAX QST ${line.fare}`, amountCents: line.qst_cents });
  }
  if (upliftCents > 0) {
    items.push({ itemType: 'EXTERNAL_CHARGE', description: `${ref} UPLIFT`, amountCents: upliftCents });
  }
  return items;
}

export interface CheckoutDeps {
  cfg: Config;
  kb: KillBillClient;
  outbox: OutboxService;
}

/**
 * The one checkout atomicity rule: the booking, tickets and confirmation email
 * commit together with the successful Kill Bill payment, or nothing stands.
 * The hold row is locked before any money moves, so concurrent checkouts of
 * one hold produce exactly one payment and the losers answer hold_already_paid.
 */
export async function checkoutBooking(
  deps: CheckoutDeps,
  input: CheckoutInput,
  quote: QuoteResult,
  screening: {
    id: string; filmTitle: string; startsAt: DateTime;
    auditoriumName: string; auditoriumCode: string;
  },
): Promise<CheckoutResult> {
  const { cfg, kb, outbox } = deps;
  const { view, assignments, row, seats } = quote;
  const ref = bookingRef();
  const isGuest = input.accountId === null;
  let createdInvoiceId: string | null = null;
  let paymentId: string | null = null;

  // Group split: payers must add up; the split is computed from the booking total.
  let split: PayerShare[] | null = null;
  if (row.group_booking) {
    const payers = input.split ?? [];
    const splitMsg = input.locale === 'en'
      ? `Payer seats must add up to ${seats.length}.`
      : `Les places des payeurs doivent totaliser ${seats.length}.`;
    if (payers.length < payerMin || payers.length > payerMax) {
      throw new ApiError('validation', { fields: { split: splitMsg } });
    }
    const sum = payers.reduce((s, p) => s + p.seats, 0);
    if (sum !== seats.length) {
      throw new ApiError('validation', { fields: { split: splitMsg } });
    }
    split = costSplit(view.total_cents, payers);
  }

  const body = await withTransaction(async (client): Promise<Record<string, unknown>> => {
    const holdLock = await client.query<{ state: string }>(
      'SELECT state FROM holds WHERE id=$1 FOR UPDATE',
      [row.id],
    );
    if (holdLock.rows[0].state !== 'held') {
      throw new ApiError('hold_already_paid');
    }

    // Kill Bill: account, invoice, payment — while the hold row lock is held.
    const externalKey = isGuest
      ? `guest-${(input.guest?.email ?? '').toLowerCase()}`
      : (input.accountNumber as string);
    let kbAccountId: string;
    const existingAccount = await kbSafe(kb.getAccountByExternalKey(externalKey));
    if (existingAccount) {
      kbAccountId = existingAccount.accountId;
    } else {
      kbAccountId = (await kbSafe(kb.createAccount({
        externalKey,
        name: isGuest ? (input.guest?.name ?? 'Guest') : (input.accountName ?? 'Patron'),
        email: isGuest ? (input.guest?.email ?? '') : (input.accountEmail ?? ''),
        locale: input.locale,
      }))).accountId;
      await recordKbAccount(kbAccountId, externalKey);
      await kbSafe(kb.addExternalPaymentMethod(kbAccountId));
    }
    const items = bookingInvoiceItems(ref, view.lines, view.uplift_cents);
    const invoice: KbInvoice = await kbSafe(kb.createChargeInvoice(kbAccountId, items));
    createdInvoiceId = invoice.id;
    const payNow = view.pay_now_cents;
    if (payNow > 0) {
      const payment = await kbSafe(kb.payInvoice(invoice.id, kbAccountId, payNow));
      paymentId = payment.paymentId;
    }
    const paidAt = DateTime.now();
    const guestToken = isGuest ? capabilityToken() : null;

    await client.query(
      `UPDATE holds SET state='paid', booking_ref=$2 WHERE id=$1`,
      [row.id, ref],
    );
    await client.query(
      `INSERT INTO bookings (ref, hold_id, screening_id, account_id, guest_name, guest_email, guest_phone, note,
        locale, group_booking, cardholder_name, state, admission_cents, gst_cents, qst_cents, uplift_cents,
        total_cents, credit_applied_cents, paid_cents, paid_at, kb_account_id, kb_payment_id, kb_invoice_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'paid',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [ref, row.id, screening.id, input.accountId,
        input.guest?.name ?? null, input.guest?.email ?? null, input.guest?.phone ?? null,
        input.note, input.locale, row.group_booking, input.cardholderName,
        view.admission_cents, view.gst_cents, view.qst_cents, view.uplift_cents,
        view.total_cents, view.credit_applied_cents, payNow, paidAt.toJSDate(), kbAccountId, paymentId, invoice.id],
    );
    for (const line of view.lines) {
      await client.query(
        `INSERT INTO booking_lines (booking_ref, fare, quantity, unit_cents, subtotal_cents, gst_cents, qst_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ref, line.fare, line.quantity, line.unit_cents, line.subtotal_cents, line.gst_cents, line.qst_cents],
      );
    }
    const codes: string[] = [];
    for (let i = 0; i < seats.length; i++) {
      const code = ticketCode();
      codes.push(code);
      await client.query(
        `INSERT INTO tickets (code, booking_ref, seat, fare, status) VALUES ($1,$2,$3,$4,'issued')`,
        [code, ref, seats[i], assignments[i].fare],
      );
      await client.query(
        `INSERT INTO seat_claims (screening_id, seat, booking_ref) VALUES ($1,$2,$3)
         ON CONFLICT (screening_id, seat) DO UPDATE SET booking_ref=$3, hold_id=NULL, claimed_at=now()`,
        [screening.id, seats[i], ref],
      );
    }
    if (split) {
      for (let i = 0; i < split.length; i++) {
        await client.query(
          `INSERT INTO cost_splits (booking_ref, name, seats, share_cents, position) VALUES ($1,$2,$3,$4,$5)`,
          [ref, split[i].name, split[i].seats, split[i].share_cents, i + 1],
        );
      }
    }
    if (guestToken) {
      await client.query(
        `INSERT INTO guest_links (token, booking_ref, active) VALUES ($1,$2,true)`,
        [guestToken, ref],
      );
    }
    if (view.credit_applied_cents > 0 && input.accountNumber) {
      // The paired credit spend: member-credit −Y and credit-redeemed +Y.
      const movementId = await nextMovementId(client);
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'member-credit',$3,'spend',$4)`,
        [movementId, input.accountNumber, -view.credit_applied_cents, ref],
      );
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'credit-redeemed',$3,'spend',$4)`,
        [movementId, input.accountNumber, view.credit_applied_cents, ref],
      );
    }
    // The confirmation email, enqueued in the same commit.
    const emailData = {
      bookingRef: ref,
      filmTitle: screening.filmTitle,
      date: dateOnly(screening.startsAt),
      time: timeOnly(screening.startsAt),
      auditoriumName: screening.auditoriumName,
      auditoriumCode: screening.auditoriumCode,
      seats,
      tickets: seats.map((seat, i) => ({ code: codes[i], seat, fare: assignments[i].fare })),
      admissionCents: view.admission_cents,
      gstCents: view.gst_cents,
      qstCents: view.qst_cents,
      upliftCents: view.uplift_cents,
      creditAppliedCents: view.credit_applied_cents,
      totalCents: view.total_cents,
      paidCents: view.pay_now_cents,
      split,
      guestLink: guestToken ? `${cfg.publicUrl}/${input.locale}/b/${guestToken}` : null,
      accountBookingLink: input.accountNumber ? `${cfg.publicUrl}/${input.locale}/account/bookings/${ref}` : null,
    };
    const email = bookingConfirmationEmail(input.locale, emailData);
    const toEmail = isGuest ? (input.guest?.email ?? '') : (input.accountEmail ?? '');
    outbox.enqueueInTx(client, {
      messageKey: `booking-confirmed:${ref}`,
      kind: 'booking-confirmed',
      to: toEmail,
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale: input.locale,
    });
    const bookingView = await bookingViewFromRows(client, ref);
    const bodyOut: Record<string, unknown> = { booking: bookingView };
    bodyOut.guest_link = guestToken ? `/${input.locale}/b/${guestToken}` : null;
    return bodyOut;
  }).catch(async (err) => {
    // Compensation: no charge and no invoice may survive a failed commit.
    if (paymentId) {
      try { await kb.refundPayment(paymentId, view.pay_now_cents); } catch { /* billing may be down */ }
    }
    if (createdInvoiceId) {
      try { await kb.voidInvoice(createdInvoiceId); } catch { /* billing may be down */ }
    }
    throw err;
  });

  return { status: 201, body, replayed: false };
}


/** Assembles the Booking shape from the database. */
export async function bookingViewFromRows(client: PoolClient, ref: string): Promise<Record<string, unknown>> {
  const res = await client.query(
    `SELECT b.ref, b.state, b.locale, b.screening_id, b.admission_cents, b.gst_cents, b.qst_cents,
            b.uplift_cents, b.total_cents, b.credit_applied_cents, b.paid_cents, b.paid_at, b.group_booking
     FROM bookings b WHERE b.ref = $1`,
    [ref],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError('not_found');
  const screening = await client.query(
    `SELECT s.id, s.film_title, s.starts_at, s.auditorium FROM screenings s WHERE s.id = $1`,
    [row.screening_id],
  );
  const scr = screening.rows[0];
  const seatsRes = await client.query(
    `SELECT seat FROM tickets WHERE booking_ref=$1 ORDER BY substring(seat from 1 for 1), substring(seat from 2)::int`,
    [ref],
  );
  const tickets = await client.query(
    `SELECT code, seat, fare, status FROM tickets WHERE booking_ref=$1
     ORDER BY substring(seat from 1 for 1), substring(seat from 2)::int`,
    [ref],
  );
  const lines = await client.query(
    'SELECT fare, quantity, unit_cents, subtotal_cents, gst_cents, qst_cents FROM booking_lines WHERE booking_ref=$1',
    [ref],
  );
  const split = await client.query(
    'SELECT name, seats, share_cents FROM cost_splits WHERE booking_ref=$1 ORDER BY position',
    [ref],
  );
  return {
    ref: row.ref,
    state: row.state,
    locale: row.locale,
    screening: {
      id: scr.id,
      film_title: scr.film_title,
      starts_at: iso(DateTime.fromJSDate(scr.starts_at)),
      auditorium: scr.auditorium,
    },
    seats: seatSort(seatsRes.rows.map((s: { seat: string }) => s.seat)),
    tickets: tickets.rows.map((t: { code: string; seat: string; fare: string; status: string }) => ({
      code: t.code, seat: t.seat, fare: t.fare, status: t.status,
    })),
    lines: lines.rows.map((l: Record<string, never>) => ({
      fare: l.fare, quantity: Number(l.quantity), unit_cents: l.unit_cents,
      subtotal_cents: l.subtotal_cents, gst_cents: l.gst_cents, qst_cents: l.qst_cents,
    })),
    admission_cents: row.admission_cents,
    gst_cents: row.gst_cents,
    qst_cents: row.qst_cents,
    uplift_cents: row.uplift_cents,
    total_cents: row.total_cents,
    credit_applied_cents: row.credit_applied_cents,
    paid_cents: row.paid_cents,
    currency: 'CAD',
    split: row.group_booking && split.rows.length > 0
      ? split.rows.map((p: { name: string; seats: number; share_cents: number }) => ({
          name: p.name, seats: Number(p.seats), share_cents: p.share_cents,
        }))
      : null,
    paid_at: row.paid_at ? iso(DateTime.fromJSDate(row.paid_at)) : null,
  };
}

export async function bookingView(ref: string): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => bookingViewFromRows(client, ref));
}
