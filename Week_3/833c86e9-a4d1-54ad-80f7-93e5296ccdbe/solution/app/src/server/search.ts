import { addDays, daysBetween, isRealDay, localDate } from '../shared/dates'
import { EURO_MINOR, MAX_ADULTS, rnd } from '../shared/rules'
import { AMENITIES, SEARCH_KEYS, SORTS, buildQuery, type SearchParams, type Sort } from '../shared/search-link'
import { CURRENCIES, LANGS, type Currency, type Lang } from '../shared/i18n'
import type { SearchNotice, SearchResponse, SearchResult } from '../shared/types'
import { BUCKETS, BUCKET_MINOR, MAX_NIGHTS, config } from './config'
import { notFound } from './errors'
import { one, type Db } from './db'
import { propertiesIn, roomTypesOf, type PropertyRow } from './catalog'
import { recommend, type StayContext } from './allocation'
import { loadNights } from './restrictions'
import { deadlineTiers } from './deadlines'
import { currentRates, priceRooms, summarize } from './quotes'
import { scoresByProperty } from './reviews'
import { tierFor } from './loyalty'

interface Normalised { params: SearchParams; notices: SearchNotice[]; zone: string }

const whole = (value: string | undefined): number | null => (value !== undefined && /^-?\d+$/.test(value) ? Number(value) : null)

/** Applies the published link rules in order; returns the parameters, one notice per rule applied and the canonical query. */
export async function normalise(db: Db, query: URLSearchParams, stored: { lang: Lang; cur: Currency }, now: Date): Promise<Normalised & { canonical: string; destination: { code: string; name: string; zone: string; cx: number; cy: number } }> {
  const notices: SearchNotice[] = []
  const get = (key: string): string | undefined => query.get(key) ?? undefined
  const destination = await one<{ code: string; name: string; zone: string; cx: number; cy: number }>(db, `SELECT code, name, zone, cx, cy FROM destinations WHERE code = $1`, [get('dest') ?? ''])
  if (!destination) return notFound()
  for (const key of new Set(query.keys())) if (!(SEARCH_KEYS as readonly string[]).includes(key)) notices.push({ key: 'notice.ignored', name: key })
  const today = localDate(now, destination.zone)
  let arrival = get('in')
  if (!isRealDay(arrival) || arrival < today) {
    arrival = today
    notices.push({ key: 'notice.arrival', date: arrival })
  }
  let departure = get('out')
  if (!isRealDay(departure) || departure <= arrival || daysBetween(arrival, departure) > MAX_NIGHTS) {
    departure = addDays(arrival, 1)
    notices.push({ key: 'notice.departure', date: departure })
  }
  const adultsRaw = get('adults')
  let adults = adultsRaw === undefined ? 2 : whole(adultsRaw) ?? 2
  if (adultsRaw !== undefined && (adults < 1 || adults > MAX_ADULTS || whole(adultsRaw) === null)) {
    adults = Math.min(MAX_ADULTS, Math.max(1, adults))
    notices.push({ key: 'notice.adults', n: adults })
  }
  const ages: number[] = []
  for (const text of (get('ages') ?? '').split(',').filter((part) => part !== '')) {
    const age = whole(text)
    if (age === null || age < 0 || age > 17) notices.push({ key: 'notice.age', value: text })
    else ages.push(age)
  }
  const reset = (name: string, valid: boolean): void => {
    if (get(name) !== undefined && !valid) notices.push({ key: 'notice.reset', name })
  }
  const sort = get('sort') ?? 'rank'
  reset('sort', (SORTS as readonly string[]).includes(sort))
  const cur = get('cur') ?? stored.cur
  reset('cur', (CURRENCIES as readonly string[]).includes(cur))
  const lang = get('lang') ?? stored.lang
  reset('lang', (LANGS as readonly string[]).includes(lang))
  const display = get('display') ?? 'total'
  reset('display', display === 'total' || display === 'night')
  const tax = get('tax') ?? '1'
  reset('tax', tax === '0' || tax === '1')
  let min = whole(get('min'))
  let max = whole(get('max'))
  if (min !== null && max !== null && min > max) {
    ;[min, max] = [max, min]
    notices.push({ key: 'notice.swapped' })
  }
  const zoom = whole(get('zoom'))
  const cx = Number(get('cx'))
  const cy = Number(get('cy'))
  const view = zoom !== null && zoom >= 0 && zoom <= 5 && get('cx') !== undefined && get('cy') !== undefined && Number.isFinite(cx) && Number.isFinite(cy)
    ? { zoom, cx: Math.min(1000, Math.max(0, cx)), cy: Math.min(1000, Math.max(0, cy)) } : null
  const list = (text: string | undefined): string[] => (text ?? '').split(',').filter(Boolean)
  const params: SearchParams = {
    dest: destination.code, in: arrival, out: departure, adults, ages: ages.sort((a, b) => a - b),
    lang: (LANGS as readonly string[]).includes(lang) ? (lang as Lang) : stored.lang, cur: (CURRENCIES as readonly string[]).includes(cur) ? (cur as Currency) : stored.cur,
    display: display === 'night' ? 'night' : 'total', tax: tax !== '0',
    stars: list(get('stars')).map(Number).filter((star) => [3, 4, 5].includes(star)), amen: list(get('amen')).filter((a) => (AMENITIES as readonly string[]).includes(a)),
    free: get('free') === '1', min, max, sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : 'rank',
    cursor: get('cursor') || null, view, sel: get('sel') || null,
  }
  return { params, notices, zone: destination.zone, canonical: buildQuery(params), destination }
}

interface Candidate {
  property: PropertyRow; total: number; avg: number; s10: number; distance: number; rank: number; refundable: boolean
  display: number
}

const pad = (view: NonNullable<SearchParams['view']>): number => 1000 / 2 ** view.zoom / 2

function inView(c: Candidate, view: SearchParams['view']): boolean {
  if (!view) return true
  const half = pad(view)
  return Math.abs(c.property.x - view.cx) <= half && Math.abs(c.property.y - view.cy) <= half
}

const key = (sort: Sort, c: Candidate): number[] => {
  const metres = Math.round(c.distance * 1000)
  return { rank: [-c.rank, c.total], price_asc: [c.total], price_desc: [-c.total], score_desc: [-c.s10], distance_asc: [metres] }[sort]
}

function cursorValue(sort: Sort, c: Candidate): string {
  const metres = Math.round(c.distance * 1000)
  if (sort === 'rank') return `${c.rank}~${c.total}`
  return String({ price_asc: c.total, price_desc: c.total, score_desc: c.s10, distance_asc: metres }[sort])
}

function cursorKey(sort: Sort, cursor: string): { numbers: number[]; code: string } | null {
  const at = cursor.indexOf('_')
  if (at < 1) return null
  const head = cursor.slice(0, at)
  const parts = head.split('~').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  const code = cursor.slice(at + 1)
  switch (sort) {
    case 'rank': return parts.length === 2 ? { numbers: [-parts[0], parts[1]], code } : null
    case 'price_desc': case 'score_desc': return parts.length === 1 ? { numbers: [-parts[0]], code } : null
    default: return parts.length === 1 ? { numbers: parts, code } : null
  }
}

function compare(a: { numbers: number[]; code: string }, b: { numbers: number[]; code: string }): number {
  for (let i = 0; i < a.numbers.length; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i]
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
}

export async function runSearch(db: Db, norm: Normalised & { canonical: string; destination: { cx: number; cy: number } }, now: Date, userId: number | null): Promise<SearchResponse> {
  const { params } = norm
  const properties = await propertiesIn(db, params.dest)
  const roomTypes = await roomTypesOf(db, properties.map((property) => property.code))
  const tier = await tierFor(db, userId, now)
  const scores = await scoresByProperty(db, properties.map((property) => property.code), now)
  const rates = await currentRates(db)
  const nightsCount = daysBetween(params.in, params.out)
  const candidates: Candidate[] = []
  for (const property of properties) {
    const rooms = roomTypes.get(property.code)!
    const nights = await loadNights(db, rooms.map((room) => room.code), params.in, params.out, now)
    const today = localDate(now, property.zone)
    const ctx: StayContext = { terms: property, roomTypes: rooms, nights, arrival: params.in, departure: params.out, today, leadDays: daysBetween(today, params.in), tierPct: tier.pct }
    const found = recommend(ctx, { adults: params.adults, ages: params.ages })
    if (!found) continue
    const priced = priceRooms(ctx, found.rooms.map((room) => ({ ...room, plan: 'refundable' as const, breakfast: false })))
    const summary = summarize(priced, params.in, params.out, params.cur, rates)
    const converted = params.tax ? summary.converted_total_minor : summary.converted_taxable_minor
    const s10 = scores.get(property.code) as number
    const distance = Math.hypot(property.x - norm.destination.cx, property.y - norm.destination.cy)
    const avg = rnd(found.total, nightsCount)
    const refundable = deadlineTiers(property.policy, params.in, property.zone).some((tier) => tier.refund_pct === 100 && now.getTime() < tier.at.getTime())
    candidates.push({
      property, total: found.total, avg, s10, distance, refundable,
      rank: 3 * s10 - 2 * Math.floor(distance) - Math.floor(avg / 1000),
      display: params.display === 'total' ? converted : rnd(converted, nightsCount),
    })
  }
  const matchStars = (c: Candidate): boolean => !params.stars.length || params.stars.includes(c.property.stars)
  const matchAmen = (c: Candidate): boolean => !params.amen.length || params.amen.some((a) => c.property.amenities.includes(a))
  const matchFree = (c: Candidate): boolean => !params.free || c.refundable
  const matchPrice = (c: Candidate): boolean => (params.min === null || params.min * EURO_MINOR <= c.avg) && (params.max === null || c.avg <= params.max * EURO_MINOR)
  const matchView = (c: Candidate): boolean => inView(c, params.view)
  const results = candidates.filter((c) => matchStars(c) && matchAmen(c) && matchFree(c) && matchPrice(c) && matchView(c))
  const count = (predicate: (c: Candidate) => boolean): number => candidates.filter(predicate).length
  const counts = {
    stars: Object.fromEntries([3, 4, 5].map((star) => [String(star), count((c) => matchAmen(c) && matchFree(c) && matchPrice(c) && matchView(c) && c.property.stars === star)])),
    amen: Object.fromEntries(AMENITIES.map((a) => [a, count((c) => matchStars(c) && matchFree(c) && matchPrice(c) && matchView(c) && c.property.amenities.includes(a))])),
    free: count((c) => matchStars(c) && matchAmen(c) && matchPrice(c) && matchView(c) && c.refundable),
  }
  const histogram = Array.from({ length: BUCKETS }, (_, i) => ({
    from_minor: BUCKET_MINOR * i,
    to_minor: i === BUCKETS - 1 ? null : BUCKET_MINOR * (i + 1),
    count: count((c) => matchStars(c) && matchAmen(c) && matchFree(c) && matchView(c) && Math.min(Math.floor(c.avg / BUCKET_MINOR), BUCKETS - 1) === i),
  }))
  const asResult = (c: Candidate): SearchResult => ({
    code: c.property.code, name: c.property.name, stars: c.property.stars, score: c.s10 / 10, distance_km: Math.round(c.distance * 10) / 10,
    x: c.property.x, y: c.property.y, total_minor: c.total, avg_night_minor: c.avg, display_minor: c.display, display_currency: params.cur, refundable: c.refundable, rank: c.rank,
  })
  const ordered = [...results].sort((a, b) => compare({ numbers: key(params.sort, a), code: a.property.code }, { numbers: key(params.sort, b), code: b.property.code }))
  const after = params.cursor ? cursorKey(params.sort, params.cursor) : null
  const remaining = after ? ordered.filter((c) => compare({ numbers: key(params.sort, c), code: c.property.code }, after) > 0) : ordered
  const page = remaining.slice(0, config.pageSize)
  const last = page[page.length - 1]
  return {
    canonical: norm.canonical, notices: norm.notices, count: results.length, results: page.map(asResult), counts, histogram,
    pins: ordered.map((c) => ({ code: c.property.code, name: c.property.name, x: c.property.x, y: c.property.y, score: c.s10 / 10, display_minor: c.display })),
    next_cursor: remaining.length > page.length && last ? `${cursorValue(params.sort, last)}_${last.property.code}` : null,
  }
}

