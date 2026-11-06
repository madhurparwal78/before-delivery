import { LOCALES } from '../../shared/domain.ts';
import { one, query } from '../db/pool.ts';
import { schemaReady } from '../db/migrate.ts';
import { statusSnapshot } from '../services.ts';
import { route } from '../http/router.ts';
import { sendJson, sendNoContent, setCookie } from '../http/respond.ts';
import { LOCALE_COOKIE, SESSION_COOKIE } from '../http/context.ts';
import { ApiError } from '../http/errors.ts';
import { Validator } from '../http/validate.ts';
import { isSafePath } from '../http/safepath.ts';
import { toIso, torontoLocal } from '../domain/time.ts';
import { hashPassword, verifyPassword } from '../domain/passwords.ts';
import { enquiryRef, sessionToken } from '../domain/ids.ts';
import { seasonSummaries, stageSeasons, seasonScreenings, getScreening, getSeason, seatStates, seatCounts } from '../repo/screenings.ts';
import { nextAccountNumber } from '../repo/accounts.ts';
import { creditBalance, creditMovements } from '../repo/credit.ts';
import { activeMembership, membershipPayload } from '../service/membership.ts';
import { derivedState } from '../domain/seasons.ts';
import { liveHoldIdsFor } from '../service/holds.ts';

route('GET', '/api/health', 'anyone', async (ctx) => {
  if (!schemaReady()) {
    sendJson(ctx.res, 503, { status: 'starting' });
    return;
  }
  sendJson(ctx.res, 200, { status: 'ok' });
});

route('GET', '/api/status', 'anyone', async (ctx) => {
  const status = statusSnapshot();
  sendJson(ctx.res, 200, {
    billing: status.billing,
    mail: status.mail,
    checked_at: toIso(status.checkedAt),
  });
});

route('POST', '/api/locale', 'anyone', async (ctx) => {
  const validator = new Validator();
  const locale = validator.enumValue('locale', ctx.body.locale, LOCALES);
  validator.check();
  setCookie(ctx.res, LOCALE_COOKIE, locale, { httpOnly: false });
  if (ctx.account !== null) {
    await query('update accounts set locale = $2 where id = $1', [ctx.account.id, locale]);
  }
  sendNoContent(ctx.res);
});

route('GET', '/api/seasons', 'anyone', async (ctx) => {
  const now = new Date();
  const seasons = await stageSeasons(ctx.locale, now);
  sendJson(ctx.res, 200, { seasons });
});

route('GET', '/api/seasons/:slug', 'anyone', async (ctx) => {
  const now = new Date();
  const seasons = await seasonSummaries(ctx.locale, now);
  const season = seasons.find((candidate) => candidate.slug === ctx.params.slug);
  if (season === undefined || season.state === 'draft' || season.state === 'archived' || season.state === 'withdrawn') {
    throw new ApiError('not_found');
  }
  const screenings = await seasonScreenings(season.slug, { futureOnly: true, now });
  sendJson(ctx.res, 200, { season: { ...season, screenings } });
});

route('GET', '/api/screenings/:id', 'anyone', async (ctx) => {
  const screening = await getScreening(ctx.params.id);
  if (screening === null) throw new ApiError('not_found');
  const season = await getSeason(screening.season_slug);
  if (season === null) throw new ApiError('not_found');
  if (derivedState(season.stored_state, season.public_sale_date, new Date()) === 'draft') {
    throw new ApiError('not_found');
  }
  const mine = await liveHoldIdsFor({ accountId: ctx.account?.id ?? null, guestKey: ctx.guestKey }, screening.id);
  const seats = await seatStates(screening, mine);
  const counts = await seatCounts(screening.id, screening.capacity);
  sendJson(ctx.res, 200, {
    screening: {
      id: screening.id,
      season_slug: screening.season_slug,
      film_title: screening.film_title,
      format: screening.format,
      auditorium: {
        code: screening.auditorium_code,
        name: screening.auditorium_name,
        venue: screening.venue_name,
      },
      starts_at: toIso(screening.starts_at),
      starts_local: torontoLocal(screening.starts_at),
      capacity: screening.capacity,
      sold: counts.sold,
      held: counts.held,
      seats_remaining: counts.remaining,
      seats: seats.map((seat) => ({ code: seat.code, state: seat.state })),
    },
  });
});

route('POST', '/api/auth/signup', 'anyone', async (ctx) => {
  const validator = new Validator();
  const name = validator.text('name', ctx.body.name, 1, 80);
  const email = validator.email('email', ctx.body.email);
  const password = validator.password('password', ctx.body.password);
  const locale = validator.enumValue('locale', ctx.body.locale ?? ctx.locale, LOCALES);
  validator.check();
  const existing = await one<{ id: number }>('select id from accounts where lower(email) = lower($1)', [email]);
  if (existing !== null) throw new ApiError('email_taken');
  const number = await nextAccountNumber();
  const account = await one<{ id: number; number: string; name: string; email: string; locale: string }>(
    `insert into accounts(number, name, email, password_hash, role, locale)
       values($1,$2,$3,$4,'patron',$5) returning id, number, name, email, locale`,
    [number, name, email, hashPassword(password), locale],
  );
  const token = sessionToken();
  await query('insert into sessions(token, account_id) values($1,$2)', [token, account!.id]);
  setCookie(ctx.res, SESSION_COOKIE, token);
  setCookie(ctx.res, LOCALE_COOKIE, locale, { httpOnly: false });
  sendJson(ctx.res, 201, {
    account: {
      number: account!.number,
      name: account!.name,
      email: account!.email,
      locale: account!.locale,
      role: 'patron',
    },
  });
});

route('POST', '/api/auth/signin', 'anyone', async (ctx) => {
  const validator = new Validator();
  const email = validator.email('email', ctx.body.email);
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (password === '') validator.required('password');
  validator.check();
  const account = await one<{
    id: number;
    number: string | null;
    name: string;
    email: string;
    locale: string;
    role: string;
    password_hash: string;
  }>('select id, number, name, email, locale, role, password_hash from accounts where lower(email) = lower($1)', [
    email,
  ]);
  if (account === null || !verifyPassword(password, account.password_hash)) {
    throw new ApiError('invalid_credentials');
  }
  const token = sessionToken();
  await query('insert into sessions(token, account_id) values($1,$2)', [token, account.id]);
  setCookie(ctx.res, SESSION_COOKIE, token);
  const next = ctx.body.next;
  const fallback = account.role === 'patron' ? `/${account.locale}/account` : `/${account.locale}/staff`;
  sendJson(ctx.res, 200, {
    account: {
      number: account.number,
      name: account.name,
      email: account.email,
      locale: account.locale,
      role: account.role,
    },
    redirect: isSafePath(next) ? decodeURIComponent(next) : fallback,
  });
});

route('POST', '/api/auth/signout', 'session', async (ctx) => {
  if (ctx.sessionToken !== null) {
    await query('delete from sessions where token = $1', [ctx.sessionToken]);
    await query('delete from stepup_verifications where session_token = $1', [ctx.sessionToken]);
  }
  setCookie(ctx.res, SESSION_COOKIE, '', { maxAge: 0 });
  sendNoContent(ctx.res);
});

route('GET', '/api/me', 'session', async (ctx) => {
  const account = ctx.account!;
  const membership = await activeMembership(account.id);
  sendJson(ctx.res, 200, {
    account: {
      number: account.number,
      name: account.name,
      email: account.email,
      locale: account.locale,
      role: account.role,
      membership: membershipPayload(membership),
      credit_balance_cents: await creditBalance(account.number),
    },
  });
});

route('POST', '/api/enquiries', 'anyone', async (ctx) => {
  const validator = new Validator();
  const name = validator.text('name', ctx.body.name, 1, 80);
  const email = validator.email('email', ctx.body.email);
  const subject = validator.text('subject', ctx.body.subject, 1, 120);
  const message = validator.text('message', ctx.body.message, 1, 4000);
  validator.check();
  const ref = enquiryRef();
  await query(
    `insert into enquiries(ref, name, email, subject, message, locale, state) values($1,$2,$3,$4,$5,$6,'open')`,
    [ref, name, email, subject, message, ctx.locale],
  );
  sendJson(ctx.res, 201, { enquiry: { ref, state: 'open' } });
});

route('GET', '/api/me/credit', 'patron', async (ctx) => {
  const account = ctx.account!;
  sendJson(ctx.res, 200, {
    balance_cents: await creditBalance(account.number),
    movements: await creditMovements(account.number),
  });
});
