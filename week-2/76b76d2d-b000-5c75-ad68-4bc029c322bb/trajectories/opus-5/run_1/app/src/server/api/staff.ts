import { AUDITORIUMS, FORMATS, GOODWILL_MAX, GOODWILL_MIN } from '../../shared/domain.ts';
import { one, query, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { route } from '../http/router.ts';
import { sendJson } from '../http/respond.ts';
import { Validator } from '../http/validate.ts';
import { assertBillingUp } from '../service/guard.ts';
import { addCalendarDays, instantFromLocalString, toIso, toIsoMillis, torontoDate, torontoLocal } from '../domain/time.ts';
import { derivedState, isLegalTransition, type TransitionTarget } from '../domain/seasons.ts';
import { auditEntries, writeAudit } from '../repo/audit.ts';
import { creditBalance, creditMovements, writeMovement } from '../repo/credit.ts';
import { accountByNumber, ensurePatronBillingAccount } from '../repo/accounts.ts';
import { addAccountCredit } from '../killbill/client.ts';
import { bookingByRef, bookingByTicketCode, bookingPayload, type BookingRow } from '../repo/bookings.ts';
import { getSeason, nextSequence, seasonScreenings, seasonSummaries } from '../repo/screenings.ts';
import { checkInBooking, checkInTicket, doorList, doorScreenings } from '../service/door.ts';
import { refundBooking } from '../service/refunds.ts';
import { acceptReconciliation, reconciliationCsv, reconciliationFor } from '../service/reconciliation.ts';
import { giftByRef, giftPayload } from '../service/gifts.ts';
import { activeMembership, membershipPayload } from '../service/membership.ts';
import { enqueueMail, nextMailSequence } from '../mail/outbox.ts';
import { enquiryReplyEmail } from '../mail/templates.ts';
import type { Locale } from '../../shared/money.ts';

async function serverNow(): Promise<Date> {
  const row = await one<{ now: Date }>('select now() as now');
  return row!.now;
}

// Door
route('GET', '/api/door/screenings', 'door', async (ctx) => {
  sendJson(ctx.res, 200, { screenings: await doorScreenings() });
});

route('GET', '/api/door/screenings/:id/list', 'door', async (ctx) => {
  const screening = await one<{ id: string; film_title: string; starts_at: Date; auditorium_code: string }>(
    'select id, film_title, starts_at, auditorium_code from screenings where id = $1',
    [ctx.params.id],
  );
  if (screening === null) throw new ApiError('not_found');
  sendJson(ctx.res, 200, {
    screening: {
      id: screening.id,
      film_title: screening.film_title,
      starts_at: toIso(screening.starts_at),
      auditorium: screening.auditorium_code,
    },
    tickets: await doorList(screening.id),
  });
});

route('POST', '/api/door/tickets/:code/check-in', 'door', async (ctx) => {
  sendJson(ctx.res, 200, await checkInTicket(ctx.params.code, await serverNow()));
});

route('POST', '/api/door/bookings/:ref/check-in', 'door', async (ctx) => {
  sendJson(ctx.res, 200, await checkInBooking(ctx.params.ref, await serverNow()));
});

// Programmer
route('GET', '/api/programmer/seasons', 'programmer', async (ctx) => {
  const now = await serverNow();
  const summaries = await seasonSummaries(ctx.locale, now);
  const seasons = [];
  for (const season of summaries) {
    seasons.push({ ...season, screenings: await seasonScreenings(season.slug, { futureOnly: false, now }) });
  }
  sendJson(ctx.res, 200, { seasons });
});

route('POST', '/api/programmer/seasons', 'programmer', async (ctx) => {
  const validator = new Validator();
  const slug = validator.text('slug', ctx.body.slug, 3, 40);
  if (slug !== '' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) validator.add('slug', 'field_enum');
  const titleEn = validator.text('title_en', ctx.body.title_en, 1, 120);
  const titleFr = validator.text('title_fr', ctx.body.title_fr, 1, 120);
  const saleDate = validator.date('public_sale_date', ctx.body.public_sale_date);
  validator.check();
  const existing = await one<{ slug: string }>('select slug from seasons where slug = $1', [slug]);
  if (existing !== null) throw new ApiError('slug_taken');
  await query(
    `insert into seasons(slug, title_en, title_fr, public_sale_date, stored_state) values($1,$2,$3,$4,'draft')`,
    [slug, titleEn, titleFr, saleDate],
  );
  const now = await serverNow();
  const summaries = await seasonSummaries(ctx.locale, now);
  sendJson(ctx.res, 201, { season: summaries.find((season) => season.slug === slug) });
});

route('POST', '/api/programmer/seasons/:slug/screenings', 'programmer', async (ctx) => {
  const season = await getSeason(ctx.params.slug);
  if (season === null) throw new ApiError('not_found');
  const now = await serverNow();
  const state = derivedState(season.stored_state, season.public_sale_date, now);
  if (state === 'archived' || state === 'withdrawn') throw new ApiError('season_closed');
  const validator = new Validator();
  const filmTitle = validator.text('film_title', ctx.body.film_title, 1, 120);
  const format = validator.enumValue('format', ctx.body.format, FORMATS);
  const auditorium = validator.enumValue('auditorium', ctx.body.auditorium, AUDITORIUMS);
  const firstLocal = validator.localDateTime('first_local', ctx.body.first_local);
  const weeks = validator.integer('weeks', ctx.body.weeks ?? 1, 1, 26);
  validator.check();

  const created: Array<{ id: string; starts_local: string; starts_at: string }> = [];
  await transaction(async (tx) => {
    let sequence = await nextSequence(tx, season.slug);
    const [datePart, timePart] = firstLocal.split('T');
    for (let week = 0; week < weeks; week += 1) {
      const date = addCalendarDays(datePart, week * 7);
      const startsAt = instantFromLocalString(`${date}T${timePart}`);
      const id = `${season.slug}-${sequence}`;
      await tx.query(
        `insert into screenings(id, season_slug, sequence, film_title, format, auditorium_code, starts_at)
           values($1,$2,$3,$4,$5,$6,$7)`,
        [id, season.slug, sequence, filmTitle, format, auditorium, startsAt.toISOString()],
      );
      created.push({ id, starts_local: torontoLocal(startsAt), starts_at: toIso(startsAt) });
      sequence += 1;
    }
  });
  sendJson(ctx.res, 201, { screenings: created });
});

route('POST', '/api/programmer/seasons/:slug/transition', 'programmer', async (ctx) => {
  const season = await getSeason(ctx.params.slug);
  if (season === null) throw new ApiError('not_found');
  const now = await serverNow();
  const from = derivedState(season.stored_state, season.public_sale_date, now);
  const validator = new Validator();
  const to = validator.enumValue('to', ctx.body.to, ['scheduled', 'archived', 'withdrawn'] as TransitionTarget[]);
  const reason = to === 'withdrawn' ? validator.text('reason', ctx.body.reason, 3, 500) : '';
  validator.check();
  if (!isLegalTransition(from, to)) {
    throw new ApiError('illegal_transition', { args: { from, to } });
  }

  let refunded = 0;
  if (to === 'scheduled') {
    const count = await one<{ count: number }>('select count(*)::int as count from screenings where season_slug = $1', [
      season.slug,
    ]);
    if ((count?.count ?? 0) === 0) throw new ApiError('season_empty');
    await query("update seasons set stored_state='scheduled' where slug = $1", [season.slug]);
  } else if (to === 'archived') {
    const future = await one<{ count: number }>(
      'select count(*)::int as count from screenings where season_slug = $1 and starts_at > now()',
      [season.slug],
    );
    if ((future?.count ?? 0) > 0) throw new ApiError('season_has_future_screenings');
    await query("update seasons set stored_state='archived' where slug = $1", [season.slug]);
  } else {
    assertBillingUp();
    refunded = await withdrawSeason(season.slug, ctx.locale, reason, ctx.account!.email, now);
  }

  const summaries = await seasonSummaries(ctx.locale, await serverNow());
  sendJson(ctx.res, 200, {
    season: summaries.find((candidate) => candidate.slug === season.slug),
    refunded_bookings: refunded,
  });
});

async function withdrawSeason(
  slug: string,
  locale: Locale,
  reason: string,
  actor: string,
  now: Date,
): Promise<number> {
  const season = await getSeason(slug);
  if (season === null) throw new ApiError('not_found');
  const title = locale === 'fr' ? season.title_fr : season.title_en;
  await query(
    `update holds set state='expired', ended_by='season'
       where state='held' and screening_id in (select id from screenings where season_slug = $1)`,
    [slug],
  );
  await query(
    `delete from seat_claims where sold = false and screening_id in (select id from screenings where season_slug = $1)`,
    [slug],
  );
  const paid = await query<BookingRow>(
    `select b.*, s.film_title, s.starts_at, s.auditorium_code, s.season_slug, a.name as auditorium_name
       from bookings b join screenings s on s.id = b.screening_id
       join auditoriums a on a.code = s.auditorium_code
      where s.season_slug = $1 and b.state = 'paid' order by b.id asc`,
    [slug],
  );
  let total = 0;
  let count = 0;
  for (const booking of paid) {
    const outcome = await refundBooking({
      booking,
      now,
      actor,
      reason: { kind: 'season', title: booking.locale === 'fr' ? season.title_fr : season.title_en },
      auditReason: `Season withdrawn: ${title}`,
      enforceWindow: false,
    });
    total += outcome.refunded_cents;
    count += 1;
  }
  await transaction(async (tx) => {
    await tx.query("update seasons set stored_state='withdrawn', withdrawn_reason=$2 where slug = $1", [slug, reason]);
    await writeAudit(tx, {
      actor,
      action: 'season-withdraw',
      target: slug,
      amountCents: total,
      reason,
    });
  });
  return count;
}

// Finance
route('GET', '/api/finance/lookup', 'finance', async (ctx) => {
  const rawQuery = (ctx.url.searchParams.get('q') ?? '').trim();
  if (rawQuery === '') throw new ApiError('not_found');
  const booking = (await bookingByRef(rawQuery)) ?? (await bookingByTicketCode(rawQuery));
  if (booking !== null) {
    const patron =
      booking.account_id === null
        ? null
        : await one<{ number: string | null }>('select number from accounts where id = $1', [booking.account_id]);
    sendJson(ctx.res, 200, {
      kind: 'booking',
      booking: await bookingPayload(booking),
      patron: {
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        account_number: patron?.number ?? null,
      },
    });
    return;
  }
  const gift = await giftByRef(rawQuery);
  if (gift !== null) {
    sendJson(ctx.res, 200, { kind: 'gift', gift: giftPayload(gift) });
    return;
  }
  const account =
    (await accountByNumber(rawQuery)) ??
    (await one<{
        id: number;
        number: string;
        name: string;
        email: string;
        locale: Locale;
        role: string;
        kb_account_id: string | null;
      }>(
        `select id, number, name, email, locale, role, kb_account_id from accounts
           where lower(email) = lower($1) and number is not null`,
        [rawQuery],
      ));
  if (account !== null) {
    const membership = await activeMembership(account.id);
    sendJson(ctx.res, 200, {
      kind: 'account',
      account: {
        number: account.number,
        name: account.name,
        email: account.email,
        locale: account.locale,
        role: account.role,
        membership: membershipPayload(membership),
        credit_balance_cents: await creditBalance(account.number),
      },
      ledger: await creditMovements(account.number),
    });
    return;
  }
  throw new ApiError('not_found');
});

route('POST', '/api/finance/bookings/:ref/refund', 'finance', async (ctx) => {
  const booking = await bookingByRef(ctx.params.ref);
  if (booking === null) throw new ApiError('not_found');
  const validator = new Validator();
  const reason = validator.text('reason', ctx.body.reason, 3, 500);
  validator.check();
  assertBillingUp();
  const refund = await refundBooking({
    booking,
    now: await serverNow(),
    actor: ctx.account!.email,
    reason: { kind: 'boxoffice' },
    auditReason: reason,
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
    audit_id: refund.audit_id,
  });
});

route('POST', '/api/finance/credits', 'finance', async (ctx) => {
  const validator = new Validator();
  const accountNumber = validator.text('account_number', ctx.body.account_number, 3, 20);
  const amount = validator.integer('amount_cents', ctx.body.amount_cents, GOODWILL_MIN, GOODWILL_MAX, 'field_credit');
  const reason = validator.text('reason', ctx.body.reason, 3, 500);
  const account = await accountByNumber(accountNumber);
  if (account === null) throw new ApiError('not_found');
  validator.check();
  assertBillingUp();

  const kbAccountId = await ensurePatronBillingAccount({
    id: account.id,
    number: account.number,
    name: account.name,
    email: account.email,
    locale: account.locale,
    kb_account_id: account.kb_account_id,
  });
  const result = await transaction(async (tx) => {
    const auditId = await writeAudit(tx, {
      actor: ctx.account!.email,
      action: 'goodwill-credit',
      target: account.number,
      amountCents: amount,
      reason,
    });
    const movementId = await writeMovement(tx, {
      accountNumber: account.number,
      kind: 'goodwill',
      amountCents: amount,
      reference: `GOODWILL ${auditId}`,
    });
    return { auditId, movementId };
  });
  await addAccountCredit(kbAccountId, amount, `GOODWILL ${result.auditId}`);
  sendJson(ctx.res, 201, {
    credit: {
      account_number: account.number,
      amount_cents: amount,
      currency: 'CAD',
      balance_cents: await creditBalance(account.number),
      movement_id: result.movementId,
      audit_id: result.auditId,
    },
  });
});

route('GET', '/api/finance/audit', 'finance', async (ctx) => {
  sendJson(ctx.res, 200, { entries: await auditEntries() });
});

route('GET', '/api/finance/audit/:id', 'finance', async (ctx) => {
  const entry = await one('select id, at, actor, action, target, amount_cents, reason from audit_log where id = $1', [
    Number(ctx.params.id),
  ]);
  if (entry === null) throw new ApiError('not_found');
  sendJson(ctx.res, 200, { entry });
});

route('GET', '/api/finance/reconciliation', 'finance', async (ctx) => {
  const date = ctx.url.searchParams.get('date');
  const validator = new Validator();
  const day = date === null ? torontoDate(await serverNow()) : validator.date('date', date);
  validator.check();
  assertBillingUp();
  sendJson(ctx.res, 200, await reconciliationFor(day));
});

route('GET', '/api/finance/reconciliation.csv', 'finance', async (ctx) => {
  const date = ctx.url.searchParams.get('date');
  const validator = new Validator();
  const day = date === null ? torontoDate(await serverNow()) : validator.date('date', date);
  validator.check();
  assertBillingUp();
  const csv = await reconciliationCsv(day);
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="halide-takings-${day}.csv"`,
    'Content-Length': Buffer.byteLength(csv),
    'Cache-Control': 'no-store',
  });
  ctx.res.end(csv);
});

route('POST', '/api/finance/reconciliation/accept', 'finance', async (ctx) => {
  const validator = new Validator();
  const date = validator.date('date', ctx.body.date);
  const reason = validator.text('reason', ctx.body.reason, 3, 500);
  validator.check();
  assertBillingUp();
  sendJson(
    ctx.res,
    200,
    await acceptReconciliation({ date, reason, actor: ctx.account!.email }),
  );
});

route('GET', '/api/finance/outbox', 'finance', async (ctx) => {
  const rows = await query<{
    seq: number;
    message_key: string;
    kind: string;
    recipient: string;
    subject: string;
    enqueued_at: Date;
    state: string;
  }>(
    `select seq, message_key, kind, recipient, subject, enqueued_at, state from outbox
       order by seq desc limit 200`,
  );
  const attempts = await query<{ outbox_seq: number; started_at: Date; finished_at: Date; outcome: string }>(
    'select outbox_seq, started_at, finished_at, outcome from outbox_attempts order by id asc',
  );
  const messages = rows
    .sort((a, b) => a.seq - b.seq)
    .map((row) => ({
      seq: row.seq,
      key: row.message_key,
      kind: row.kind,
      to: row.recipient,
      subject: row.subject,
      enqueued_at: toIsoMillis(row.enqueued_at),
      state: row.state,
      attempts: attempts
        .filter((attempt) => attempt.outbox_seq === row.seq)
        .map((attempt) => ({
          started_at: toIsoMillis(attempt.started_at),
          finished_at: toIsoMillis(attempt.finished_at),
          outcome: attempt.outcome,
        })),
    }));
  sendJson(ctx.res, 200, { messages });
});

route('GET', '/api/finance/enquiries', 'finance', async (ctx) => {
  const rows = await query<{
    ref: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    locale: string;
    state: string;
    received_at: Date;
  }>(
    `select ref, name, email, subject, message, locale, state, received_at from enquiries
       order by id desc`,
  );
  sendJson(ctx.res, 200, {
    enquiries: rows.map((row) => ({ ...row, received_at: toIso(row.received_at) })),
  });
});

route('POST', '/api/finance/enquiries/:ref/reply', 'finance', async (ctx) => {
  const enquiry = await one<{
    id: number;
    ref: string;
    email: string;
    subject: string;
    locale: Locale;
  }>('select id, ref, email, subject, locale from enquiries where upper(ref) = upper($1)', [ctx.params.ref]);
  if (enquiry === null) throw new ApiError('not_found');
  const validator = new Validator();
  const body = validator.text('body', ctx.body.body, 1, 4000);
  validator.check();
  const queuedAt = await transaction(async (tx) => {
    const sequence = await nextMailSequence(tx, `enquiry-reply:${enquiry.ref}:`);
    await enqueueMail(
      tx,
      enquiryReplyEmail({
        ref: enquiry.ref,
        email: enquiry.email,
        locale: enquiry.locale,
        subject: enquiry.subject,
        body,
        sequence,
      }),
    );
    await tx.query("update enquiries set state='answered', reply_seq = reply_seq + 1 where id = $1", [enquiry.id]);
    await writeAudit(tx, {
      actor: ctx.account!.email,
      action: 'enquiry-reply',
      target: enquiry.ref,
      amountCents: null,
      reason: enquiry.subject,
    });
    const row = await tx.one<{ now: Date }>('select now() as now');
    return row!.now;
  });
  sendJson(ctx.res, 201, {
    reply: { enquiry_ref: enquiry.ref, queued_at: toIso(queuedAt) },
    enquiry: { ref: enquiry.ref, state: 'answered' },
  });
});
