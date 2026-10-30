import type { RateEntry, ServiceLine } from '../domain/types.js';
import { query, type Transaction } from './pool.js';

interface RateRow {
  org_code: string;
  service_line: ServiceLine;
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

function toEntry(row: RateRow): RateEntry {
  return {
    orgCode: row.org_code,
    serviceLine: row.service_line,
    effectiveFrom: row.effective_from,
    hourlyRateCents: row.hourly_rate_cents,
    mileageCentsPerMile: row.mileage_cents_per_mile,
  };
}

const SELECT =
  'select org_code, service_line, effective_from::text as effective_from, hourly_rate_cents, mileage_cents_per_mile from rate_cards';

export async function listRateEntries(orgCode?: string): Promise<RateEntry[]> {
  const rows =
    orgCode === undefined
      ? await query<RateRow>(`${SELECT} order by effective_from, service_line`)
      : await query<RateRow>(`${SELECT} where org_code = $1 order by effective_from, service_line`, [
          orgCode,
        ]);
  return rows.map(toEntry);
}

export async function listRateEntriesIn(tx: Transaction, orgCode: string): Promise<RateEntry[]> {
  const rows = await tx.query<RateRow>(`${SELECT} where org_code = $1 order by effective_from`, [
    orgCode,
  ]);
  return rows.map(toEntry);
}

export async function insertRateEntry(entry: RateEntry): Promise<RateEntry | null> {
  const rows = await query<RateRow>(
    `insert into rate_cards (org_code, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
     values ($1, $2, $3, $4, $5)
     on conflict (org_code, service_line, effective_from) do nothing
     returning org_code, service_line, effective_from::text as effective_from, hourly_rate_cents, mileage_cents_per_mile`,
    [
      entry.orgCode,
      entry.serviceLine,
      entry.effectiveFrom,
      entry.hourlyRateCents,
      entry.mileageCentsPerMile,
    ],
  );
  const row = rows[0];
  return row === undefined ? null : toEntry(row);
}
