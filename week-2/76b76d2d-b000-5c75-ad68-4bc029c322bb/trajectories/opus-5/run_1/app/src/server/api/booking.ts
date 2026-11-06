import { one } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { route } from '../http/router.ts';
import { sendJson } from '../http/respond.ts';
import { Validator, requireIdempotencyKey } from '../http/validate.ts';
import { bodyHash, claimKey, finishKey, releaseKey } from '../http/idempotency.ts';
import { assertBillingUp } from '../service/guard.ts';
import { capabilityToken } from '../domain/ids.ts';
import {
  assertHoldUsable,
  buildQuote,
  createHold,
  getHold,
  holdPayload,
  ownsHold,
  quotePayload,
  rememberQuoteTotal,
  releaseHold,
  type Owner,
} from '../service/holds.ts';
import { checkout } from '../service/checkout.ts';
import { activeTier } from '../service/membership.ts';
import { bookingByGuestToken, bookingByRef, bookingPayload, bookingsForAccount } from '../repo/bookings.ts';
import { refundBooking } from '../service/refunds.ts';
import { enqueueMail, nextMailSequence } from '../mail/outbox.ts';
import { bookingLinkEmail } from '../mail/templates.ts';
import { transaction } from '../db/pool.ts';
import type { Ctx } from '../http/context.ts';

function ownerOf(ctx: Ctx): Owner {
  return { accountId: ctx.account?.id ?? null, guestKey: ctx.guestKey };
}

async function serverNow(): Promise<Date> {
  const row = await one<{ now: Date }>('select now() as now');
  return row!.now;
}

route('POST', '/api/holds', 'anyone', async (ctx) => {
  const tier = await activeTier(ctx.account?.id ?? null);
  const { hold, now } = await createHold({
    screeningId: ctx.body.screening_id,
    seats: ctx.body.seats,
    group: ctx.body.group,
    owner: ownerOf(ctx),
    tier,
  });
  sendJson(ctx.res, 201, { hold: await holdPayload(hold, now) });
});

route('GET', '/api/holds/:id', 'anyone', async (ctx) => {
  const hold = await getHold(ctx.params.id);
  if (hold === null || !ownsHold(hold, ownerOf(ctx))) throw new ApiError('not_found');
  sendJson(ctx.res, 200, { hold: await holdPayload(hold, await serverNow()) });
});

route('POST', '/api/holds/:id/quote', 'anyone', async (ctx) => {
  const hold = await getHold(ctx.params.id);
  if (hold === null || !ownsHold(hold, ownerOf(ctx))) throw new ApiError('not_found');
  const now = await serverNow();
  assertHoldUsable(hold, now);
  const quote = await buildQuote({
    hold,
    accountId: ctx.account?.id ?? null,
    accountNumber: ctx.account?.number ?? null,
    sessionToken: ctx.sessionToken,
    fares: ctx.body.fares,
    uplift: ctx.body.uplift_cents,
    now,
  });
  await rememberQuoteTotal(hold.id, quote.totals.total_cents);
  sendJson(ctx.res, 200, { quote: quotePayload(quote) });
});

route('DELETE', '/api/holds/:id', 'anyone', async (ctx) => {
  const hold = await getHold(ctx.params.id);
  if (hold === null || !ownsHold(hold, ownerOf(ctx))) throw new ApiError('not_found');
  const now = await serverNow();
  assertHoldUsable(hold, now);
  assertBillingUp();
  const released = await releaseHold(hold);
  const updated = await getHold(hold.id);
  sendJson(ctx.res, 200, {
    hold: await holdPayload(updated!, now),
    released_amount: { cents: released, currency: 'CAD' },
  });
});

route('POST', '/api/checkout', 'anyone', async (ctx) => {
  const owner = ownerOf(ctx);
  const holdIdValue = typeof ctx.body.hold_id === 'string' ? ctx.body.hold_id : '';
  const hold = holdIdValue === '' ? null : await getHold(holdIdValue);
  if (hold === null || !ownsHold(hold, owner)) throw new ApiError('not_found');

  const key = requireIdempotencyKey(ctx.req.headers['idempotency-key'] as string | undefined);
  const caller = ctx.account === null ? `guest:${ctx.guestKey ?? ''}` : `account:${ctx.account.id}`;
  const replay = await claimKey({ key, caller, endpoint: 'checkout', hash: bodyHash(ctx.rawBody) });
  if (replay !== null) {
    ctx.res.setHeader('Idempotent-Replayed', 'true');
    sendJson(ctx.res, replay.status, replay.body);
    return;
  }
  try {
    const now = await serverNow();
    assertHoldUsable(hold, now);
    const result = await checkout({
      account: ctx.account,
      sessionToken: ctx.sessionToken,
      owner,
      locale: ctx.locale,
      body: ctx.body,
      now,
    });
    await finishKey(key, 201, result);
    sendJson(ctx.res, 201, result);
  } catch (error) {
    await releaseKey(key);
    throw error;
  }
});

route('GET', '/api/bookings', 'patron', async (ctx) => {
  const rows = await bookingsForAccount(ctx.account!.id);
  const bookings = [];
  for (const row of rows) bookings.push(await bookingPayload(row));
  sendJson(ctx.res, 200, { bookings });
});

route('GET', '/api/bookings/:ref', 'patron', async (ctx) => {
  const booking = await bookingByRef(ctx.params.ref);
  if (booking === null || booking.account_id !== ctx.account!.id) throw new ApiError('not_found');
  sendJson(ctx.res, 200, { booking: await bookingPayload(booking) });
});

route('POST', '/api/bookings/:ref/refund', 'patron', async (ctx) => {
  const booking = await bookingByRef(ctx.params.ref);
  if (booking === null || booking.account_id !== ctx.account!.id) throw new ApiError('not_found');
  const now = await serverNow();
  assertBillingUp();
  const refund = await refundBooking({
    booking,
    now,
    actor: ctx.account!.number ?? 'guest',
    reason: { kind: 'patron' },
    auditReason: 'Requested by the patron',
    enforceWindow: true,
  });
  sendJson(ctx.res, 200, {
    refund: {
      booking_ref: refund.booking_ref,
      refunded_cents: refund.refunded_cents,
      recredited_cents: refund.recredited_cents,
      currency: 'CAD',
      state: 'refunded',
    },
  });
});

route('GET', '/api/guest/bookings/:token', 'anyone', async (ctx) => {
  const booking = await bookingByGuestToken(ctx.params.token);
  if (booking === null) throw new ApiError('not_found');
  sendJson(ctx.res, 200, { booking: await bookingPayload(booking) });
});

route('POST', '/api/guest/bookings/:token/refund', 'anyone', async (ctx) => {
  const booking = await bookingByGuestToken(ctx.params.token);
  if (booking === null) throw new ApiError('not_found');
  const now = await serverNow();
  assertBillingUp();
  const refund = await refundBooking({
    booking,
    now,
    actor: 'guest',
    reason: { kind: 'patron' },
    auditReason: 'Requested by the patron',
    enforceWindow: true,
  });
  sendJson(ctx.res, 200, {
    refund: {
      booking_ref: refund.booking_ref,
      refunded_cents: refund.refunded_cents,
      recredited_cents: refund.recredited_cents,
      currency: 'CAD',
      state: 'refunded',
    },
  });
});

route('POST', '/api/guest/booking-links', 'anyone', async (ctx) => {
  const validator = new Validator();
  const ref = validator.text('booking_ref', ctx.body.booking_ref, 3, 40);
  const email = validator.email('email', ctx.body.email);
  validator.check();
  const booking = await bookingByRef(ref);
  if (
    booking !== null &&
    booking.account_id === null &&
    booking.email.toLowerCase() === email.toLowerCase() &&
    (booking.state === 'paid' || booking.state === 'checked-in')
  ) {
    const token = capabilityToken();
    await transaction(async (tx) => {
      await tx.query('update bookings set guest_token = $2, guest_token_seq = guest_token_seq + 1 where id = $1', [
        booking.id,
        token,
      ]);
      const sequence = await nextMailSequence(tx, `booking-link:${booking.ref}:`);
      await enqueueMail(
        tx,
        bookingLinkEmail({
          ref: booking.ref,
          email: booking.email,
          locale: booking.locale,
          token,
          sequence,
        }),
      );
    });
  }
  sendJson(ctx.res, 202, { status: 'accepted' });
});
