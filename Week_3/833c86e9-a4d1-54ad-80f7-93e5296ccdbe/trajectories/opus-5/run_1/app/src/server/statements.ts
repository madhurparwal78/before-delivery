import { pctOf } from '../shared/money';
import { COMMISSION_PCT } from './config';
import { query } from './db';
import { csvLine } from './csv';
import { QuoteNightRoom } from '../shared/types';
import { addMonths, lastOfMonth, localDate, monthOf } from './zone';

export interface StatementLine {
  code: string;
  kind: 'stay' | 'cancellation';
  base_minor: number;
  commission_minor: number;
}

export interface Statement {
  month: string;
  lines: StatementLine[];
  total_base_minor: number;
  total_commission_minor: number;
  downloadable: boolean;
}

/** One stay line per booking checking out in the month, plus cancellation lines. */
export async function statementFor(property: string, month: string, zone: string, nowMs: number): Promise<Statement> {
  const stays = await query<{ code: string; nights: QuoteNightRoom[] }>(
    `select r.code, r.nights
     from booking_rooms r join bookings b on b.code = r.code
     where b.property = $1 and to_char(b.out_date, 'YYYY-MM') = $2 and r.state <> 'cancelled'`,
    [property, month],
  );
  const stayBases = new Map<string, number>();
  for (const row of stays) {
    const base = row.nights.reduce((sum, night) => sum + night.taxable_minor, 0);
    stayBases.set(row.code, (stayBases.get(row.code) ?? 0) + base);
  }
  const cancellations = await query<{ code: string; retained: number; cancelled_at: string }>(
    `select r.code, (r.paid_minor - r.refunded_minor) as retained,
       to_char(r.cancelled_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cancelled_at
     from booking_rooms r join bookings b on b.code = r.code
     where b.property = $1 and r.state = 'cancelled' and r.cancelled_at is not null`,
    [property],
  );
  const cancelBases = new Map<string, number>();
  for (const row of cancellations) {
    if (monthOf(localDate(zone, new Date(row.cancelled_at).getTime())) !== month) continue;
    cancelBases.set(row.code, (cancelBases.get(row.code) ?? 0) + Number(row.retained));
  }
  const lines: StatementLine[] = [];
  for (const [code, base] of [...stayBases.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    lines.push({ code, kind: 'stay', base_minor: base, commission_minor: pctOf(base, COMMISSION_PCT) });
  }
  for (const [code, base] of [...cancelBases.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    lines.push({ code, kind: 'cancellation', base_minor: base, commission_minor: pctOf(base, COMMISSION_PCT) });
  }
  const totalBase = lines.reduce((sum, line) => sum + line.base_minor, 0);
  const totalCommission = lines.reduce((sum, line) => sum + line.commission_minor, 0);
  return {
    month,
    lines,
    total_base_minor: totalBase,
    total_commission_minor: totalCommission,
    downloadable: lastOfMonth(month) < localDate(zone, nowMs),
  };
}

export function statementCsv(statement: Statement): string {
  let out = 'code,kind,base_minor,commission_minor\n';
  for (const line of statement.lines) {
    out += csvLine([line.code, line.kind, line.base_minor, line.commission_minor]);
  }
  out += csvLine(['total', '', statement.total_base_minor, statement.total_commission_minor]);
  return out;
}

/** Months from the property's first booking month to the property-local month. */
export async function statementMonths(property: string, zone: string, nowMs: number): Promise<string[]> {
  const current = monthOf(localDate(zone, nowMs));
  const rows = await query<{ first: string | null }>(
    `select to_char(min(created_at), 'YYYY-MM') as first from bookings where property = $1`,
    [property],
  );
  const first = rows[0]?.first ?? current;
  const months: string[] = [];
  for (let month = first; month <= current; month = addMonths(month, 1)) months.push(month);
  return months.reverse();
}

export async function reservationRows(property: string): Promise<
  {
    code: string;
    surname: string;
    arrival: string;
    departure: string;
    rooms: number;
    total_minor: number;
    state: string;
  }[]
> {
  const rows = await query<{
    code: string;
    surname: string;
    arrival: string;
    departure: string;
    rooms: string;
    total_minor: string;
    states: string[];
  }>(
    `select b.code, b.surname, to_char(b.in_date, 'YYYY-MM-DD') as arrival,
       to_char(b.out_date, 'YYYY-MM-DD') as departure,
       count(*) filter (where r.state <> 'cancelled') as rooms,
       coalesce(sum(r.paid_minor - r.refunded_minor), 0) as total_minor,
       array_agg(r.state) as states
     from bookings b join booking_rooms r on r.code = b.code
     where b.property = $1
     group by b.code, b.surname, b.in_date, b.out_date
     order by b.in_date, b.code`,
    [property],
  );
  return rows
    .filter((row) => row.states.some((state) => state !== 'held' && state !== 'expired'))
    .map((row) => ({
      code: row.code,
      surname: row.surname,
      arrival: row.arrival,
      departure: row.departure,
      rooms: Number(row.rooms),
      total_minor: Number(row.total_minor),
      state: row.states.every((state) => state === 'cancelled') ? 'cancelled' : row.states[0],
    }));
}

export function reservationsCsv(
  rows: { code: string; surname: string; arrival: string; departure: string; rooms: number; total_minor: number }[],
): string {
  let out = 'code,surname,arrival,departure,rooms,total_minor\n';
  for (const row of rows) {
    out += csvLine([row.code, row.surname, row.arrival, row.departure, row.rooms, row.total_minor]);
  }
  return out;
}
