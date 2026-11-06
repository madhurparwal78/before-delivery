import type { Locale } from '../shared/money.ts';
import { TIERS, type Tier } from '../shared/domain.ts';
import { t } from '../shared/strings.ts';
import type { Ctx } from './http/context.ts';
import { sendHtml } from './http/respond.ts';
import { mailState } from './services.ts';
import { page } from './views/layout.ts';
import { programmeMain, screeningMain } from './views/programme.ts';
import { checkoutMain } from './views/checkout.ts';
import {
  accountMain,
  bookingLinkMain,
  bookingMain,
  contactMain,
  giftMain,
  giftRedemptionMain,
  membershipMain,
  notFoundMain,
  signinMain,
  signupMain,
} from './views/pages.ts';
import { staffMain } from './views/staff.ts';
import { getScreening, getSeason, seatCounts, seatRows, seatStates, seasonScreenings, stageSeasons } from './repo/screenings.ts';
import { bookingByGuestToken, bookingByRef, bookingPayload, bookingsForAccount } from './repo/bookings.ts';
import { creditBalance, creditMovements } from './repo/credit.ts';
import { activeMembership, hasLiveVerification, membershipPayload } from './service/membership.ts';
import { buildQuote, getHold, holdSeats, liveHoldIdsFor, ownsHold } from './service/holds.ts';
import { allowedFares } from './domain/fares.ts';
import { derivedState } from './domain/seasons.ts';
import { refundWindowOpen } from './service/refunds.ts';
import { giftByToken } from './service/gifts.ts';
import { one } from './db/pool.ts';

function notFound(ctx: Ctx): void {
  sendHtml(
    ctx.res,
    404,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'not-found',
      title: t('err_not_found', ctx.locale),
      account: ctx.account,
      main: notFoundMain(ctx.locale),
    }),
  );
}

async function programmePage(ctx: Ctx): Promise<void> {
  const now = new Date();
  const seasons = await stageSeasons(ctx.locale, now);
  const stage = [];
  for (const season of seasons) {
    stage.push({ season, screenings: await seasonScreenings(season.slug, { futureOnly: true, now }) });
  }
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'programme',
      title: t('programme_heading', ctx.locale),
      account: ctx.account,
      bodyClass: 'programme-body',
      data: {
        seasons: stage.map((entry) => ({
          slug: entry.season.slug,
          title_en: entry.season.title_en,
          title_fr: entry.season.title_fr,
          count: entry.screenings.length,
        })),
      },
      main: programmeMain(ctx.locale, stage),
    }),
  );
}

async function screeningPage(ctx: Ctx, id: string): Promise<void> {
  const screening = await getScreening(id);
  if (screening === null) {
    notFound(ctx);
    return;
  }
  const season = await getSeason(screening.season_slug);
  if (season === null || derivedState(season.stored_state, season.public_sale_date, new Date()) === 'draft') {
    notFound(ctx);
    return;
  }
  const mine = await liveHoldIdsFor({ accountId: ctx.account?.id ?? null, guestKey: ctx.guestKey }, screening.id);
  const states = await seatStates(screening, mine);
  const counts = await seatCounts(screening.id, screening.capacity);
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'screening',
      title: screening.film_title,
      account: ctx.account,
      data: { screening_id: screening.id },
      main: screeningMain(
        ctx.locale,
        {
          id: screening.id,
          film_title: screening.film_title,
          format: screening.format,
          auditorium: {
            code: screening.auditorium_code,
            name: screening.auditorium_name,
            venue: screening.venue_name,
          },
          starts_at: screening.starts_at,
          notes: ctx.locale === 'fr' ? screening.film_notes_fr : screening.film_notes_en,
          capacity: screening.capacity,
          seats_remaining: counts.remaining,
          rows: seatRows(screening.row_letters, screening.seats_per_row),
          seatStates: new Map(states.map((seat) => [seat.code, seat.state])),
        },
        { signedIn: ctx.account !== null && ctx.account.role === 'patron' },
      ),
    }),
  );
}

async function checkoutPage(ctx: Ctx, holdId: string): Promise<void> {
  const hold = await getHold(holdId);
  if (hold === null || !ownsHold(hold, { accountId: ctx.account?.id ?? null, guestKey: ctx.guestKey })) {
    notFound(ctx);
    return;
  }
  const nowRow = await one<{ now: Date }>('select now() as now');
  const now = nowRow!.now;
  const quote = await buildQuote({
    hold,
    accountId: ctx.account?.id ?? null,
    accountNumber: ctx.account?.number ?? null,
    sessionToken: ctx.sessionToken,
    fares: undefined,
    uplift: 0,
    now,
  });
  const membership = await activeMembership(ctx.account?.id ?? null);
  const seats = await holdSeats(hold.id);
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'checkout',
      title: t('checkout_heading', ctx.locale),
      account: ctx.account,
      data: {
        hold_id: hold.id,
        screening_id: hold.screening_id,
        group: hold.is_group,
        seats,
        expires_at: hold.expires_at.toISOString(),
        server_time: now.toISOString(),
        signed_in: ctx.account !== null,
      },
      main: checkoutMain({
        locale: ctx.locale,
        quote,
        allowedFares: allowedFares({ tier: hold.is_group ? null : membership?.tier ?? null, group: hold.is_group }),
        signedIn: ctx.account !== null,
        seatCount: seats.length,
        now,
      }),
    }),
  );
}

async function bookingPage(ctx: Ctx, options: { ref?: string; token?: string }): Promise<void> {
  const row =
    options.token !== undefined
      ? await bookingByGuestToken(options.token)
      : await bookingByRef(options.ref ?? '');
  if (row === null) {
    notFound(ctx);
    return;
  }
  if (options.token === undefined && (ctx.account === null || row.account_id !== ctx.account.id)) {
    notFound(ctx);
    return;
  }
  const booking = await bookingPayload(row);
  const confirmed = ctx.url.searchParams.get('confirmed') === '1';
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'booking',
      title: confirmed ? t('booking_confirmed', ctx.locale) : t('booking_heading', ctx.locale, { ref: booking.ref }),
      account: ctx.account,
      data: {
        booking_ref: booking.ref,
        token: options.token ?? null,
      },
      main: bookingMain({
        locale: ctx.locale,
        booking,
        confirmed,
        email: row.email,
        guestLink: options.token === undefined ? null : `/${ctx.locale}/b/${options.token}`,
        canRefund: booking.state === 'paid' && refundWindowOpen(row.starts_at, new Date()),
        mailDelayed: mailState() === 'down',
      }),
    }),
  );
}

async function accountPage(ctx: Ctx): Promise<void> {
  const account = ctx.account;
  if (account === null || account.role !== 'patron') {
    notFound(ctx);
    return;
  }
  const rows = await bookingsForAccount(account.id);
  const bookings = [];
  for (const row of rows) bookings.push(await bookingPayload(row));
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'account',
      title: t('account_heading', ctx.locale),
      account: ctx.account,
      main: accountMain({
        locale: ctx.locale,
        membership: membershipPayload(await activeMembership(account.id)),
        balanceCents: await creditBalance(account.number),
        movements: await creditMovements(account.number),
        bookings,
      }),
    }),
  );
}

async function membershipPage(ctx: Ctx): Promise<void> {
  const membership = await activeMembership(ctx.account?.id ?? null);
  const balance = await creditBalance(ctx.account?.number ?? null);
  const verified = await hasLiveVerification(ctx.sessionToken, new Date());
  const needsStepup =
    ctx.account !== null && (membership !== null || balance > 0) && !verified;
  const tierParam = ctx.url.searchParams.get('tier');
  const selected: Tier = TIERS.includes(tierParam as Tier) ? (tierParam as Tier) : 'cinephile';
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'membership',
      title: t('membership_heading', ctx.locale),
      account: ctx.account,
      data: { has_membership: membership !== null, signed_in: ctx.account !== null },
      main: membershipMain({
        locale: ctx.locale,
        membership: membershipPayload(membership),
        selectedTier: selected,
        cadence: 'annual',
        stepupNeeded: needsStepup,
      }),
    }),
  );
}

async function giftPage(ctx: Ctx): Promise<void> {
  const balance = await creditBalance(ctx.account?.number ?? null);
  const verified = await hasLiveVerification(ctx.sessionToken, new Date());
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'gift',
      title: t('gift_heading', ctx.locale),
      account: ctx.account,
      data: { signed_in: ctx.account !== null },
      main: giftMain({
        locale: ctx.locale,
        signedIn: ctx.account !== null,
        selectedTier: 'cinephile',
        stepupNeeded: ctx.account !== null && balance > 0 && !verified,
      }),
    }),
  );
}

async function giftRedemptionPage(ctx: Ctx, token: string): Promise<void> {
  const gift = await giftByToken(token);
  if (gift === null) {
    notFound(ctx);
    return;
  }
  sendHtml(
    ctx.res,
    200,
    page({
      currentPath: ctx.path,
      locale: ctx.locale,
      page: 'gift-redemption',
      title: t('gift_redeem_heading', ctx.locale),
      account: ctx.account,
      data: { token },
      main: giftRedemptionMain({
        locale: ctx.locale,
        gift: { ref: gift.ref, tier: gift.tier, from_name: gift.purchaser_name, message: gift.message },
      }),
    }),
  );
}

function simplePage(ctx: Ctx, name: string, title: string, main: string): void {
  sendHtml(
    ctx.res,
    200,
    page({ currentPath: ctx.path, locale: ctx.locale, page: name, title, account: ctx.account, main }),
  );
}

async function staffPage(ctx: Ctx): Promise<void> {
  const account = ctx.account;
  if (account === null || account.role === 'patron') {
    notFound(ctx);
    return;
  }
  simplePage(ctx, 'staff', t('staff_heading', ctx.locale), staffMain(ctx.locale, account.role));
}

export async function renderPage(ctx: Ctx, locale: Locale, rest: string): Promise<boolean> {
  const segments = rest.split('/').filter((segment) => segment !== '');
  ctx.locale = locale;
  if (segments.length === 0) {
    await programmePage(ctx);
    return true;
  }
  const [first, second, third] = segments;
  if (first === 'screenings' && segments.length === 2) {
    await screeningPage(ctx, second);
    return true;
  }
  if (first === 'checkout' && segments.length === 2) {
    await checkoutPage(ctx, second);
    return true;
  }
  if (first === 'b' && segments.length === 2) {
    await bookingPage(ctx, { token: second });
    return true;
  }
  if (first === 'account' && segments.length === 1) {
    await accountPage(ctx);
    return true;
  }
  if (first === 'account' && second === 'bookings' && segments.length === 3) {
    await bookingPage(ctx, { ref: third });
    return true;
  }
  if (first === 'membership' && segments.length === 1) {
    await membershipPage(ctx);
    return true;
  }
  if (first === 'gift' && segments.length === 1) {
    await giftPage(ctx);
    return true;
  }
  if (first === 'gift' && segments.length === 2) {
    await giftRedemptionPage(ctx, second);
    return true;
  }
  if (first === 'signin' && segments.length === 1) {
    simplePage(ctx, 'signin', t('signin_heading', locale), signinMain(locale, ctx.url.searchParams.get('next')));
    return true;
  }
  if (first === 'signup' && segments.length === 1) {
    simplePage(ctx, 'signup', t('signup_heading', locale), signupMain(locale));
    return true;
  }
  if (first === 'booking-link' && segments.length === 1) {
    simplePage(ctx, 'booking-link', t('booking_link_heading', locale), bookingLinkMain(locale));
    return true;
  }
  if (first === 'contact' && segments.length === 1) {
    simplePage(ctx, 'contact', t('contact_heading', locale), contactMain(locale));
    return true;
  }
  if (first === 'staff' && segments.length === 1) {
    await staffPage(ctx);
    return true;
  }
  notFound(ctx);
  return true;
}
