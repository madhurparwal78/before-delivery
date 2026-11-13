import { randomInt } from 'node:crypto';
import { convertTotal, pctOf } from '../shared/money';
import { Booking, BookingRoom, Cur, CurrencyTable, LedgerEntry, PlanCode, QuoteNightRoom, TierName } from '../shared/types';
import { nowMs } from './clock';
import { one, query, withTx } from './db';
import { ApiError, conflict, gone, notFound, restricted, validation } from './errors';
import { broadcast } from './events';
import { loadInventory, loadProperty } from './inventory';
import { cancellationTiers, refundStatus } from './policy';
import { makeStayContext, priceStay } from './pricing';
import { checkSelection } from './restrictions';
import { tierPct } from './loyalty';
import { Owner, QuoteRow, loadQuoteRow, ownsQuote } from './quotes';
import { addDays, datesBetween, diffDays, localDate, parseDate, wallToUtc } from './zone';
import { newId } from './auth';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

export function newBookingCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `KW-${code}`;
}

export type CardOutcome = 'approved' | 'declined' | 'expired' | 'unknown' | 'step_up' | 'wrong_code';

const CARDS: Record<string, CardOutcome> = {
  '9000000000000002': 'approved',
  '9000000000000010': 'declined',
  '9000000000000028': 'expired',
  '9000000000000036': 'step_up',
};

export interface PaymentFields {
  given_name?: unknown;
  surname?: unknown;
  card_number?: unknown;
  expiry?: unknown;
  security_code?: unknown;
  step_up_code?: unknown;
}

export function paymentFieldErrors(body: PaymentFields, needName: boolean): Record<string, string> {
  const fields: Record<string, string> = {};
  if (needName) {
    const given = typeof body.given_name === 'string' ? body.given_name.trim() : '';
    if (given === '') fields.given_name = 'field.given';
    else if (given.length > 80) fields.given_name = 'too_long';
    const surname = typeof body.surname === 'string' ? body.surname.trim() : '';
    if (surname === '') fields.surname = 'field.surname';
    else if (surname.length > 80) fields.surname = 'too_long';
  }
  const digits = typeof body.card_number === 'string' ? body.card_number.replace(/ /g, '') : '';
  if (!/^\d{16}$/.test(digits)) fields.card_number = 'field.card';
  const expiry = typeof body.expiry === 'string' ? body.expiry.trim() : '';
  const expiryMatch = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!expiryMatch || Number(expiryMatch[1]) < 1 || Number(expiryMatch[1]) > 12) fields.expiry = 'field.expiry';
  const code = typeof body.security_code === 'string' ? body.security_code.trim() : '';
  if (!/^\d{3}$/.test(code)) fields.security_code = 'field.code';
  return fields;
}

/** The simulated card outcome of a payment attempt. */
export function cardOutcome(cardNumber: string, stepUpCode?: unknown): CardOutcome {
  const digits = cardNumber.replace(/ /g, '');
  const outcome = CARDS[digits];
  if (!outcome) return 'unknown';
  if (outcome !== 'step_up') return outcome;
  if (stepUpCode === undefined || stepUpCode === null || stepUpCode === '') return 'step_up';
  return String(stepUpCode) === '1234' ? 'approved' : 'wrong_code';
}

export function last4(cardNumber: string): string {
  return cardNumber.replace(/ /g, '').slice(-4);
}

export interface BookingRowView {
  code: string;
  version: number;
  visitor: string | null;
  username: string | null;
  property: string;
  in_date: string;
  out_date: string;
  given_name: string;
  surname: string;
  card_last4: string;
  currency: Cur;
  rates: CurrencyTable;
  tier: TierName;
}

const BOOKING_FIELDS = `code, version, visitor, username, property,
  to_char(in_date, 'YYYY-MM-DD') as in_date, to_char(out_date, 'YYYY-MM-DD') as out_date,
  given_name, surname, card_last4, currency, rates, tier`;

export interface RoomRow {
  code: string;
  n: number;
  room_type: string;
  plan: PlanCode;
  breakfast: boolean;
  adults: number;
  ages: number[];
  state: string;
  nights: QuoteNightRoom[];
  total_minor: number;
  paid_minor: number;
  refunded_minor: number;
  completed_at: string | null;
}

export async function loadBookingRow(code: string): Promise<BookingRowView | null> {
  return one<BookingRowView>(`select ${BOOKING_FIELDS} from bookings where code = $1`, [code]);
}

export async function loadRooms(code: string): Promise<RoomRow[]> {
  return query<RoomRow>(
    `select code, n, room_type, plan, breakfast, adults, ages, state, nights, total_minor,
       paid_minor, refunded_minor,
       to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as completed_at
     from booking_rooms where code = $1 order by n`,
    [code],
  );
}

export async function loadLedger(code: string): Promise<LedgerEntry[]> {
  const rows = await query<{
    id: string;
    pair: number;
    kind: string;
    account: string;
    debit_minor: number;
    credit_minor: number;
    at: string;
  }>(
    `select id, pair, kind, account, debit_minor, credit_minor,
       to_char(at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
     from ledger where code = $1 order by id`,
    [code],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    pair: row.pair,
    kind: row.kind as LedgerEntry['kind'],
    account: row.account as LedgerEntry['account'],
    debit_minor: row.debit_minor,
    credit_minor: row.credit_minor,
    at: row.at,
  }));
}

export const ACTIVE_STATES = ['confirmed', 'changed'];

export function bookingState(rooms: RoomRow[]): string {
  const alive = rooms.filter((room) => room.state !== 'cancelled');
  if (alive.length === 0) return 'cancelled';
  const states = new Set(alive.map((room) => room.state));
  return states.size === 1 ? [...states][0] : 'confirmed';
}

export function noShowOpenAt(zone: string, inDate: string, rooms: RoomRow[], at: number): boolean {
  if (!rooms.some((room) => ACTIVE_STATES.includes(room.state))) return false;
  const day = addDays(inDate, 1);
  const parts = parseDate(day)!;
  return at >= wallToUtc(zone, parts.y, parts.m, parts.d, 12, 0);
}

/** The booking object every screen and document reads. */
export async function bookingObject(code: string): Promise<Booking | null> {
  const row = await loadBookingRow(code);
  if (!row) return null;
  const property = await loadProperty(row.property);
  if (!property) return null;
  const rooms = await loadRooms(code);
  const ledger = await loadLedger(code);
  const at = nowMs();
  const activePlans = rooms.filter((room) => ACTIVE_STATES.includes(room.state)).map((room) => room.plan);
  const totals = rooms.reduce(
    (acc, room) => {
      acc.total += room.state === 'cancelled' ? 0 : room.total_minor;
      acc.paid += room.paid_minor;
      acc.refunded += room.refunded_minor;
      return acc;
    },
    { total: 0, paid: 0, refunded: 0 },
  );
  const balance = ledger.reduce((sum, entry) => sum + entry.debit_minor - entry.credit_minor, 0);
  return {
    code: row.code,
    version: row.version,
    state: bookingState(rooms),
    property: { code: property.code, name: property.name, zone: property.zone },
    in: row.in_date,
    out: row.out_date,
    given_name: row.given_name,
    surname: row.surname,
    card_last4: row.card_last4,
    quote_currency: row.currency,
    rooms: rooms.map((room): BookingRoom => ({
      n: room.n,
      room_type: room.room_type,
      plan: room.plan,
      breakfast: room.breakfast,
      adults: room.adults,
      ages: room.ages,
      state: room.state,
      paid_minor: room.paid_minor,
      refunded_minor: room.refunded_minor,
      nights: room.nights,
    })),
    total_minor: totals.total,
    paid_minor: totals.paid,
    refunded_minor: totals.refunded,
    converted_total_minor: convertTotal(totals.paid - totals.refunded, row.currency, row.rates),
    cancellation: {
      tiers: cancellationTiers(property, row.in_date),
      status: refundStatus(property, row.in_date, at, activePlans),
    },
    no_show_open: noShowOpenAt(property.zone, row.in_date, rooms, at),
    ledger,
    balance_minor: balance,
  };
}

async function nextPair(code: string): Promise<number> {
  const row = await one<{ pair: number | null }>('select max(pair) as pair from ledger where code = $1', [code]);
  return (row?.pair ?? 0) + 1;
}

export async function addLedgerPair(
  code: string,
  kind: 'charge' | 'refund' | 'change',
  direction: 'from_guest' | 'to_guest',
  amount: number,
): Promise<void> {
  const pair = await nextPair(code);
  const at = new Date(nowMs()).toISOString();
  const guestDebit = direction === 'from_guest' ? amount : 0;
  const guestCredit = direction === 'from_guest' ? 0 : amount;
  await query(
    `insert into ledger (code, pair, kind, account, debit_minor, credit_minor, at)
     values ($1,$2,$3,'guest',$4,$5,$6), ($1,$2,$3,'property',$7,$8,$6)`,
    [code, pair, kind, guestDebit, guestCredit, at, guestCredit, guestDebit],
  );
}

export interface CreateBookingInput {
  owner: Owner;
  holdId: string;
  quoteId: string;
  given_name: string;
  surname: string;
  card_number: string;
  expiry: string;
  security_code: string;
  step_up_code?: unknown;
}

export async function createBookingFromHold(input: CreateBookingInput): Promise<Booking> {
  const quote = await loadQuoteRow(input.quoteId);
  if (!quote || !ownsQuote(quote, input.owner)) throw notFound();
  const hold = await one<{
    id: string;
    quote_id: string;
    state: string;
    expires_at: string;
    visitor: string | null;
    username: string | null;
    property: string;
  }>(
    `select id, quote_id, state, to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
       visitor, username, property from holds where id = $1`,
    [input.holdId],
  );
  if (!hold) throw notFound();
  const mine = hold.username ? hold.username === input.owner.username : hold.visitor === input.owner.visitorId;
  if (!mine) throw notFound();
  if (hold.state !== 'live' || nowMs() >= new Date(hold.expires_at).getTime()) throw gone('hold_expired');

  const freshTotal = await repriceQuote(quote);
  if (quote.stale || nowMs() >= new Date(quote.expires_at).getTime()) {
    throw conflict('price_changed', {
      old_total_minor: convertTotal(quote.data.total_minor, quote.currency, quote.rates),
      new_total_minor: convertTotal(freshTotal, quote.currency, quote.rates),
    });
  }

  const fields = paymentFieldErrors(input, true);
  if (Object.keys(fields).length > 0) throw validation(fields);

  const property = await loadProperty(quote.property);
  if (!property) throw notFound();
  const inv = await loadInventory([quote.property], quote.in_date, addDays(quote.out_date, 1), {
    excludeHold: hold.id,
  });
  const counts = new Map<string, number>();
  for (const room of quote.data.rooms) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1);
  const reason = checkSelection(inv, counts, {
    inDate: quote.in_date,
    outDate: quote.out_date,
    todayLocal: localDate(property.zone, nowMs()),
  });
  if (reason) throw restricted(reason);

  const outcome = cardOutcome(input.card_number, input.step_up_code);
  if (outcome !== 'approved') throw new ApiError(402, { error: 'card', outcome });

  const code = newBookingCode();
  const dates = datesBetween(quote.in_date, quote.out_date);
  await withTx(async (client) => {
    await client.query(
      `insert into bookings (code, version, visitor, username, property, in_date, out_date,
         given_name, surname, card_last4, currency, rates, tier, created_at)
       values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        code,
        quote.visitor,
        quote.username,
        quote.property,
        quote.in_date,
        quote.out_date,
        input.given_name.trim(),
        input.surname.trim(),
        last4(input.card_number),
        quote.currency,
        JSON.stringify(quote.rates),
        quote.tier,
        new Date(nowMs()).toISOString(),
      ],
    );
    let n = 1;
    for (const room of quote.data.rooms) {
      await client.query(
        `insert into booking_rooms (code, n, room_type, plan, breakfast, adults, ages, state,
           nights, total_minor, paid_minor)
         values ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$9)`,
        [
          code,
          n,
          room.room_type,
          room.plan,
          room.breakfast,
          room.adults,
          room.ages,
          JSON.stringify(room.nights),
          room.total_minor,
        ],
      );
      for (const date of dates) {
        await client.query(
          `insert into claims (kind, code, room_n, room_type, date) values ('booking', $1, $2, $3, $4)`,
          [code, n, room.room_type, date],
        );
      }
      n += 1;
    }
    await client.query(`update claims set active = false where hold_id = $1`, [hold.id]);
    await client.query(`update holds set state = 'booked' where id = $1`, [hold.id]);
    await client.query(`insert into reviews (property, code, username, visitor, token, state)
       values ($1,$2,$3,$4,$5,'unused')`, [
      quote.property,
      code,
      quote.username,
      quote.visitor,
      newId(16),
    ]);
  });
  await addLedgerPair(code, 'charge', 'from_guest', quote.data.total_minor);
  const booking = await bookingObject(code);
  if (!booking) throw notFound();
  return booking;
}

/** The same selection priced now, with the current tier and rates. */
export async function repriceQuote(quote: QuoteRow): Promise<number> {
  const property = await loadProperty(quote.property);
  if (!property) return quote.data.total_minor;
  const inv = await loadInventory([quote.property], quote.in_date, addDays(quote.out_date, 1), {
    excludeHold: quote.hold_id ?? undefined,
  });
  const ctx = makeStayContext(
    property,
    quote.in_date,
    quote.out_date,
    localDate(property.zone, nowMs()),
    tierPct(quote.tier),
  );
  const priced = priceStay(
    ctx,
    inv,
    quote.data.rooms.map((room) => ({
      room_type: room.room_type,
      plan: room.plan,
      breakfast: room.breakfast,
      adults: room.adults,
      ages: room.ages,
    })),
  );
  return priced.total_minor;
}

export interface CancellationPreview {
  refund_minor: number;
  refund_pct: number;
}

export async function cancellationPreview(code: string, roomNumbers: number[]): Promise<CancellationPreview> {
  const row = await loadBookingRow(code);
  if (!row) throw notFound();
  const property = await loadProperty(row.property);
  if (!property) throw notFound();
  const rooms = await loadRooms(code);
  const chosen = rooms.filter((room) => roomNumbers.includes(room.n));
  if (chosen.length === 0 || chosen.some((room) => !ACTIVE_STATES.includes(room.state))) {
    throw conflict('invalid_state');
  }
  const at = nowMs();
  let refund = 0;
  let pct = 0;
  for (const room of chosen) {
    const status = refundStatus(property, row.in_date, at, [room.plan]);
    pct = Math.max(pct, status.refund_pct);
    refund += pctOf(room.paid_minor - room.refunded_minor, status.refund_pct);
  }
  return { refund_minor: refund, refund_pct: pct };
}

export async function cancelRooms(code: string, roomNumbers: number[]): Promise<{ refund_minor: number }> {
  const row = await loadBookingRow(code);
  if (!row) throw notFound();
  const property = await loadProperty(row.property);
  if (!property) throw notFound();
  const rooms = await loadRooms(code);
  const chosen = rooms.filter((room) => roomNumbers.includes(room.n));
  if (chosen.length === 0 || chosen.some((room) => !ACTIVE_STATES.includes(room.state))) {
    throw conflict('invalid_state');
  }
  const at = nowMs();
  let refund = 0;
  const perRoom: { n: number; refund: number }[] = [];
  for (const room of chosen) {
    const status = refundStatus(property, row.in_date, at, [room.plan]);
    const amount = pctOf(room.paid_minor - room.refunded_minor, status.refund_pct);
    perRoom.push({ n: room.n, refund: amount });
    refund += amount;
  }
  const dates = await withTx(async (client) => {
    for (const entry of perRoom) {
      await client.query(
        `update booking_rooms set state = 'cancelled', cancelled_at = $3,
           refunded_minor = refunded_minor + $4 where code = $1 and n = $2`,
        [code, entry.n, new Date(at).toISOString(), entry.refund],
      );
    }
    const claims = await client.query<{ date: string }>(
      `update claims set active = false
       where code = $1 and room_n = any($2) and active
       returning to_char(date, 'YYYY-MM-DD') as date`,
      [code, perRoom.map((entry) => entry.n)],
    );
    await client.query('update bookings set version = version + 1 where code = $1', [code]);
    return [...new Set(claims.rows.map((r) => r.date))];
  });
  await addLedgerPair(code, 'refund', 'to_guest', refund);
  broadcast('availability', { property: row.property, room_type: null, dates });
  return { refund_minor: refund };
}

export interface ChangePreview {
  new_total_minor: number;
  paid_minor: number;
  pay_minor?: number;
  refund_minor?: number;
}

export async function changePreview(code: string, inDate: string, outDate: string): Promise<ChangePreview> {
  const row = await loadBookingRow(code);
  if (!row) throw notFound();
  const property = await loadProperty(row.property);
  if (!property) throw notFound();
  const rooms = await loadRooms(code);
  const active = rooms.filter((room) => ACTIVE_STATES.includes(room.state));
  const today = localDate(property.zone, nowMs());
  if (active.length === 0 || row.in_date <= today) throw conflict('invalid_state');
  if (active.some((room) => room.plan === 'nonrefundable')) throw new ApiError(422, { error: 'nonrefundable' });
  if (!parseDate(inDate) || !parseDate(outDate) || diffDays(inDate, outDate) < 1) {
    throw validation({ in: 'invalid', out: 'invalid' });
  }
  if (diffDays(inDate, outDate) > 30) throw validation({ out: 'out_of_range' });

  const inv = await loadInventory([row.property], inDate, addDays(outDate, 1), { excludeBooking: code });
  const counts = new Map<string, number>();
  for (const room of active) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1);
  const reason = checkSelection(inv, counts, { inDate, outDate, todayLocal: today });
  if (reason) throw restricted(reason);

  const currentTier = row.tier;
  const ctx = makeStayContext(property, inDate, outDate, today, tierPct(currentTier));
  const priced = priceStay(
    ctx,
    inv,
    active.map((room) => ({
      room_type: room.room_type,
      plan: room.plan,
      breakfast: room.breakfast,
      adults: room.adults,
      ages: room.ages,
    })),
  );
  const paid = active.reduce((sum, room) => sum + room.paid_minor - room.refunded_minor, 0);
  const difference = priced.total_minor - paid;
  if (difference > 0) return { new_total_minor: priced.total_minor, paid_minor: paid, pay_minor: difference };
  const status = refundStatus(property, row.in_date, nowMs(), active.map((room) => room.plan));
  const refund = pctOf(Math.abs(difference), status.refund_pct);
  return { new_total_minor: priced.total_minor, paid_minor: paid, refund_minor: refund };
}

export interface ChangeInput {
  code: string;
  in: string;
  out: string;
  card_number?: unknown;
  expiry?: unknown;
  security_code?: unknown;
  step_up_code?: unknown;
}

export async function applyChange(input: ChangeInput, tier: TierName): Promise<Booking> {
  const preview = await changePreview(input.code, input.in, input.out);
  const row = (await loadBookingRow(input.code))!;
  const property = (await loadProperty(row.property))!;
  const rooms = await loadRooms(input.code);
  const active = rooms.filter((room) => ACTIVE_STATES.includes(room.state));
  const today = localDate(property.zone, nowMs());

  if ((preview.pay_minor ?? 0) > 0) {
    const fields = paymentFieldErrors(input, false);
    if (Object.keys(fields).length > 0) throw validation(fields);
    const outcome = cardOutcome(String(input.card_number), input.step_up_code);
    if (outcome !== 'approved') throw new ApiError(402, { error: 'card', outcome });
  }

  const inv = await loadInventory([row.property], input.in, addDays(input.out, 1), { excludeBooking: input.code });
  const ctx = makeStayContext(property, input.in, input.out, today, tierPct(tier));
  const priced = priceStay(
    ctx,
    inv,
    active.map((room) => ({
      room_type: room.room_type,
      plan: room.plan,
      breakfast: room.breakfast,
      adults: room.adults,
      ages: room.ages,
    })),
  );
  const newDates = datesBetween(input.in, input.out);
  const oldWeights = active.map((room) => room.paid_minor - room.refunded_minor);
  const pay = preview.pay_minor ?? 0;
  const refund = preview.refund_minor ?? 0;
  const payShares = distribute(pay, priced.rooms.map((room) => room.total_minor));
  const refundShares = distribute(refund, oldWeights);

  const freedDates = await withTx(async (client) => {
    const claims = await client.query<{ date: string }>(
      `update claims set active = false where code = $1 and active
       returning to_char(date, 'YYYY-MM-DD') as date`,
      [input.code],
    );
    await client.query('update bookings set in_date = $2, out_date = $3, version = version + 1 where code = $1', [
      input.code,
      input.in,
      input.out,
    ]);
    for (let i = 0; i < active.length; i++) {
      const room = active[i];
      const pricedRoom = priced.rooms[i];
      await client.query(
        `update booking_rooms set state = 'changed', nights = $3, total_minor = $4,
           paid_minor = paid_minor + $5, refunded_minor = refunded_minor + $6
         where code = $1 and n = $2`,
        [
          input.code,
          room.n,
          JSON.stringify(pricedRoom.nights),
          pricedRoom.total_minor,
          payShares[i],
          refundShares[i],
        ],
      );
      for (const date of newDates) {
        await client.query(
          `insert into claims (kind, code, room_n, room_type, date) values ('booking', $1, $2, $3, $4)`,
          [input.code, room.n, room.room_type, date],
        );
      }
    }
    return [...new Set(claims.rows.map((r) => r.date))];
  });

  if (pay > 0) await addLedgerPair(input.code, 'change', 'from_guest', pay);
  if (refund > 0) await addLedgerPair(input.code, 'change', 'to_guest', refund);
  broadcast('availability', {
    property: row.property,
    room_type: null,
    dates: [...new Set([...freedDates, ...newDates])],
  });
  const booking = await bookingObject(input.code);
  if (!booking) throw notFound();
  return booking;
}

/** Splits an amount by weights, the remainder going to the earlier rooms. */
function distribute(amount: number, weights: number[]): number[] {
  if (amount === 0 || weights.length === 0) return weights.map(() => 0);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0) {
    const out = weights.map(() => 0);
    out[0] = amount;
    return out;
  }
  const shares = weights.map((w) => Math.floor((amount * w) / total));
  let rest = amount - shares.reduce((sum, s) => sum + s, 0);
  for (let i = 0; i < shares.length && rest > 0; i++) {
    shares[i] += 1;
    rest -= 1;
  }
  return shares;
}

export async function markNoShow(code: string): Promise<Booking> {
  const row = await loadBookingRow(code);
  if (!row) throw notFound();
  const property = (await loadProperty(row.property))!;
  const rooms = await loadRooms(code);
  const active = rooms.filter((room) => ACTIVE_STATES.includes(room.state));
  if (active.length === 0) throw conflict('invalid_state');
  if (!noShowOpenAt(property.zone, row.in_date, rooms, nowMs())) throw conflict('too_early');
  await withTx(async (client) => {
    await client.query(
      `update booking_rooms set state = 'no_show' where code = $1 and state = any($2)`,
      [code, ACTIVE_STATES],
    );
    await client.query('update bookings set version = version + 1 where code = $1', [code]);
  });
  const booking = await bookingObject(code);
  if (!booking) throw notFound();
  return booking;
}

export interface Viewer extends Owner {
  manages: string[];
  role: string | null;
}

/** Booking access: the maker, a visitor that found it, and managers of its property. */
export async function canSeeBooking(code: string, viewer: Viewer): Promise<boolean> {
  const row = await loadBookingRow(code);
  if (!row) return false;
  if (viewer.username && row.username === viewer.username) return true;
  if (!row.username && viewer.visitorId && row.visitor === viewer.visitorId) return true;
  if (viewer.manages.includes(row.property)) return true;
  if (viewer.visitorId) {
    const found = await one('select 1 from booking_access where code = $1 and visitor = $2', [code, viewer.visitorId]);
    if (found) return true;
  }
  return false;
}

export async function grantAccess(code: string, visitorId: string): Promise<void> {
  await query('insert into booking_access (code, visitor) values ($1,$2) on conflict do nothing', [code, visitorId]);
}

export async function findBooking(code: string, surname: string): Promise<string | null> {
  const row = await one<{ code: string }>(
    `select code from bookings where upper(code) = upper($1) and lower(btrim(surname)) = lower(btrim($2))`,
    [code, surname],
  );
  return row ? row.code : null;
}


