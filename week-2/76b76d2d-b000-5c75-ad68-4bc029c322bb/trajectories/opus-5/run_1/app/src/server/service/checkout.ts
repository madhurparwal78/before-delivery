import type { Locale } from '../../shared/money.ts';
import { sortSeats, type Fare } from '../../shared/domain.ts';
import { transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { assertBillingUp } from './guard.ts';
import { Validator } from '../http/validate.ts';
import { bookingRef as newBookingRef, capabilityToken, ticketCode } from '../domain/ids.ts';
import { admissionTotals, creditApplied, splitShares, type PayerShare } from '../domain/pricing.ts';
import { torontoDate, torontoTime } from '../domain/time.ts';
import { getScreening } from '../repo/screenings.ts';
import { bookingById, bookingPayload, type BookingPayload } from '../repo/bookings.ts';
import { creditBalance, writeMovement } from '../repo/credit.ts';
import { ensureGuestBillingAccount, ensurePatronBillingAccount } from '../repo/accounts.ts';
import { createChargeInvoice, payInvoice, voidInvoice, type ChargeInput } from '../killbill/client.ts';
import { enqueueMail } from '../mail/outbox.ts';
import { appLink, bookingConfirmationEmail } from '../mail/templates.ts';
import type { SessionAccount } from '../http/context.ts';
import { activeTier, hasLiveVerification } from './membership.ts';
import { assertHoldUsable, fareContext, getHold, holdSeats, lockHold, ownsHold, validateFares, validateUplift, type Owner } from './holds.ts';

export type CheckoutResult = { booking: BookingPayload; guest_link: string | null };

function validatePayers(value: unknown, seatCount: number, validator: Validator): Array<{ name: string; seats: number }> {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) {
    validator.add('split', 'field_split', { n: seatCount });
    return [];
  }
  const payers: Array<{ name: string; seats: number }> = [];
  value.forEach((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const name = validator.text(`split.${index}.name`, record.name, 1, 80);
    const seats = validator.integer(`split.${index}.seats`, record.seats, 1, 40);
    payers.push({ name, seats });
  });
  const total = payers.reduce((sum, payer) => sum + payer.seats, 0);
  if (total !== seatCount) validator.add('split', 'field_split', { n: seatCount });
  return payers;
}

export async function checkout(input: {
  account: SessionAccount | null;
  sessionToken: string | null;
  owner: Owner;
  locale: Locale;
  body: Record<string, unknown>;
  now: Date;
}): Promise<CheckoutResult> {
  const holdIdValue = typeof input.body.hold_id === 'string' ? input.body.hold_id : '';
  const hold = holdIdValue === '' ? null : await getHold(holdIdValue);
  if (hold === null || !ownsHold(hold, input.owner)) throw new ApiError('not_found');
  assertHoldUsable(hold, input.now);

  const seats = await holdSeats(hold.id);
  const tier = await activeTier(input.account?.id ?? null);
  const context = fareContext(hold, tier);
  const validator = new Validator();
  const fares = validateFares(seats, input.body.fares, context, validator);
  const uplift = validateUplift(input.body.uplift_cents, validator);
  const note = validator.optionalText('note', input.body.note, 200);

  let payers: Array<{ name: string; seats: number }> = [];
  if (hold.is_group) payers = validatePayers(input.body.split, seats.length, validator);

  const guest = (input.body.guest ?? {}) as Record<string, unknown>;
  const name = input.account === null ? validator.text('guest.name', guest.name, 1, 80) : input.account.name;
  const email = input.account === null ? validator.email('guest.email', guest.email) : input.account.email;
  const phone = input.account === null ? validator.phone('guest.phone', guest.phone) : null;

  const totals = admissionTotals(fares, uplift);
  const balance = await creditBalance(input.account?.number ?? null);
  const credit = creditApplied(balance, totals.total_cents);
  const payNow = totals.total_cents - credit;
  const cardholder =
    payNow > 0
      ? validator.text('cardholder_name', input.body.cardholder_name, 1, 80)
      : validator.optionalText('cardholder_name', input.body.cardholder_name, 80);
  validator.check();

  if (credit > 0 && !(await hasLiveVerification(input.sessionToken, input.now))) {
    throw new ApiError('stepup_required');
  }
  assertBillingUp();

  const screening = await getScreening(hold.screening_id);
  if (screening === null) throw new ApiError('not_found');

  const ref = newBookingRef();
  const charges: ChargeInput[] = totals.lines.map((line) => ({
    description: `${ref} ADM ${line.fare} x${line.quantity}`,
    amount_cents: line.subtotal_cents,
  }));
  if (uplift > 0) charges.push({ description: `${ref} UPLIFT`, amount_cents: uplift });
  const taxes: ChargeInput[] = totals.lines.flatMap((line) => [
    { description: `${ref} GST ${line.fare}`, amount_cents: line.gst_cents },
    { description: `${ref} QST ${line.fare}`, amount_cents: line.qst_cents },
  ]);

  const kbAccountId =
    input.account === null
      ? await ensureGuestBillingAccount({ name, email, locale: input.locale })
      : await ensurePatronBillingAccount(input.account);

  const token = input.account === null ? capabilityToken() : null;
  const shares: PayerShare[] = hold.is_group ? splitShares(totals.total_cents, payers) : [];
  let invoiceId: string | null = null;

  const bookingId = await transaction(async (tx) => {
    const locked = await lockHold(tx, hold.id);
    if (locked === null) throw new ApiError('not_found');
    if (locked.state === 'paid') throw new ApiError('hold_already_paid');
    if (locked.state !== 'held' || input.now.getTime() >= locked.expires_at.getTime()) {
      throw new ApiError('hold_expired');
    }
    const invoice = await createChargeInvoice(kbAccountId, charges, taxes);
    invoiceId = invoice.invoice_id;
    const creditFromBilling = invoice.credit_applied_cents;
    const paidCents = invoice.balance_cents;
    const paymentId = paidCents > 0 ? await payInvoice(kbAccountId, invoice.invoice_id, paidCents) : null;
    const booking = await tx.one<{ id: number }>(
      `insert into bookings(ref, screening_id, account_id, hold_id, state, locale, is_group, name, email, phone,
         note, cardholder_name, admission_cents, gst_cents, qst_cents, uplift_cents, total_cents,
         credit_applied_cents, paid_cents, kb_invoice_id, kb_payment_id, paid_at, guest_token, guest_token_seq)
       values($1,$2,$3,$4,'paid',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now(), $21, $22)
       returning id`,
      [
        ref,
        hold.screening_id,
        input.account?.id ?? null,
        hold.id,
        input.locale,
        hold.is_group,
        name,
        email,
        phone,
        note,
        cardholder,
        totals.admission_cents,
        totals.gst_cents,
        totals.qst_cents,
        totals.uplift_cents,
        totals.total_cents,
        creditFromBilling,
        paidCents,
        invoiceId,
        paymentId,
        token,
        token === null ? 0 : 1,
      ],
    );
    const id = booking!.id;
    let position = 0;
    for (const line of totals.lines) {
      position += 1;
      await tx.query(
        `insert into booking_lines(booking_id, position, fare, quantity, unit_cents, subtotal_cents, gst_cents, qst_cents)
           values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, position, line.fare, line.quantity, line.unit_cents, line.subtotal_cents, line.gst_cents, line.qst_cents],
      );
    }
    let payerPosition = 0;
    for (const share of shares) {
      payerPosition += 1;
      await tx.query(
        'insert into booking_payers(booking_id, position, name, seats, share_cents) values($1,$2,$3,$4,$5)',
        [id, payerPosition, share.name, share.seats, share.share_cents],
      );
    }
    const tickets: Array<{ code: string; seat: string; fare: Fare }> = [];
    for (const seat of sortSeats(seats)) {
      const code = ticketCode();
      tickets.push({ code, seat, fare: fares[seat] });
      await tx.query(
        `insert into tickets(code, booking_id, screening_id, seat, fare, status) values($1,$2,$3,$4,$5,'issued')`,
        [code, id, hold.screening_id, seat, fares[seat]],
      );
      await tx.query(
        `update seat_claims set sold = true, booking_id = $3, hold_id = null, expires_at = null
           where screening_id = $1 and seat = $2`,
        [hold.screening_id, seat, id],
      );
    }
    await tx.query("update holds set state='paid', booking_id=$2 where id=$1", [hold.id, id]);
    if (creditFromBilling > 0 && input.account?.number != null) {
      await writeMovement(tx, {
        accountNumber: input.account.number,
        kind: 'spend',
        amountCents: creditFromBilling,
        reference: ref,
      });
    }
    await enqueueMail(
      tx,
      bookingConfirmationEmail({
        ref,
        locale: input.locale,
        email,
        film_title: screening.film_title,
        date: torontoDate(screening.starts_at),
        time: torontoTime(screening.starts_at),
        auditorium_name: screening.auditorium_name,
        auditorium_code: screening.auditorium_code,
        seats: sortSeats(seats),
        tickets,
        admission_cents: totals.admission_cents,
        gst_cents: totals.gst_cents,
        qst_cents: totals.qst_cents,
        uplift_cents: totals.uplift_cents,
        credit_applied_cents: creditFromBilling,
        total_cents: totals.total_cents,
        paid_cents: paidCents,
        payers: shares.map((share) => ({ name: share.name, share_cents: share.share_cents })),
        link:
          token === null
            ? appLink(input.locale, `/account/bookings/${ref}`)
            : appLink(input.locale, `/b/${token}`),
        guest: token !== null,
      }),
    );
    return id;
  }).catch(async (error: unknown) => {
    if (invoiceId !== null) await voidInvoice(invoiceId).catch(() => undefined);
    throw error;
  });

  const row = await bookingById(bookingId);
  return {
    booking: await bookingPayload(row!),
    guest_link: token === null ? null : `/${input.locale}/b/${token}`,
  };
}
