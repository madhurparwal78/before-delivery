import type { Line } from '../shared/types'
import { ageBands, rnd } from '../shared/rules'

type LineKey = 'plan_rate' | 'occupancy' | 'children' | 'length_of_stay' | 'early_booking' | 'last_minute' | 'loyalty' | 'breakfast' | 'vat' | 'city_tax' | 'tourism_levy' | 'night_total'
const LINE_KEYS: readonly LineKey[] = ['plan_rate', 'occupancy', 'children', 'length_of_stay', 'early_booking', 'last_minute', 'loyalty', 'breakfast', 'vat', 'city_tax', 'tourism_levy', 'night_total']
export type Plan = 'refundable' | 'nonrefundable'

interface PricedNight { date: string; lines: Line[]; total_minor: number; taxable_minor: number }

export interface PropertyTerms { vat_pct: number; city_minor: number; levy_pct: number; breakfast_minor: number; single_pct: number }
export interface RoomTerms { included_adults: number; extra_adult_minor: number; child_minor: number }
export interface Occupancy { adults: number; n12: number; n3: number; n0: number }

/** x minus round(x * p / 100). */
const off = (x: number, pct: number): number => x - rnd(x * pct, 100)

export function occupancyOf(adults: number, ages: readonly number[]): Occupancy {
  const [teens, children, infants] = ageBands(ages)
  return { adults, n12: teens.length, n3: children.length, n0: infants.length }
}

interface NightInput {
  date: string
  rate_minor: number
  nights: number
  leadDays: number
  tierPct: number
}

export function priceNight(property: PropertyTerms, room: RoomTerms, plan: Plan, breakfast: boolean, occupancy: Occupancy, input: NightInput): PricedNight {
  const steps: Partial<Record<LineKey, number>> = {}
  let x = plan === 'refundable' ? input.rate_minor : off(input.rate_minor, 10)
  steps.plan_rate = x
  const extraAdults = Math.max(0, occupancy.adults - room.included_adults)
  const occupied = occupancy.adults === 1 && room.included_adults >= 2 ? off(x, property.single_pct) : x + room.extra_adult_minor * extraAdults
  steps.occupancy = occupied - x
  x = occupied
  const withChildren = x + occupancy.n3 * room.child_minor + occupancy.n12 * room.extra_adult_minor
  steps.children = withChildren - x
  x = withChildren
  let stay = x
  if (input.nights >= 14) stay = off(x, 12)
  else if (input.nights >= 7) stay = off(x, 8)
  steps.length_of_stay = stay - x
  const stayDiscounted = input.nights >= 7
  x = stay
  steps.early_booking = 0
  steps.last_minute = 0
  if (plan === 'refundable') {
    if (input.leadDays >= 60) {
      const early = off(x, 10)
      steps.early_booking = early - x
      x = early
    } else if (input.leadDays <= 3 && !stayDiscounted) {
      const late = off(x, 15)
      steps.last_minute = late - x
      x = late
    }
  }
  const loyal = off(x, input.tierPct)
  steps.loyalty = loyal - x
  x = loyal
  const eaters = occupancy.adults + occupancy.n12 + occupancy.n3
  steps.breakfast = breakfast ? property.breakfast_minor * eaters : 0
  const taxable = x + steps.breakfast
  steps.vat = rnd(taxable * property.vat_pct, 100)
  steps.city_tax = property.city_minor * (occupancy.adults + occupancy.n12)
  steps.tourism_levy = rnd(steps.city_tax * property.levy_pct, 100)
  const total = taxable + steps.vat + steps.city_tax + steps.tourism_levy
  const lines: Line[] = []
  for (const key of LINE_KEYS) {
    if (key === 'night_total') lines.push({ key, minor: total })
    else if (steps[key]) lines.push({ key, minor: steps[key] as number })
  }
  return { date: input.date, lines, total_minor: total, taxable_minor: taxable }
}

export const sumLines = (nights: readonly { lines: Line[] }[]): Line[] => {
  const sums = new Map<string, number>()
  for (const night of nights) for (const line of night.lines) sums.set(line.key, (sums.get(line.key) ?? 0) + line.minor)
  return LINE_KEYS.filter((key) => sums.has(key)).map((key) => ({ key, minor: sums.get(key) as number }))
}

export { convertNights, type RatesPpm } from '../shared/convert'
