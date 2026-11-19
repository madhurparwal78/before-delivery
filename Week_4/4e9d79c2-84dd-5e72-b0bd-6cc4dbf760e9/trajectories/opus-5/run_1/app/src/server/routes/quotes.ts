import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, gone, invalid, notFound, providerUnavailable, staleEdit } from '../errors.js';
import { copy, staleQuote, rateTableExists } from '../copy.js';
import { inTransaction, makeId, nextCounter, one, query } from '../db.js';
import { requireDesk } from '../session.js';
import { Pennies, isMoneyString, isPercentString, moneyString, parseMoney, parseTypedAmount, percentTenths } from '../../domain/money.js';
import { Size, isSize, depositFor, vehicleMoney } from '../../domain/vehicles.js';
import { Language, isLanguage } from '../../domain/strings.js';
import { foldName, isEmailAddress, isUkTelephone } from '../../domain/text.js';
import { formatUkDate, instantString, isDateString, readWall, ukDateOf, ukTimeOf } from '../../domain/time.js';
import {
  HireView,
  QuotePage,
  Stage,
  currentQuotePage,
  hireJson,
  loadHire,
  makeQuotePage,
  marginString,
  quoteEnd,
  vehicleJson,
} from '../data/hires.js';
import { paymentStateOf } from '../../domain/payments.js';
import { readEnquiryBody, readLocalDateTime, reusedCustomerId, storeEnquiry } from '../data/enquiries.js';
import { makeRun, runsOfHire } from '../data/runs.js';
import { addRateTable, rateTableInForce, rateTables } from '../data/rates.js';
import { savePlan } from '../data/trips.js';
import { mailQuote } from '../mails.js';
import { quotePdfFor } from '../documents.js';
import { PdfDown } from '../providers/pdf.js';
import { StorageDown } from '../providers/storage.js';

const MARGIN_STEP = 5;
const MARGIN_MAX = 600;

function readMargin(value: unknown): number {
  if (!isPercentString(value)) throw invalid(copy.marginRange, { marginPercent: copy.marginRange });
  const tenths = percentTenths(value);
  if (tenths > MARGIN_MAX || tenths % MARGIN_STEP !== 0) {
    throw invalid(copy.marginRange, { marginPercent: copy.marginRange });
  }
  return tenths;
}

export function quoteJson(hire: HireView, page: QuotePage | null): Record<string, unknown> {
  return {
    version: hire.quoteVersion,
    sentAt: page ? instantString(page.sentAt) : null,
    validUntil: page?.validUntil ?? null,
    endsAt: page ? instantString(page.endsAt) : null,
    quotePath: page ? `/q/${page.token}` : null,
    rateTableId: hire.rates.id,
    vehicles: hire.vehicles.map((vehicle) => ({
      id: vehicle.id,
      seats: vehicle.seats,
      boughtPrice: moneyString(vehicle.boughtPrice),
      marginPercent: marginString(vehicle.marginTenths),
      sellingPrice: moneyString(vehicle.sellingPrice),
      vat: moneyString(vehicle.vat),
      total: moneyString(vehicle.quoteTotal),
      deposit: moneyString(vehicle.deposit),
    })),
    total: moneyString(hire.vehicles.reduce((sum, vehicle) => sum + vehicle.quoteTotal, 0)),
    depositTotal: moneyString(hire.depositTotal),
  };
}

export type CustomerStage = 'quoteSent' | 'accepted' | 'deposit' | 'balance' | 'travel';

/** The last step reached, worked out at each read. */
export function customerStage(hire: HireView, page: QuotePage, now: number): CustomerStage {
  const firstDeparture = hire.vehicles
    .map((vehicle) => vehicle.departInstant ?? hire.departInstant)
    .sort((a, b) => a - b)
    .at(0) ?? hire.departInstant;
  if (now >= firstDeparture) return 'travel';
  if (!page.acceptedAt) return 'quoteSent';
  if (hire.paymentState === 'paidInFull') return 'balance';
  if (hire.paymentState === 'depositPaid') return 'deposit';
  return 'accepted';
}

export async function quotePageByToken(
  token: string,
): Promise<{ deskId: string; page: QuotePage; hire: HireView } | null> {
  const row = await one<{
    desk_id: string;
    id: string;
    hire_id: string;
    token: string;
    version: number;
    sent_at: string;
    valid_until: string;
    ends_at: string;
    accepted_at: string | null;
    deposit_said_sent: boolean;
    mailed: boolean;
    replaced: boolean;
  }>(
    `select desk_id, id, hire_id, token, version, sent_at, valid_until, ends_at, accepted_at, deposit_said_sent,
            mailed, replaced from quote_pages where token = $1`,
    [token],
  );
  if (!row) return null;
  const hire = await loadHire(row.desk_id, row.hire_id);
  if (!hire) return null;
  return {
    deskId: row.desk_id,
    hire,
    page: {
      id: row.id,
      token: row.token,
      version: Number(row.version),
      sentAt: Number(row.sent_at),
      validUntil: row.valid_until,
      endsAt: Number(row.ends_at),
      acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
      depositSaidSent: row.deposit_said_sent,
      mailed: row.mailed,
      replaced: row.replaced,
    },
  };
}

export function customerPageJson(hire: HireView, page: QuotePage, now: number): Record<string, unknown> {
  const state = page.acceptedAt ? 'accepted' : now <= page.endsAt ? 'open' : 'ended';
  return {
    reference: hire.reference,
    language: hire.customer.language,
    state,
    stage: customerStage(hire, page, now),
    stops: hire.stops.map((stop) => stop.text),
    departAt: hire.departAt,
    departInstant: instantString(hire.departInstant),
    returnAt: hire.returnAt,
    returnInstant: hire.returnInstant === null ? null : instantString(hire.returnInstant),
    people: hire.party.people,
    vehicles: hire.vehicles.map((vehicle) => ({
      seats: vehicle.seats,
      total: moneyString(vehicle.total),
      deposit: moneyString(vehicle.deposit),
    })),
    total: moneyString(hire.total),
    depositTotal: moneyString(hire.depositTotal),
    validUntil: page.validUntil,
    endsAt: instantString(page.endsAt),
    depositSaidSent: page.depositSaidSent,
    cancelled: hire.cancelledAt !== null,
  };
}

async function fixDepositsAndRates(deskId: string, hire: HireView, rateTableId: string): Promise<void> {
  const rates = await rateTableInForce(deskId, ukDateOf(Date.now()));
  await query('update hires set rate_table_id = $3 where desk_id = $1 and id = $2', [deskId, hire.id, rateTableId]);
  for (const vehicle of hire.vehicles) {
    const money = vehicleMoney(vehicle.boughtPrice, vehicle.marginTenths, vehicle.seats, rates);
    await query('update vehicles set deposit = $3 where desk_id = $1 and id = $2', [
      deskId,
      vehicle.id,
      depositFor(money.total, vehicle.seats, rates),
    ]);
  }
}

export const quoteRoutes: Route[] = [
  route('POST', '/api/hires', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const stage = body.stage;
    if (stage !== 'enquiry' && stage !== 'quoted' && stage !== 'accepted') {
      throw invalid('Choose a stage.', { stage: 'Choose a stage.' });
    }
    const customerBody =
      body.customer !== null && typeof body.customer === 'object' && !Array.isArray(body.customer)
        ? (body.customer as Record<string, unknown>)
        : {};
    const name = typeof customerBody.name === 'string' ? customerBody.name.trim() : '';
    if (name === '') throw invalid(copy.enterName, { 'customer.name': copy.enterName });
    if (!isEmailAddress(customerBody.email)) throw invalid(copy.enterEmail, { 'customer.email': copy.enterEmail });
    if (!isUkTelephone(customerBody.telephone)) {
      throw invalid(copy.enterTelephone, { 'customer.telephone': copy.enterTelephone });
    }
    const language = (customerBody.language ?? 'en') as Language;
    if (!isLanguage(language)) throw invalid('Choose a language.', { 'customer.language': 'Choose a language.' });
    const occasion = body.occasion;
    if (occasion !== 'school' && occasion !== 'weddings' && occasion !== 'company' && occasion !== 'festivals') {
      throw invalid(copy.chooseOccasion, { occasion: copy.chooseOccasion });
    }
    const stops = Array.isArray(body.stops) ? (body.stops as unknown[]) : [];
    if (stops.length < 2 || stops.some((stop) => typeof stop !== 'string' || stop.trim() === '')) {
      throw invalid(copy.enterPickUp, { stops: copy.enterPickUp });
    }
    const now = Date.now();
    const depart = readLocalDateTime(body.departAt, 'departAt', 'notice', now, false);
    const returnPart =
      body.returnAt === null || body.returnAt === undefined
        ? null
        : readLocalDateTime(body.returnAt, 'returnAt', 'notice', now, false);
    const partyBody =
      body.party !== null && typeof body.party === 'object' && !Array.isArray(body.party)
        ? (body.party as Record<string, unknown>)
        : {};
    const people = Number(partyBody.people ?? 0);
    if (!Number.isInteger(people) || people < 1 || people > 400) {
      throw invalid(copy.enterPeople, { 'party.people': copy.enterPeople });
    }
    const party = {
      people,
      large: Number(partyBody.large ?? 0),
      medium: Number(partyBody.medium ?? 0),
      hand: Number(partyBody.hand ?? 0),
      wheelchairs: Number(partyBody.wheelchairs ?? 0),
    };
    const vehicleBodies = Array.isArray(body.vehicles) ? (body.vehicles as Record<string, unknown>[]) : [];
    const vehicles = vehicleBodies.map((vehicle) => {
      const seats = Number(vehicle.seats);
      if (!isSize(seats)) throw invalid(copy.sizeNotOffered, { 'vehicles.seats': copy.sizeNotOffered });
      const boughtPrice =
        vehicle.boughtPrice === undefined || vehicle.boughtPrice === null
          ? 0
          : isMoneyString(vehicle.boughtPrice)
            ? parseMoney(vehicle.boughtPrice)
            : (() => {
                throw invalid(copy.enterAmount, { 'vehicles.boughtPrice': copy.enterAmount });
              })();
      const marginTenths =
        vehicle.marginPercent === undefined || vehicle.marginPercent === null ? 150 : readMargin(vehicle.marginPercent);
      return {
        seats: seats as Size,
        operatorId: typeof vehicle.operatorId === 'string' ? vehicle.operatorId : null,
        boughtPrice,
        marginTenths,
      };
    });
    for (const vehicle of vehicles) {
      if (!vehicle.operatorId) continue;
      const operator = await one<{ id: string }>('select id from operators where desk_id = $1 and id = $2', [
        desk.id,
        vehicle.operatorId,
      ]);
      if (!operator) throw notFound();
    }
    const quoteSentLocal =
      body.quoteSentAt === null || body.quoteSentAt === undefined
        ? null
        : readLocalDateTime(body.quoteSentAt, 'quoteSentAt', 'notice', now, false);

    const made = await inTransaction(async (client) => {
      const customerId = await reusedCustomerId(client, desk.id, {
        name,
        email: (customerBody.email as string).trim(),
        telephone: (customerBody.telephone as string).trim(),
        language,
      });
      const stored = await storeEnquiry(
        client,
        desk.id,
        {
          occasion,
          journeyType: returnPart ? 'return' : 'oneWay',
          stops: (stops as string[]).map((text) => ({ text: text.trim(), checked: true })),
          departAt: depart.local,
          departInstant: depart.instant,
          returnAt: returnPart?.local ?? null,
          returnInstant: returnPart?.instant ?? null,
          party,
          details: null,
          name,
          email: (customerBody.email as string).trim(),
          telephone: (customerBody.telephone as string).trim(),
          language,
        },
        null,
        stage === 'enquiry' ? 'new' : stage === 'quoted' ? 'quoted' : 'won',
      );
      await client.query('update enquiries set customer_id = $3 where desk_id = $1 and id = $2', [
        desk.id,
        stored.reference,
        customerId,
      ]);
      await client.query('update hires set stage = $3 where desk_id = $1 and id = $2', [
        desk.id,
        stored.reference,
        stage as Stage,
      ]);
      for (let index = 0; index < vehicles.length; index += 1) {
        const vehicle = vehicles[index];
        const vehicleId = makeId('VH');
        await client.query(
          `insert into vehicles (desk_id, id, hire_id, position, seats, operator_id, bought_price, margin_tenths)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            desk.id,
            vehicleId,
            stored.reference,
            index,
            vehicle.seats,
            vehicle.operatorId,
            vehicle.boughtPrice,
            vehicle.marginTenths,
          ],
        );
        if (stage !== 'enquiry') {
          const number = await nextCounter(client, desk.id, 'run');
          await makeRun(
            client,
            desk.id,
            stored.reference,
            vehicleId,
            vehicle.seats,
            number,
            depart.local,
            depart.instant,
            (stops as string[]).map((text) => text.trim()),
          );
        }
      }
      if (vehicles.length > 0) {
        await savePlan(
          desk.id,
          stored.reference,
          vehicles.map((vehicle) => vehicle.seats),
        );
      }
      if (stage !== 'enquiry') {
        const sentAt = quoteSentLocal?.instant ?? now;
        const page = await makeQuotePage(client, desk.id, stored.reference, 1, sentAt, false);
        if (stage === 'accepted') {
          await client.query('update quote_pages set accepted_at = $3 where desk_id = $1 and id = $2', [
            desk.id,
            page.id,
            sentAt,
          ]);
        }
      }
      return stored.reference;
    });

    const hire = assertKnown(await loadHire(desk.id, made));
    if (stage !== 'enquiry') await fixDepositsAndRates(desk.id, hire, hire.rates.id);
    const fresh = assertKnown(await loadHire(desk.id, made));
    const runs = (await runsOfHire(desk.id, made)).map((run) => ({
      id: run.id,
      number: run.number,
      sheetPath: `/r/${run.sheetToken}`,
    }));
    ctx.json(201, hireJson(fresh, runs));
  }),

  route('GET', '/api/hires/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const runs = (await runsOfHire(desk.id, hire.id)).map((run) => ({
      id: run.id,
      number: run.number,
      sheetPath: `/r/${run.sheetToken}`,
    }));
    const operatorName = hire.awardedOperatorId
      ? (
          await one<{ name: string }>('select name from operators where desk_id = $1 and id = $2', [
            desk.id,
            hire.awardedOperatorId,
          ])
        )?.name ?? hire.awardedOperatorId
      : null;
    ctx.json(200, {
      ...hireJson(hire, runs),
      paymentState: hire.paymentState,
      paid: moneyString(hire.paid),
      owed: moneyString(hire.owed),
      credit: moneyString(hire.credit),
      balanceDueOn: hire.balanceDueOn,
      awarded: hire.awardedOperatorId
        ? {
            operatorId: hire.awardedOperatorId,
            operatorName,
            at: instantString(hire.awardedAt ?? 0),
          }
        : null,
      vehicles: hire.vehicles.map((vehicle) => ({
        ...vehicleJson(vehicle),
        depositPaid: moneyString(vehicle.depositPaid),
        balancePaid: moneyString(vehicle.balancePaid),
        refundsDue: moneyString(vehicle.refundsDue),
        owedAmount: moneyString(vehicle.owedAmount),
      })),
    });
  }),

  route('GET', '/api/hires/:id/quote', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    ctx.json(200, quoteJson(hire, hire.page));
  }),

  route('POST', '/api/hires/:id/quote/preview', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const rows = Array.isArray(body.vehicles) ? (body.vehicles as Record<string, unknown>[]) : [];
    const vehicles = rows.map((row) => {
      const seats = Number(row.seats);
      if (!isSize(seats)) throw invalid(copy.sizeNotOffered, { seats: copy.sizeNotOffered });
      if (!isMoneyString(row.boughtPrice)) throw invalid(copy.enterAmount, { boughtPrice: copy.enterAmount });
      const marginTenths = readMargin(row.marginPercent);
      const money = vehicleMoney(parseMoney(row.boughtPrice), marginTenths, seats as Size, hire.rates);
      return {
        seats,
        sellingPrice: moneyString(money.sellingPrice),
        vat: moneyString(money.vat),
        total: moneyString(money.total),
        deposit: moneyString(money.deposit),
        totalPennies: money.total,
        depositPennies: money.deposit,
      };
    });
    ctx.json(200, {
      vehicles: vehicles.map(({ totalPennies, depositPennies, ...rest }) => rest),
      total: moneyString(vehicles.reduce((sum, vehicle) => sum + vehicle.totalPennies, 0)),
      depositTotal: moneyString(vehicles.reduce((sum, vehicle) => sum + vehicle.depositPennies, 0)),
    });
  }),

  route('PUT', '/api/hires/:id/quote', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const rows = Array.isArray(body.vehicles) ? (body.vehicles as Record<string, unknown>[]) : [];
    const margins = rows.map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      marginTenths: readMargin(row.marginPercent),
    }));
    if (hire.page?.acceptedAt) throw conflict('quoteLocked', copy.quoteLocked);
    const version = Number(body.version);
    if (!Number.isInteger(version)) throw invalid('Send the quote version.', { version: 'Send the quote version.' });
    if (version < hire.quoteVersion) {
      throw staleEdit(staleQuote(ukTimeOf(Date.now())));
    }
    for (const margin of margins) {
      const vehicle = hire.vehicles.find((held) => held.id === margin.id);
      if (!vehicle) throw notFound();
    }
    await inTransaction(async (client) => {
      for (const margin of margins) {
        await client.query('update vehicles set margin_tenths = $3 where desk_id = $1 and id = $2', [
          desk.id,
          margin.id,
          margin.marginTenths,
        ]);
      }
      await client.query('update hires set quote_version = quote_version + 1 where desk_id = $1 and id = $2', [
        desk.id,
        hire.id,
      ]);
    });
    const fresh = assertKnown(await loadHire(desk.id, hire.id));
    ctx.json(200, quoteJson(fresh, fresh.page));
  }),

  route('POST', '/api/hires/:id/quote/send', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    await jsonBody(ctx);
    if (hire.vehicles.length === 0) throw conflict('notAwarded', copy.savePlanFirst);
    if (hire.page?.acceptedAt) throw conflict('quoteAccepted', copy.quoteLocked);
    const now = Date.now();
    let page = hire.page;
    let mailNeeded = false;
    if (!page) {
      page = await inTransaction(async (client) => makeQuotePage(client, desk.id, hire.id, hire.quoteVersion, now, false));
      mailNeeded = true;
    } else if (!page.mailed) {
      mailNeeded = true;
    } else if (page.version < hire.quoteVersion) {
      await query('update quote_pages set replaced = true where desk_id = $1 and id = $2', [desk.id, page.id]);
      page = await inTransaction(async (client) => makeQuotePage(client, desk.id, hire.id, hire.quoteVersion, now, false));
      mailNeeded = true;
    }
    if (mailNeeded) {
      await fixDepositsAndRates(desk.id, hire, hire.rates.id);
      const fresh = assertKnown(await loadHire(desk.id, hire.id));
      await mailQuote(
        hire.customer.email,
        hire.reference,
        hire.customer.language,
        fresh.vehicles.reduce((sum, vehicle) => sum + vehicle.quoteTotal, 0),
        page.validUntil,
        `/q/${page.token}`,
      );
      await query('update quote_pages set mailed = true, version = $3 where desk_id = $1 and id = $2', [
        desk.id,
        page.id,
        hire.quoteVersion,
      ]);
      await query(
        "update enquiries set state = 'quoted' where desk_id = $1 and id = $2 and state in ('new','priced')",
        [desk.id, hire.id],
      );
      await query("update hires set stage = 'quoted' where desk_id = $1 and id = $2 and stage = 'enquiry'", [
        desk.id,
        hire.id,
      ]);
    }
    const answered = assertKnown(await loadHire(desk.id, hire.id));
    ctx.json(200, quoteJson(answered, await currentQuotePage(desk.id, hire.id)));
  }),

  route('GET', '/api/rates', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const tables = await rateTables(desk.id);
    const inForce = await rateTableInForce(desk.id, ukDateOf(Date.now()));
    ctx.json(200, {
      tables: tables.map((table) => ({
        id: table.id,
        effectiveFrom: table.effectiveFrom,
        defaultMarginPercent: marginString(table.defaultMarginTenths),
        waitingRatePerHour: moneyString(table.waitingRatePerHour),
        secondDriverCharge: moneyString(table.secondDriverCharge),
        depositMinibus: moneyString(table.depositMinibus),
        depositMinibusHigher: moneyString(table.depositMinibusHigher),
        depositCoach: moneyString(table.depositCoach),
        depositCoachHigher: moneyString(table.depositCoachHigher),
      })),
      inForce: inForce.id,
    });
  }),

  route('POST', '/api/rates', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const effectiveFrom = body.effectiveFrom;
    if (!isDateString(effectiveFrom)) throw invalid(copy.enterDate, { effectiveFrom: copy.enterDate });
    if (effectiveFrom < ukDateOf(Date.now())) {
      throw invalid(copy.rateTableBeforeToday, { effectiveFrom: copy.rateTableBeforeToday });
    }
    const amount = (key: string): Pennies => {
      const value = parseTypedAmount(body[key]);
      if (value === null) throw invalid(copy.enterAmount, { [key]: copy.enterAmount });
      return value;
    };
    const table = {
      effectiveFrom,
      defaultMarginTenths: readMargin(body.defaultMarginPercent),
      waitingRatePerHour: amount('waitingRatePerHour'),
      secondDriverCharge: amount('secondDriverCharge'),
      depositMinibus: amount('depositMinibus'),
      depositMinibusHigher: amount('depositMinibusHigher'),
      depositCoach: amount('depositCoach'),
      depositCoachHigher: amount('depositCoachHigher'),
    };
    const held = await rateTables(desk.id);
    if (held.some((row) => row.effectiveFrom === effectiveFrom)) {
      throw conflict('rateTableExists', rateTableExists(effectiveFrom));
    }
    const made = await addRateTable(desk.id, table);
    ctx.json(201, {
      id: made.id,
      effectiveFrom: made.effectiveFrom,
      defaultMarginPercent: marginString(made.defaultMarginTenths),
      waitingRatePerHour: moneyString(made.waitingRatePerHour),
      secondDriverCharge: moneyString(made.secondDriverCharge),
      depositMinibus: moneyString(made.depositMinibus),
      depositMinibusHigher: moneyString(made.depositMinibusHigher),
      depositCoach: moneyString(made.depositCoach),
      depositCoachHigher: moneyString(made.depositCoachHigher),
    });
  }),

  route('GET', '/api/q/:token', 'private', async (ctx) => {
    const found = await quotePageByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    if (found.page.replaced || found.hire.customer.erased) throw gone('pageEnded', copy.notFound);
    ctx.json(200, customerPageJson(found.hire, found.page, Date.now()));
  }),

  route('POST', '/api/q/:token/accept', 'private', async (ctx) => {
    const found = await quotePageByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    if (found.page.replaced || found.hire.customer.erased) throw gone('pageEnded', copy.notFound);
    const body = await jsonBody(ctx);
    const now = Date.now();
    if (found.hire.cancelledAt !== null) {
      throw conflict('bookingCancelled', 'This booking was cancelled.');
    }
    if (found.page.acceptedAt) {
      ctx.json(200, customerPageJson(found.hire, found.page, now));
      return;
    }
    if (now > found.page.endsAt) throw conflict('quoteEnded', 'This quote has ended.');
    const name = typeof body.name === 'string' ? body.name : '';
    if (foldName(name) !== foldName(found.hire.customer.name)) {
      throw invalid('That name does not match this quote.', { name: 'That name does not match this quote.' });
    }
    await query('update quote_pages set accepted_at = $3 where desk_id = $1 and id = $2', [
      found.deskId,
      found.page.id,
      now,
    ]);
    await query("update hires set stage = 'accepted' where desk_id = $1 and id = $2", [found.deskId, found.hire.id]);
    await query("update enquiries set state = 'won' where desk_id = $1 and id = $2", [found.deskId, found.hire.id]);
    const fresh = assertKnown(await quotePageByToken(found.page.token));
    ctx.json(200, customerPageJson(fresh.hire, fresh.page, now));
  }),

  route('POST', '/api/q/:token/deposit-sent', 'private', async (ctx) => {
    const found = await quotePageByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    if (found.page.replaced || found.hire.customer.erased) throw gone('pageEnded', copy.notFound);
    await jsonBody(ctx);
    if (found.hire.cancelledAt !== null) {
      throw conflict('bookingCancelled', 'This booking was cancelled.');
    }
    if (!found.page.acceptedAt) throw conflict('quoteNotAccepted', 'This quote has not been accepted.');
    await query('update quote_pages set deposit_said_sent = true where desk_id = $1 and id = $2', [
      found.deskId,
      found.page.id,
    ]);
    const fresh = assertKnown(await quotePageByToken(found.page.token));
    ctx.json(200, customerPageJson(fresh.hire, fresh.page, Date.now()));
  }),

  route('GET', '/api/q/:token/pdf', 'private', async (ctx) => {
    const found = await quotePageByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    if (found.page.replaced || found.hire.customer.erased) throw gone('pageEnded', copy.notFound);
    try {
      const pdf = await quotePdfFor(found.deskId, found.hire);
      ctx.send(200, pdf, { 'content-type': 'application/pdf' });
    } catch (trouble) {
      if (trouble instanceof PdfDown) throw providerUnavailable(copy.pdfServiceDown, 'pdfServiceDown');
      if (trouble instanceof StorageDown) throw providerUnavailable(copy.fileStoreDown, 'fileStoreDown');
      throw trouble;
    }
  }),
];

export { paymentStateOf, formatUkDate, readWall, readEnquiryBody, quoteEnd };
