import { sortSeats, UPLIFT_MAX, UPLIFT_MIN, type Fare, type Tier } from '../../shared/domain.ts';
import { one, query, transaction, type Tx } from '../db/pool.ts';
import { env } from '../env.ts';
import { ApiError } from '../http/errors.ts';
import { assertBillingUp } from './guard.ts';
import { Validator } from '../http/validate.ts';
import { holdId as newHoldId } from '../domain/ids.ts';
import { admissionTotals, creditApplied, type Totals } from '../domain/pricing.ts';
import { defaultFares, firstInvalidFareSeat, type FareContext } from '../domain/fares.ts';
import { derivedState } from '../domain/seasons.ts';
import { addCalendarDays, toIso } from '../domain/time.ts';
import { getScreening, getSeason, seatCodes, type ScreeningRow } from '../repo/screenings.ts';
import { creditBalance } from '../repo/credit.ts';
import { activeTier, hasLiveVerification } from './membership.ts';

export type HoldRow = {
  id: string;
  screening_id: string;
  account_id: number | null;
  guest_key: string | null;
  is_group: boolean;
  state: 'held' | 'paid' | 'expired';
  ended_by: 'patron' | 'timeout' | 'season' | null;
  created_at: Date;
  expires_at: Date;
  booking_id: number | null;
  last_quote_total_cents: number | null;
};

export type HoldPayload = {
  id: string;
  screening_id: string;
  seats: string[];
  group: boolean;
  state: 'held' | 'expired' | 'paid';
  ended_by: 'patron' | 'timeout' | 'season' | null;
  expires_at: string;
  server_time: string;
  booking_ref: string | null;
};

export type Owner = { accountId: number | null; guestKey: string | null };

export async function holdSeats(holdId: string): Promise<string[]> {
  const rows = await query<{ seat: string }>(
    'select seat from hold_seats where hold_id = $1 order by seat_sort(seat)',
    [holdId],
  );
  return rows.map((row) => row.seat);
}

export async function getHold(id: string): Promise<HoldRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return one<HoldRow>(
    `select id::text as id, screening_id, account_id, guest_key, is_group, state, ended_by,
            created_at, expires_at, booking_id, last_quote_total_cents
       from holds where id = $1`,
    [id],
  );
}

export function ownsHold(hold: HoldRow, owner: Owner): boolean {
  if (hold.account_id !== null) return owner.accountId === hold.account_id;
  return hold.guest_key !== null && hold.guest_key === owner.guestKey;
}

/** Hold liveness: live while server time is strictly before expires_at. */
export function holdIsLive(hold: HoldRow, now: Date): boolean {
  return hold.state === 'held' && now.getTime() < hold.expires_at.getTime();
}

export function assertHoldUsable(hold: HoldRow, now: Date): void {
  if (hold.state === 'paid') throw new ApiError('hold_already_paid');
  if (!holdIsLive(hold, now)) throw new ApiError('hold_expired');
}

export async function holdPayload(hold: HoldRow, now: Date): Promise<HoldPayload> {
  const seats = await holdSeats(hold.id);
  const expired = hold.state === 'held' && now.getTime() >= hold.expires_at.getTime();
  let bookingRef: string | null = null;
  if (hold.booking_id !== null) {
    const row = await one<{ ref: string }>('select ref from bookings where id = $1', [hold.booking_id]);
    bookingRef = row?.ref ?? null;
  }
  return {
    id: hold.id,
    screening_id: hold.screening_id,
    seats,
    group: hold.is_group,
    state: expired ? 'expired' : hold.state,
    ended_by: expired ? 'timeout' : hold.ended_by,
    expires_at: toIso(hold.expires_at),
    server_time: toIso(now),
    booking_ref: bookingRef,
  };
}

/** Who may hold seats, by the season's derived state. */
export async function assertSaleOpen(
  screening: ScreeningRow,
  now: Date,
  options: { isMember: boolean },
): Promise<void> {
  const season = await getSeason(screening.season_slug);
  if (season === null) throw new ApiError('not_found');
  const state = derivedState(season.stored_state, season.public_sale_date, now);
  if (state === 'draft') throw new ApiError('not_found');
  if (state === 'archived' || state === 'withdrawn') throw new ApiError('screening_closed');
  if (screening.starts_at.getTime() <= now.getTime()) throw new ApiError('screening_closed');
  if (state === 'scheduled') {
    throw new ApiError('not_on_sale', { args: { date: addCalendarDays(season.public_sale_date, -3) } });
  }
  if (state === 'member-priority' && !options.isMember) {
    throw new ApiError('members_priority', { args: { date: season.public_sale_date } });
  }
}

export async function createHold(input: {
  screeningId: unknown;
  seats: unknown;
  group: unknown;
  owner: Owner;
  tier: Tier | null;
}): Promise<{ hold: HoldRow; now: Date }> {
  const validator = new Validator();
  const screeningId = typeof input.screeningId === 'string' ? input.screeningId : '';
  if (screeningId === '') validator.required('screening_id');
  validator.check();

  const group = input.group === true;
  const seatList = Array.isArray(input.seats)
    ? input.seats.filter((seat): seat is string => typeof seat === 'string')
    : [];

  const screening = await getScreening(screeningId);
  if (screening === null) throw new ApiError('not_found');
  if (group && input.owner.accountId === null) throw new ApiError('unauthenticated');

  const nowRow = await one<{ now: Date }>('select now() as now');
  const now = nowRow!.now;
  await assertSaleOpen(screening, now, { isMember: input.tier !== null });

  const available = new Set(seatCodes(screening.row_letters, screening.seats_per_row));
  const unique = new Set(seatList);
  const minimum = group ? 10 : 1;
  const maximum = group ? 40 : 10;
  if (
    seatList.length < minimum ||
    seatList.length > maximum ||
    unique.size !== seatList.length ||
    seatList.some((seat) => !available.has(seat))
  ) {
    validator.add('seats', group ? 'field_group_seat_count' : 'field_seat_count');
  }
  validator.check();

  assertBillingUp();
  const seats = sortSeats(seatList);
  const id = newHoldId();
  return transaction(async (tx) => {
    const created = await tx.one<HoldRow>(
      `insert into holds(id, screening_id, account_id, guest_key, is_group, state, created_at, expires_at)
         values($1,$2,$3,$4,$5,'held', now(), now() + make_interval(secs => $6::int))
         returning id::text as id, screening_id, account_id, guest_key, is_group, state, ended_by,
                   created_at, expires_at, booking_id, last_quote_total_cents`,
      [id, screening.id, input.owner.accountId, input.owner.guestKey, group, env.holdTtlSeconds],
    );
    const claimed: string[] = [];
    for (const seat of seats) {
      const rows = await tx.query<{ seat: string }>(
        `insert into seat_claims(screening_id, seat, hold_id, booking_id, sold, expires_at)
           values($1,$2,$3,null,false,(select expires_at from holds where id = $3))
         on conflict (screening_id, seat) do update
           set hold_id = excluded.hold_id, booking_id = null, sold = false, expires_at = excluded.expires_at
           where seat_claims.sold = false
             and (seat_claims.expires_at is null or seat_claims.expires_at <= now())
         returning seat`,
        [screening.id, seat, id],
      );
      if (rows.length === 1) claimed.push(seat);
    }
    if (claimed.length !== seats.length) {
      throw new ApiError('seat_taken', { seats: seats.filter((seat) => !claimed.includes(seat)) });
    }
    for (const seat of seats) {
      await tx.query('insert into hold_seats(hold_id, seat) values($1,$2)', [id, seat]);
    }
    return { hold: created!, now };
  });
}

export async function releaseHold(hold: HoldRow): Promise<number> {
  return transaction(async (tx) => {
    await tx.query("update holds set state='expired', ended_by='patron' where id = $1", [hold.id]);
    await tx.query('delete from seat_claims where hold_id = $1 and sold = false', [hold.id]);
    return hold.last_quote_total_cents ?? 0;
  });
}

export type QuoteContext = {
  hold: HoldRow;
  seats: string[];
  fares: Record<string, Fare>;
  uplift_cents: number;
  totals: Totals;
  credit_balance_cents: number;
  credit_applied_cents: number;
  pay_now_cents: number;
  stepup_required: boolean;
};

export function fareContext(hold: HoldRow, tier: Tier | null): FareContext {
  return { tier: hold.is_group ? null : tier, group: hold.is_group };
}

export function validateFares(
  seats: string[],
  provided: unknown,
  context: FareContext,
  validator: Validator,
): Record<string, Fare> {
  const fares: Record<string, Fare> = defaultFares(seats, context);
  if (provided !== undefined && provided !== null) {
    if (typeof provided !== 'object') {
      validator.add('fares', 'field_fare');
      return fares;
    }
    for (const [seat, fare] of Object.entries(provided as Record<string, unknown>)) {
      if (!seats.includes(seat) || typeof fare !== 'string') {
        validator.add(`fares.${seat}`, 'field_fare');
        continue;
      }
      fares[seat] = fare as Fare;
    }
  }
  const invalid = firstInvalidFareSeat(fares, context);
  if (invalid !== null) validator.add(`fares.${invalid}`, 'field_fare');
  return fares;
}

export function validateUplift(value: unknown, validator: Validator): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    validator.add('uplift_cents', 'field_uplift');
    return 0;
  }
  if (value === 0) return 0;
  if (value < UPLIFT_MIN || value > UPLIFT_MAX) {
    validator.add('uplift_cents', 'field_uplift');
    return 0;
  }
  return value;
}

export async function buildQuote(input: {
  hold: HoldRow;
  accountId: number | null;
  accountNumber: string | null;
  sessionToken: string | null;
  fares: unknown;
  uplift: unknown;
  now: Date;
}): Promise<QuoteContext> {
  const seats = await holdSeats(input.hold.id);
  const tier = await activeTier(input.accountId);
  const context = fareContext(input.hold, tier);
  const validator = new Validator();
  const fares = validateFares(seats, input.fares, context, validator);
  const uplift = validateUplift(input.uplift, validator);
  validator.check();
  const totals = admissionTotals(fares, uplift);
  const balance = await creditBalance(input.accountNumber);
  const credit = creditApplied(balance, totals.total_cents);
  const verified = await hasLiveVerification(input.sessionToken, input.now);
  return {
    hold: input.hold,
    seats,
    fares,
    uplift_cents: uplift,
    totals,
    credit_balance_cents: balance,
    credit_applied_cents: credit,
    pay_now_cents: totals.total_cents - credit,
    stepup_required: credit > 0 && !verified,
  };
}

export function quotePayload(quote: QuoteContext): Record<string, unknown> {
  return {
    lines: quote.totals.lines,
    admission_cents: quote.totals.admission_cents,
    gst_cents: quote.totals.gst_cents,
    qst_cents: quote.totals.qst_cents,
    uplift_cents: quote.totals.uplift_cents,
    total_cents: quote.totals.total_cents,
    credit_applied_cents: quote.credit_applied_cents,
    paid_cents: quote.pay_now_cents,
    pay_now_cents: quote.pay_now_cents,
    currency: 'CAD',
    stepup_required: quote.stepup_required,
  };
}

export async function rememberQuoteTotal(holdId: string, totalCents: number): Promise<void> {
  await query('update holds set last_quote_total_cents = $2 where id = $1', [holdId, totalCents]);
}

export async function liveHoldIdsFor(owner: Owner, screeningId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select id::text as id from holds
       where screening_id = $1 and state = 'held' and expires_at > now()
         and ((account_id is not null and account_id = $2) or (guest_key is not null and guest_key = $3))`,
    [screeningId, owner.accountId, owner.guestKey],
  );
  return rows.map((row) => row.id);
}

export async function lockHold(tx: Tx, id: string): Promise<HoldRow | null> {
  return tx.one<HoldRow>(
    `select id::text as id, screening_id, account_id, guest_key, is_group, state, ended_by,
            created_at, expires_at, booking_id, last_quote_total_cents
       from holds where id = $1 for update`,
    [id],
  );
}
