import { Ctx } from './http.js';
import { copy } from './copy.js';
import { query } from './db.js';
import { isoWeekOf, mondayOfIsoWeek, mondayOfWeekContaining, addDays, ukDateOf } from '../domain/time.js';
import { Language, isLanguage } from '../domain/strings.js';
import { loadHire } from './data/hires.js';
import { listEnquiries, duplicatesOf, mergedReferencesOf, enquiryIdFollowingMerges } from './data/enquiries.js';
import { readTrip } from './data/trips.js';
import { bidsOf, bidStatus, bidTotal, hasLivePrice, sortBids, windowOpen, bidByToken } from './data/bids.js';
import { operatorsOf, standingFor } from './data/operators.js';
import { rateTableInForce, rateTables } from './data/rates.js';
import { moneyHeld } from './data/ledger.js';
import { listCustomers, markErasingCustomers, reviewList } from './data/customers.js';
import { documentsOf, nextNumbers } from './data/documents.js';
import { adultsOf, gridOf, passengersOf, seatPlacesOf, splitOf } from './data/passengers.js';
import { chargesTotal, dutyBlocksOf, hoursOf, pressesOf, runByToken, runsBetween, runsOfHire, runById } from './data/runs.js';
import { paymentStateLabel } from '../domain/payments.js';
import { OCCASION_PAGES } from './render/content.js';
import { fleetPage, homePage, notFoundPage, occasionPage, termsPage } from './render/public.js';
import { quotePage } from './render/quote.js';
import { signInPage, signUpPage } from './render/desk.js';
import {
  bidsScreen,
  enquiriesScreen,
  enquiryScreen,
  quoteScreen,
  ratesScreen,
  tripScreen,
} from './render/deskScreens1.js';
import {
  changesScreen,
  complaintsScreen,
  customersScreen,
  diaryScreen,
  documentsScreen,
  hoursScreen,
  lostPropertyScreen,
  operatorsScreen,
  paymentsScreen,
  seatsScreen,
} from './render/deskScreens2.js';
import { bidPage, closedBidPage, customerPage, endedPrivatePage, runSheetPage } from './render/private.js';
import { customerStage, quotePageByToken } from './routes/quotes.js';
import { requireDesk } from './session.js';

type PageMatch = { pattern: string[]; params: Record<string, string> } | null;

function match(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split('/');
  const given = path.split('/');
  if (wanted.length !== given.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const part = wanted[index];
    if (part.startsWith(':')) {
      if (given[index] === '') return null;
      params[part.slice(1)] = given[index];
      continue;
    }
    if (part !== given[index]) return null;
  }
  return params;
}

function signInRedirect(ctx: Ctx): void {
  const path = `${ctx.url.pathname}${ctx.url.search}`;
  ctx.redirect(303, `/sign-in?return=${encodeURIComponent(path)}`);
}

async function hireOr404(ctx: Ctx, id: string): Promise<Awaited<ReturnType<typeof loadHire>>> {
  const desk = requireDesk(ctx);
  const hire = await loadHire(desk.id, id);
  if (!hire) {
    ctx.html(404, notFoundPage());
    return null;
  }
  return hire;
}

/** Renders a page, or answers false when no page lives at that address. */
export async function renderPage(ctx: Ctx): Promise<boolean> {
  if (ctx.method !== 'GET') return false;
  const path = ctx.path === '/' ? '/' : ctx.path.replace(/\/$/, '');

  if (path === '/') {
    ctx.html(200, homePage());
    return true;
  }
  for (const page of OCCASION_PAGES) {
    if (path === page.path) {
      ctx.html(200, occasionPage(page));
      return true;
    }
  }
  if (path === '/fleet') {
    ctx.html(200, fleetPage());
    return true;
  }
  if (path === '/terms') {
    ctx.html(200, termsPage());
    return true;
  }
  if (path === '/quote') {
    const occasion = ctx.queryValue('occasion');
    ctx.redirect(303, occasion ? `/quote/route?occasion=${encodeURIComponent(occasion)}` : '/quote/route');
    return true;
  }
  if (path === '/quote/route' || path === '/quote/when' || path === '/quote/details' || path === '/quote/thanks') {
    const step = path.slice('/quote/'.length) as 'route' | 'when' | 'details' | 'thanks';
    const occasion = ctx.queryValue('occasion');
    ctx.html(200, quotePage(step, occasion));
    return true;
  }
  if (path === '/sign-in') {
    ctx.html(200, signInPage(ctx.queryValue('return')));
    return true;
  }
  if (path === '/sign-up') {
    ctx.html(200, signUpPage());
    return true;
  }

  const privateQuote = match('/q/:token', path);
  if (privateQuote) {
    return renderCustomerPage(ctx, privateQuote.token);
  }
  const privateBid = match('/b/:token', path);
  if (privateBid) {
    return renderBidPage(ctx, privateBid.token);
  }
  const privateRun = match('/r/:token', path);
  if (privateRun) {
    return renderRunSheet(ctx, privateRun.token);
  }

  const deskPaths = [
    '/enquiries',
    '/operators',
    '/payments',
    '/diary',
    '/documents',
    '/rates',
    '/customers',
    '/aftercare/complaints',
    '/aftercare/lost-property',
  ];
  const deskPatterns = [
    '/enquiries/:id',
    '/enquiries/:id/trip',
    '/enquiries/:id/bids',
    '/hires/:id/quote',
    '/hires/:id/hours',
    '/hires/:id/seats',
    '/hires/:id/changes',
  ];
  const isDeskPage = deskPaths.includes(path) || deskPatterns.some((pattern) => match(pattern, path) !== null);
  if (!isDeskPage) return false;
  if (!ctx.desk) {
    signInRedirect(ctx);
    return true;
  }
  const desk = requireDesk(ctx);

  if (path === '/enquiries') {
    const state = ctx.queryValue('state') ?? 'all';
    const occasion = ctx.queryValue('occasion') ?? 'all';
    const q = ctx.cappedQuery('q') ?? '';
    const listing = await listEnquiries(desk.id, {
      state,
      occasion,
      q,
      after: ctx.queryValue('after'),
      before: ctx.queryValue('before'),
    });
    const search = new URLSearchParams({ state, occasion, q }).toString();
    ctx.html(
      200,
      enquiriesScreen({
        rows: listing.rows,
        state,
        occasion,
        q,
        nextCursor: listing.nextCursor,
        prevCursor: listing.prevCursor,
        search,
      }),
    );
    return true;
  }

  const enquiryMatch = match('/enquiries/:id', path);
  if (enquiryMatch) {
    const followed = await enquiryIdFollowingMerges(desk.id, enquiryMatch.id);
    const hire = followed ? await hireOr404(ctx, followed) : null;
    if (!hire) {
      if (!ctx.response.headersSent) ctx.html(404, notFoundPage());
      return true;
    }
    ctx.html(
      200,
      enquiryScreen(hire, await duplicatesOf(desk.id, hire.id), await mergedReferencesOf(desk.id, hire.id)),
    );
    return true;
  }

  const tripMatch = match('/enquiries/:id/trip', path);
  if (tripMatch) {
    const hire = await hireOr404(ctx, tripMatch.id);
    if (!hire) return true;
    ctx.html(200, tripScreen(hire, await readTrip(desk.id, hire.id, hire.party)));
    return true;
  }

  const bidsMatch = match('/enquiries/:id/bids', path);
  if (bidsMatch) {
    const hire = await hireOr404(ctx, bidsMatch.id);
    if (!hire) return true;
    const sort = ctx.queryValue('sort') === 'priceHighest' ? 'priceHighest' : 'priceLowest';
    const operators = await operatorsOf(desk.id);
    const now = Date.now();
    const bids = sortBids(await bidsOf(desk.id, hire.id), sort).map(({ bid, total }) => {
      const operator = operators.find((candidate) => candidate.id === bid.operatorId);
      const standing = operator ? standingFor(operator, hire) : { clear: false, reason: copy.noLongerListed };
      return {
        operatorId: bid.operatorId,
        operatorName: operator?.name ?? bid.operatorId,
        status: bidStatus(bid, hire.awardedAt, now),
        clear: standing.clear,
        reason: standing.reason,
        total,
        prices: hasLivePrice(bid) ? (bid.prices ?? []) : [],
      };
    });
    const awardedOperator = operators.find((candidate) => candidate.id === hire.awardedOperatorId);
    ctx.html(
      200,
      bidsScreen({
        hire,
        sort,
        bids,
        operators: operators.map((operator) => {
          const standing = standingFor(operator, hire);
          return { id: operator.id, name: operator.name, clear: standing.clear, reason: standing.reason };
        }),
        awarded: hire.awardedOperatorId
          ? { operatorName: awardedOperator?.name ?? hire.awardedOperatorId, at: String(hire.awardedAt) }
          : null,
      }),
    );
    return true;
  }

  const quoteMatch = match('/hires/:id/quote', path);
  if (quoteMatch) {
    const hire = await hireOr404(ctx, quoteMatch.id);
    if (!hire) return true;
    ctx.html(200, quoteScreen(hire));
    return true;
  }

  const hoursMatch = match('/hires/:id/hours', path);
  if (hoursMatch) {
    const hire = await hireOr404(ctx, hoursMatch.id);
    if (!hire) return true;
    const runs = await runsOfHire(desk.id, hire.id);
    const asked = ctx.queryValue('run');
    const run = (asked ? runs.find((held) => held.id === asked) : runs[0]) ?? runs[0];
    if (!run) {
      ctx.html(
        200,
        hoursScreen({
          hire,
          runs,
          run: {
            id: '',
            deskId: desk.id,
            hireId: hire.id,
            vehicleId: '',
            number: 0,
            seats: 0,
            driverName: null,
            driverTelephone: null,
            toldAt: null,
            confirmed: false,
            sheetToken: '',
            departAt: hire.departAt,
            departInstant: hire.departInstant,
            secondDriver: false,
            blocks: null,
            blocksStart: null,
            stops: [],
            charges: [],
          },
          blocks: [],
          startTime: hire.departAt.time,
          drivingMinutes: 0,
          spreadMinutes: 0,
          breaches: [],
          secondDriverCharge: hire.rates.secondDriverCharge,
        }),
      );
      return true;
    }
    const hours = await hoursOf(run);
    ctx.html(
      200,
      hoursScreen({
        hire,
        runs,
        run,
        blocks: dutyBlocksOf(run),
        startTime: run.blocksStart?.time ?? run.departAt.time,
        drivingMinutes: hours.drivingMinutes,
        spreadMinutes: hours.spreadMinutes,
        breaches: hours.breaches,
        secondDriverCharge: hire.rates.secondDriverCharge,
      }),
    );
    return true;
  }

  const seatsMatch = match('/hires/:id/seats', path);
  if (seatsMatch) {
    const hire = await hireOr404(ctx, seatsMatch.id);
    if (!hire) return true;
    const passengers = await passengersOf(desk.id, hire.id);
    const places = await seatPlacesOf(desk.id, hire.id);
    const adults = adultsOf(hire, passengers);
    ctx.html(
      200,
      seatsScreen({
        hire,
        passengers,
        adultsNeeded: adults.adultsNeeded,
        adultsShort: adults.adultsShort,
        vehicles: hire.vehicles.map((vehicle) => {
          const grid = gridOf(vehicle.seats, places, vehicle.id);
          const seated = grid
            .filter((cell) => cell.passengerId)
            .map((cell) => ({
              passengerId: cell.passengerId as string,
              name: passengers.find((person) => person.id === cell.passengerId)?.name ?? '',
            }));
          return {
            id: vehicle.id,
            seats: vehicle.seats,
            grid,
            split: splitOf(vehicle.total, seated),
          };
        }),
      }),
    );
    return true;
  }

  const changesMatch = match('/hires/:id/changes', path);
  if (changesMatch) {
    const hire = await hireOr404(ctx, changesMatch.id);
    if (!hire) return true;
    const changes = await query<{ id: string; old_body: unknown; new_body: unknown; price_moved: boolean }>(
      'select id, old_body, new_body, price_moved from hire_changes where desk_id = $1 and hire_id = $2 order by created_at',
      [desk.id, hire.id],
    );
    ctx.html(
      200,
      changesScreen({
        hire,
        changes: changes.map((change) => ({
          id: change.id,
          old: change.old_body,
          new: change.new_body,
          priceMoved: change.price_moved,
        })),
        cancellation: hire.cancelledAt ? { noticeAt: '', lines: [] } : null,
      }),
    );
    return true;
  }

  if (path === '/operators') {
    const operators = await operatorsOf(desk.id);
    ctx.html(200, operatorsScreen(operators, new Map()));
    return true;
  }

  if (path === '/payments') {
    const rows = await query<{ id: string }>(
      'select id from enquiries where desk_id = $1 order by created_at desc, id',
      [desk.id],
    );
    const bookings = [];
    for (const row of rows) {
      const hire = await loadHire(desk.id, row.id);
      if (!hire || hire.vehicles.length === 0) continue;
      bookings.push({
        id: hire.id,
        reference: hire.reference,
        customerName: hire.customer.name,
        paymentStateLabel: paymentStateLabel(hire.paymentState),
        paid: hire.paid,
        owed: hire.owed,
        credit: hire.credit,
        vehicles: hire.vehicles.map((vehicle) => ({
          seats: vehicle.seats,
          depositPaid: vehicle.depositPaid,
          deposit: vehicle.deposit,
          balancePaid: vehicle.balancePaid,
          total: vehicle.total,
        })),
      });
    }
    ctx.html(200, paymentsScreen({ moneyHeld: await moneyHeld(desk.id), bookings }));
    return true;
  }

  if (path === '/diary') {
    const week = ctx.queryValue('week') ?? isoWeekOf(ukDateOf(Date.now()));
    const monday = mondayOfIsoWeek(week) ?? mondayOfWeekContaining(ukDateOf(Date.now()));
    const from = new Date(`${monday}T00:00:00Z`).getTime();
    const runs = await runsBetween(desk.id, from - 86400000, from + 8 * 86400000);
    const days = Array.from({ length: 7 }, (_unused, index) => {
      const date = addDays(monday, index);
      return { date, hours: 24, label: null as string | null };
    });
    const { ukHoursInDay, clockChangeLabel } = await import('../domain/time.js');
    for (const day of days) {
      day.hours = ukHoursInDay(day.date);
      day.label = clockChangeLabel(day.date);
    }
    ctx.html(
      200,
      diaryScreen({
        week: isoWeekOf(monday),
        days,
        rows: runs
          .filter((run) => run.departAt.date >= monday && run.departAt.date <= addDays(monday, 6))
          .map((run) => ({
            runId: run.id,
            number: run.number,
            hireId: run.hireId,
            seats: run.seats,
            driver: run.driverName,
            departAt: run.departAt,
          })),
        earlier: isoWeekOf(addDays(monday, -7)),
        later: isoWeekOf(addDays(monday, 7)),
      }),
    );
    return true;
  }

  if (path === '/documents') {
    const documents = await documentsOf(desk.id);
    const hires = await query<{ id: string }>(
      "select e.id from enquiries e join hires h on h.desk_id = e.desk_id and h.id = e.id where e.desk_id = $1 and h.stage <> 'enquiry' order by e.created_at desc",
      [desk.id],
    );
    ctx.html(
      200,
      documentsScreen({
        documents,
        ...(await nextNumbers(desk.id, Date.now())),
        hires: hires.map((hire) => ({ id: hire.id, reference: hire.id })),
      }),
    );
    return true;
  }

  if (path === '/rates') {
    const tables = await rateTables(desk.id);
    const inForce = await rateTableInForce(desk.id, ukDateOf(Date.now()));
    ctx.html(200, ratesScreen(tables, inForce.id));
    return true;
  }

  if (path === '/customers') {
    await markErasingCustomers(desk.id, Date.now());
    const filter = ctx.queryValue('filter') === 'closed' ? 'closed' : 'active';
    const customers = await listCustomers(desk.id, { state: filter });
    ctx.html(200, customersScreen(customers, filter, await reviewList(desk.id)));
    return true;
  }

  if (path === '/aftercare/complaints') {
    const rows = await query<{
      id: string;
      summary: string;
      received_date: string;
      reply_due: string;
      holiday_line: string | null;
      name: string;
    }>(
      `select c.id, c.summary, c.received_date, c.reply_due, c.holiday_line, cu.name
       from complaints c join customers cu on cu.desk_id = c.desk_id and cu.id = c.customer_id
       where c.desk_id = $1 order by c.created_at desc, c.id`,
      [desk.id],
    );
    ctx.html(
      200,
      complaintsScreen(
        rows.map((row) => ({
          id: row.id,
          customerName: row.name,
          summary: row.summary,
          receivedDate: row.received_date,
          replyDue: row.reply_due,
          holidayLine: row.holiday_line,
        })),
        await listCustomers(desk.id, { state: 'active' }),
      ),
    );
    return true;
  }

  if (path === '/aftercare/lost-property') {
    const rows = await query<{ id: string; description: string; found_on: string; held_to: string; state: string }>(
      'select id, description, found_on, held_to, state from lost_property where desk_id = $1 order by created_at desc, id',
      [desk.id],
    );
    const today = ukDateOf(Date.now());
    ctx.html(
      200,
      lostPropertyScreen(
        rows.map((row) => ({
          id: row.id,
          description: row.description,
          foundOn: row.found_on,
          heldTo: row.held_to,
          state: row.state === 'returned' ? 'returned' : today > row.held_to ? 'pastHoldingDate' : 'held',
        })),
      ),
    );
    return true;
  }

  return false;
}

async function renderCustomerPage(ctx: Ctx, token: string): Promise<boolean> {
  const found = await quotePageByToken(token);
  if (!found) {
    ctx.html(404, notFoundPage());
    return true;
  }
  const asked = ctx.queryValue('lang');
  const language: Language = isLanguage(asked) ? asked : found.hire.customer.language;
  if (found.page.replaced || found.hire.customer.erased) {
    ctx.html(410, endedPrivatePage(found.hire.customer.erased ? 'en' : language, 'quote'));
    return true;
  }
  const now = Date.now();
  const state = found.page.acceptedAt ? 'accepted' : now <= found.page.endsAt ? 'open' : 'ended';
  ctx.html(
    200,
    customerPage({
      hire: found.hire,
      page: found.page,
      language,
      stage: customerStage(found.hire, found.page, now),
      state,
      cancelled: found.hire.cancelledAt !== null,
    }),
  );
  return true;
}

async function renderBidPage(ctx: Ctx, token: string): Promise<boolean> {
  const found = await bidByToken(token);
  if (!found) {
    ctx.html(404, notFoundPage());
    return true;
  }
  const hire = await loadHire(found.deskId, found.bid.enquiryId);
  if (!hire) {
    ctx.html(404, notFoundPage());
    return true;
  }
  if (!windowOpen(found.bid, hire.awardedAt, Date.now())) {
    ctx.html(410, closedBidPage());
    return true;
  }
  const { savedPlan } = await import('./data/trips.js');
  const plan = (await savedPlan(found.deskId, hire.id)) ?? [];
  const { moneyString } = await import('../domain/money.js');
  ctx.html(
    200,
    bidPage({
      reference: hire.reference,
      stops: hire.stops.map((stop) => stop.text),
      departAt: hire.departAt,
      returnAt: hire.returnAt,
      vehicles: plan.map((seats, index) => ({ index: index + 1, seats })),
      partySize: hire.party.people,
      token,
      prices: hasLivePrice(found.bid) && found.bid.prices ? found.bid.prices.map(moneyString) : null,
    }),
  );
  return true;
}

async function renderRunSheet(ctx: Ctx, token: string): Promise<boolean> {
  const run = await runByToken(token);
  if (!run) {
    ctx.html(404, notFoundPage());
    return true;
  }
  const hire = await loadHire(run.deskId, run.hireId);
  const asked = ctx.queryValue('lang');
  const language = asked === 'pl' ? 'pl' : 'en';
  if (!hire || hire.cancelledAt !== null || hire.customer.erased) {
    ctx.html(410, endedPrivatePage(hire?.customer.erased ? 'en' : language, 'run'));
    return true;
  }
  const presses = await pressesOf(run.deskId, run.id);
  ctx.html(
    200,
    runSheetPage({
      run,
      language,
      presses: presses.map((press) => ({ stopId: press.stopId, kind: press.kind })),
      flightUnavailable: run.stops.some((stop) => stop.flightOk === false),
      chargesTotal: chargesTotal(run),
    }),
  );
  return true;
}

export { notFoundPage, runById, bidTotal };
