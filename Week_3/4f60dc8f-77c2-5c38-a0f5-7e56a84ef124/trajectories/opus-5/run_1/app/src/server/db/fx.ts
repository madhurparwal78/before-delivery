import { randomUUID } from 'node:crypto';
import type { CurrencyCode } from '../../shared/money.js';
import type { RateRecord } from '../domain/fx.js';
import { query } from './pool.js';

type RateRow = { currency: CurrencyCode; rate_e4: string; effective_at: Date; seq: string };

const toRecord = (row: RateRow): RateRecord => ({
  currency: row.currency,
  rateE4: BigInt(row.rate_e4),
  effectiveAt: row.effective_at,
  seq: BigInt(row.seq),
});

export const listRates = async (): Promise<RateRecord[]> =>
  (
    await query<RateRow>(
      'SELECT currency, rate_e4, effective_at, seq FROM fx_rates ORDER BY effective_at, seq',
    )
  ).rows.map(toRecord);

export const insertRate = async (
  currency: CurrencyCode,
  rateE4: bigint,
  effectiveAt: Date,
): Promise<void> => {
  await query(
    'INSERT INTO fx_rates (id, currency, rate_e4, effective_at) VALUES ($1, $2, $3, $4)',
    [randomUUID(), currency, rateE4.toString(), effectiveAt],
  );
};

export const hasRateFor = async (currency: CurrencyCode): Promise<boolean> =>
  (
    await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM fx_rates WHERE currency = $1',
      [currency],
    )
  ).rows[0].count !== '0';
