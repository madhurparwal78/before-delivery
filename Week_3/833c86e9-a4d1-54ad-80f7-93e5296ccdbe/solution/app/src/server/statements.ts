import { localDate } from '../shared/dates'
import { COMMISSION_PCT } from './config'
import { rows, type Db } from './db'
import { ENDED_STATES, rnd } from '../shared/rules'
import { csvText } from './csv'

interface StatementLine { code: string; kind: 'stay' | 'cancellation'; base_minor: number; commission_minor: number }

const commission = (base: number): number => rnd(base * COMMISSION_PCT, 100)

export async function statement(db: Db, property: string, zone: string, month: string) {
  const stays = await rows<{ code: string; base: number }>(
    db,
    `SELECT b.code, COALESCE(sum((SELECT sum((night.value->>'taxable_minor')::int) FROM jsonb_array_elements(r.nights) AS night(value))), 0)::int AS base
       FROM bookings b JOIN booking_rooms r ON r.booking = b.code
      WHERE b.property = $1 AND to_char(b.out_date, 'YYYY-MM') = $2 AND r.state IN ('confirmed', 'changed', 'no_show', 'completed')
      GROUP BY b.code ORDER BY b.code`,
    [property, month],
  )
  const cancelled = await rows<{ code: string; retained_minor: number; at: Date }>(
    db, `SELECT booking AS code, retained_minor, at FROM cancellations WHERE property = $1 ORDER BY booking, id`, [property])
  const lines: StatementLine[] = [
    ...stays.map((stay): StatementLine => ({ code: stay.code, kind: 'stay', base_minor: stay.base, commission_minor: commission(stay.base) })),
    ...cancelled.filter((entry) => localDate(entry.at, zone).slice(0, 7) === month).map((entry): StatementLine => ({ code: entry.code, kind: 'cancellation', base_minor: entry.retained_minor, commission_minor: commission(entry.retained_minor) })),
  ]
  return {
    month, lines,
    total_base_minor: lines.reduce((sum, line) => sum + line.base_minor, 0),
    total_commission_minor: lines.reduce((sum, line) => sum + line.commission_minor, 0),
  }
}

export function statementCsv(data: Awaited<ReturnType<typeof statement>>): string {
  return csvText([
    ['code', 'kind', 'base_minor', 'commission_minor'],
    ...data.lines.map((line) => [line.code, line.kind, line.base_minor, line.commission_minor]),
    ['total', '', data.total_base_minor, data.total_commission_minor],
  ])
}

/** Months from the property's first booking month to the current property-local month, newest first. */
export async function months(db: Db, property: string, zone: string, now: Date): Promise<string[]> {
  const first = await rows<{ at: Date }>(db, `SELECT min(at) AS at FROM (SELECT created_at AS at FROM bookings WHERE property = $1 UNION ALL SELECT at FROM cancellations WHERE property = $1) x`, [property])
  const current = localDate(now, zone).slice(0, 7)
  const start = first[0]?.at ? localDate(first[0].at, zone).slice(0, 7) : current
  const list: string[] = []
  let [year, month] = current.split('-').map(Number)
  while (`${year}-${String(month).padStart(2, '0')}` >= start && list.length < 120) {
    list.push(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return list
}

export const downloadable = (month: string, zone: string, now: Date): boolean => month < localDate(now, zone).slice(0, 7)

export async function reservations(db: Db, property: string) {
  return rows<{ code: string; surname: string; arrival: string; departure: string; rooms: number; total_minor: number; state: string }>(
    db,
    `SELECT b.code, b.surname, b.in_date AS arrival, b.out_date AS departure,
            count(*) FILTER (WHERE r.state <> ALL($2))::int AS rooms,
            COALESCE(sum(r.paid_minor - r.refunded_minor), 0)::int AS total_minor,
            CASE WHEN count(*) FILTER (WHERE r.state <> ALL($2)) = 0 THEN 'cancelled'
                 ELSE (array_agg(r.state ORDER BY r.n) FILTER (WHERE r.state <> ALL($2)))[1] END AS state
       FROM bookings b JOIN booking_rooms r ON r.booking = b.code
      WHERE b.property = $1 GROUP BY b.code HAVING bool_or(r.state NOT IN ('held', 'expired')) ORDER BY b.in_date, b.code`,
    [property, ENDED_STATES],
  )
}

export const reservationsCsv = (list: Awaited<ReturnType<typeof reservations>>): string =>
  csvText([['code', 'surname', 'arrival', 'departure', 'rooms', 'total_minor'], ...list.map((row) => [row.code, row.surname, row.arrival, row.departure, row.rooms, row.total_minor])])
