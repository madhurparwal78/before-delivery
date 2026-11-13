import { span } from '../shared/dates'
import { MAX_ROOMS, ageBands } from '../shared/rules'
import type { Advice, Reason, RoomChoiceRoom } from '../shared/types'
import { occupancyOf, priceNight, type Occupancy, type PropertyTerms, type RoomTerms } from './pricing'
import { stayReason, type NightMap } from './restrictions'

export interface RoomTypeData extends RoomTerms {
  code: string; name: string; max_adults: number; max_guests: number; rooms: number; base_rate_minor: number
}

export interface StayContext {
  terms: PropertyTerms
  roomTypes: RoomTypeData[]
  nights: Map<string, NightMap>
  arrival: string
  departure: string
  today: string
  leadDays: number
  tierPct: number
}


/** Rooms left on the night with the fewest. */
export function roomsLeft(map: NightMap, arrival: string, departure: string): number {
  return Math.min(...span(arrival, departure).map((date) => map.get(date)?.left ?? 0))
}

/** Price of one room for the whole stay with the refundable plan and no breakfast (used for ranking placements). */
function roomStayTotal(ctx: StayContext, room: RoomTypeData, occupancy: Occupancy): number {
  const map = ctx.nights.get(room.code) as NightMap
  const dates = span(ctx.arrival, ctx.departure)
  let total = 0
  for (const date of dates) {
    const row = map.get(date)
    if (!row) continue
    total += priceNight(ctx.terms, room, 'refundable', false, occupancy, {
      date, rate_minor: row.rate_minor, nights: dates.length, leadDays: ctx.leadDays, tierPct: ctx.tierPct,
    }).total_minor
  }
  return total
}

interface Party { adults: number; ages: number[] }

interface Choice { adults: number; kids: [number, number, number] }

function choicesFor(room: RoomTypeData, left: Occupancy): Choice[] {
  const result: Choice[] = []
  for (let adults = 1; adults <= Math.min(room.max_adults, left.adults); adults++) {
    for (let a = 0; a <= left.n12 && adults + a <= room.max_guests; a++) {
      for (let b = 0; b <= left.n3 && adults + a + b <= room.max_guests; b++) {
        for (let c = 0; c <= left.n0 && adults + a + b + c <= room.max_guests; c++) result.push({ adults, kids: [a, b, c] })
      }
    }
  }
  return result
}

/**
 * Cheapest placement of the party into `rooms` (ordered by code); ties go to the most adults in the first room, then the second,
 * then each later room, then the same for children aged 12 to 17, 3 to 11 and 0 to 2.
 */
function bestPlacement(ctx: StayContext, rooms: RoomTypeData[], party: Party): { total: number; rooms: RoomChoiceRoom[] } | null {
  const bands = ageBands(party.ages)
  const start = occupancyOf(party.adults, party.ages)
  const k = rooms.length
  const priceMemo = new Map<string, number>()
  const priced = (index: number, choice: Choice): number => {
    const key = `${rooms[index].code}|${choice.adults}|${choice.kids.join(',')}`
    let value = priceMemo.get(key)
    if (value === undefined) {
      value = roomStayTotal(ctx, rooms[index], { adults: choice.adults, n12: choice.kids[0], n3: choice.kids[1], n0: choice.kids[2] })
      priceMemo.set(key, value)
    }
    return value
  }
  const fixed: (number | null)[] = new Array(4 * k).fill(null)
  const minTotal = (): number => {
    const memo = new Map<string, number>()
    const walk = (index: number, left: Occupancy): number => {
      if (index === k) return left.adults + left.n12 + left.n3 + left.n0 === 0 ? 0 : Infinity
      const key = `${index}|${left.adults}|${left.n12}|${left.n3}|${left.n0}`
      const cached = memo.get(key)
      if (cached !== undefined) return cached
      let best = Infinity
      for (const choice of choicesFor(rooms[index], left)) {
        if (fixed[index] !== null && fixed[index] !== choice.adults) continue
        if (fixed[k + index] !== null && fixed[k + index] !== choice.kids[0]) continue
        if (fixed[2 * k + index] !== null && fixed[2 * k + index] !== choice.kids[1]) continue
        if (fixed[3 * k + index] !== null && fixed[3 * k + index] !== choice.kids[2]) continue
        const rest = walk(index + 1, { adults: left.adults - choice.adults, n12: left.n12 - choice.kids[0], n3: left.n3 - choice.kids[1], n0: left.n0 - choice.kids[2] })
        if (rest !== Infinity) best = Math.min(best, rest + priced(index, choice))
      }
      memo.set(key, best)
      return best
    }
    return walk(0, start)
  }
  const optimum = minTotal()
  if (optimum === Infinity) return null
  const limits = [party.adults, bands[0].length, bands[1].length, bands[2].length]
  for (let slot = 0; slot < 4 * k; slot++) {
    for (let value = limits[Math.floor(slot / k)]; value >= 0; value--) {
      fixed[slot] = value
      if (minTotal() === optimum) break
      fixed[slot] = null
    }
  }
  const cursors = [0, 0, 0]
  const placed: RoomChoiceRoom[] = rooms.map((room, index) => {
    const ages: number[] = []
    for (let band = 0; band < 3; band++) {
      const count = fixed[(band + 1) * k + index] as number
      ages.push(...bands[band].slice(cursors[band], cursors[band] + count))
      cursors[band] += count
    }
    return { room_type: room.code, adults: fixed[index] as number, ages }
  })
  return { total: optimum, rooms: placed }
}

function multisets(codes: string[], size: number, from = 0): string[][] {
  if (size === 0) return [[]]
  const result: string[][] = []
  for (let i = from; i < codes.length; i++) for (const rest of multisets(codes, size - 1, i)) result.push([codes[i], ...rest])
  return result
}

const roomsOf = (ctx: StayContext, codes: string[]): RoomTypeData[] => codes.map((code) => ctx.roomTypes.find((room) => room.code === code) as RoomTypeData)

/** Rooms left on every night and the stay restrictions for `count` rooms of one type. */
export function typeFits(ctx: StayContext, code: string, count: number): Reason | null {
  return stayReason(ctx.nights.get(code) as NightMap, ctx.arrival, ctx.departure, ctx.today, count)
}

export function recommend(ctx: StayContext, party: Party): { total: number; rooms: RoomChoiceRoom[] } | null {
  const codes = ctx.roomTypes.map((room) => room.code).sort()
  const partySize = party.adults + party.ages.length
  let best: { total: number; combo: string[]; rooms: RoomChoiceRoom[] } | null = null
  for (let size = 1; size <= Math.min(MAX_ROOMS, party.adults); size++) {
    for (const combo of multisets(codes, size)) {
      const counts = new Map<string, number>()
      for (const code of combo) counts.set(code, (counts.get(code) ?? 0) + 1)
      if ([...counts].some(([code, count]) => typeFits(ctx, code, count) !== null)) continue
      const rooms = roomsOf(ctx, combo)
      if (rooms.reduce((sum, room) => sum + room.max_guests, 0) < partySize) continue
      const found = bestPlacement(ctx, rooms, party)
      if (!found) continue
      const better = !best || found.total < best.total || (found.total === best.total && (size < best.combo.length || (size === best.combo.length && combo.join() < best.combo.join())))
      if (better) best = { total: found.total, combo, rooms: found.rooms }
    }
  }
  return best ? { total: best.total, rooms: best.rooms } : null
}

/** Places the party into the chosen room counts, or explains why that cannot be done. */
export function place(ctx: StayContext, party: Party, counts: Record<string, number>): { total: number; rooms: RoomChoiceRoom[] } | Advice {
  const codes = Object.keys(counts).sort().flatMap((code) => new Array<string>(Math.max(0, counts[code])).fill(code))
  const rooms = roomsOf(ctx, codes)
  const capacity = rooms.reduce((sum, room) => sum + room.max_guests, 0)
  const partySize = party.adults + party.ages.length
  if (capacity < partySize) return { code: 'capacity', n: capacity, m: partySize }
  if (rooms.length > party.adults) return { code: 'adult' }
  for (const room of ctx.roomTypes) {
    const wanted = counts[room.code] ?? 0
    const left = roomsLeft(ctx.nights.get(room.code) as NightMap, ctx.arrival, ctx.departure)
    if (wanted > left) return { code: 'left', n: left, room_type: room.code }
  }
  const found = rooms.length ? bestPlacement(ctx, rooms, party) : null
  if (!found) return { code: 'capacity', n: capacity, m: partySize }
  return found
}
