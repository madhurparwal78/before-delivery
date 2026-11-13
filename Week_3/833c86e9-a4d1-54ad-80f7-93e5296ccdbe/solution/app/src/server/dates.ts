import { addDays, localDate, span } from '../shared/dates'
import type { DateDay, Reason } from '../shared/types'
import type { Currency } from '../shared/i18n'
import { one, rows, type Db } from './db'
import { loadNights, arrivalReason, departureReason, type NightMap } from './restrictions'
import { convertNights } from './pricing'
import { currentRates } from './quotes'
import { notFound } from './errors'

/** Availability, price-from and minimum stay for each day of a window, for a destination or one property. */
export async function datesFor(
  db: Db, target: { dest?: string; property?: string }, from: string, to: string, currency: Currency, start: string | null, ignoreBooking: string | null, now: Date,
): Promise<{ days: DateDay[] }> {
  const zoneRow = target.property
    ? await one<{ zone: string }>(db, `SELECT d.zone FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.code = $1`, [target.property])
    : await one<{ zone: string }>(db, `SELECT zone FROM destinations WHERE code = $1`, [target.dest ?? ''])
  if (!zoneRow) return notFound()
  const types = await rows<{ code: string }>(
    db,
    target.property ? `SELECT code FROM room_types WHERE property = $1 ORDER BY code` : `SELECT r.code FROM room_types r JOIN properties p ON p.code = r.property WHERE p.destination = $1 ORDER BY r.code`,
    [target.property ?? target.dest],
  )
  const codes = types.map((type) => type.code)
  const maps = await loadNights(db, codes, start && start < from ? start : from, addDays(to, 1), now, ignoreBooking)
  const today = localDate(now, zoneRow.zone)
  const ppm = (await currentRates(db))[currency]
  const mapOf = (code: string): NightMap => maps.get(code) as NightMap
  const days: DateDay[] = []
  for (const date of span(from, addDays(to, 1))) {
    const accepting = codes.filter((code) => arrivalReason(mapOf(code), date, today) === null)
    const arrivalFailure: Reason | null = accepting.length ? null : codes.length ? arrivalReason(mapOf(codes[0]), date, today) : { code: 'sold_out', date }
    const rates = accepting.map((code) => mapOf(code).get(date)!.rate_minor)
    const mins = accepting.map((code) => mapOf(code).get(date)!.min_stay)
    const day: DateDay = {
      date, available: accepting.length > 0,
      from_minor: rates.length ? convertNights([Math.min(...rates)], ppm, currency).total : null,
      min_stay: mins.length ? Math.min(...mins) : null, reason: arrivalFailure, after_start: null,
    }
    if (start && date < start) day.after_start = 'before'
    else if (start && date > start) {
      const candidates = codes.filter((code) => arrivalReason(mapOf(code), start, today) === null)
      const failures = candidates.map((code) => departureReason(mapOf(code), start, date, 1))
      const passing = candidates.filter((_, i) => failures[i] === null)
      day.available = passing.length > 0
      day.reason = passing.length ? null : candidates.length ? failures[0] : arrivalReason(mapOf(codes[0]), start, today)
      day.after_start = day.reason?.code === 'min_stay' ? 'short' : null
      const rowRates = (passing.length ? passing : candidates).map((code) => mapOf(code).get(date)?.rate_minor ?? mapOf(code).get(addDays(date, -1))?.rate_minor).filter((v): v is number => v !== undefined)
      if (day.from_minor === null && rowRates.length) day.from_minor = convertNights([Math.min(...rowRates)], ppm, currency).total
      if (day.min_stay === null && candidates.length) day.min_stay = Math.min(...candidates.map((code) => mapOf(code).get(start)!.min_stay))
    }
    days.push(day)
  }
  return { days }
}
