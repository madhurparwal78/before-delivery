import type { Quote } from '../../shared/types.js';
import { queryOne, type Sql } from '../db/pool.js';
import { packBalanceQuarters } from './pack.js';
import {
  priceCells,
  toQuote,
  type CellRef,
  type Priced,
  type RateCardRecord,
  type StationRef,
} from './pricing.js';
import { monthOf } from './time.js';

/** Holds and in-window cancellations do not count toward monthly tiers. */
export const TIER_COUNTING_STATES = [
  'confirmed',
  'checked_in',
  'completed',
  'cancelled_late',
  'no_show',
] as const;

export async function monthQuarters(
  client: Sql,
  memberId: string,
  month: string,
): Promise<number> {
  const row = await queryOne<{ quarters: string }>(
    client,
    `SELECT count(*)::text AS quarters
       FROM booking_cells bc
       JOIN bookings b ON b.id = bc.booking_id
      WHERE b.member_id = $1
        AND b.state = ANY($2::text[])
        AND to_char(b.date, 'YYYY-MM') = $3`,
    [memberId, [...TIER_COUNTING_STATES], month],
  );
  return row ? Number(row.quarters) : 0;
}

export interface QuoteResult {
  quote: Quote;
  priced: Priced;
  month_quarters_before: number;
  pack_balance: number;
}

export async function quoteCells(
  client: Sql,
  input: {
    memberId: string;
    date: string;
    cells: readonly CellRef[];
    usePack: boolean;
    stations: Map<string, StationRef>;
    rateCard: RateCardRecord;
  },
): Promise<QuoteResult> {
  const before = await monthQuarters(client, input.memberId, monthOf(input.date));
  const balance = await packBalanceQuarters(client, input.memberId);
  const priced = priceCells({
    cells: input.cells,
    stations: input.stations,
    rateCard: input.rateCard,
    monthQuartersBefore: before,
    packQuartersAvailable: input.usePack ? balance : 0,
  });
  return {
    quote: toQuote(priced, input.date, before, input.rateCard.id),
    priced,
    month_quarters_before: before,
    pack_balance: balance,
  };
}
