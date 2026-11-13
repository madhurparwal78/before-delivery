import { convertTotal, roundDiv } from '../shared/money';
import { CurrencyTable, SearchResponse, SearchResult, SortKey } from '../shared/types';
import { inView } from '../shared/map';
import { config } from './config';
import { recommend } from './allocation';
import { loadDestination, loadInventory, propertiesOfDestination } from './inventory';
import { propertyScore } from './loyalty';
import { freeCancellationAhead } from './policy';
import { makeStayContext, priceStay } from './pricing';
import { SearchParams } from './searchlink';
import { addDays, diffDays, localDate } from './zone';

export interface SearchContext {
  nowMs: number;
  tierPct: number;
  rates: CurrencyTable;
}

interface Candidate extends SearchResult {
  amenities: string[];
  taxable_minor: number;
}

export interface SearchOutcome {
  count: number;
  results: SearchResult[];
  counts: SearchResponse['counts'];
  histogram: SearchResponse['histogram'];
  pins: SearchResponse['pins'];
  next_cursor: string | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function candidatesFor(params: SearchParams, sctx: SearchContext): Promise<Candidate[]> {
  const dest = await loadDestination(params.dest);
  if (!dest) return [];
  const codes = await propertiesOfDestination(dest.code);
  const inv = await loadInventory(codes, params.in, addDays(params.out, 1));
  const todayLocal = localDate(dest.zone, sctx.nowMs);
  const nights = diffDays(params.in, params.out);
  const out: Candidate[] = [];
  for (const code of codes) {
    const property = inv.properties.get(code);
    const types = inv.roomTypes.get(code) ?? [];
    if (!property || types.length === 0) continue;
    const ctx = makeStayContext(property, params.in, params.out, todayLocal, sctx.tierPct);
    const req = { inDate: params.in, outDate: params.out, todayLocal };
    const recommendation = recommend({ ctx, inv, types, party: { adults: params.adults, ages: params.ages }, req });
    if (!recommendation) continue;
    const priced = priceStay(
      ctx,
      inv,
      recommendation.rooms.map((room) => ({
        room_type: room.room_type,
        plan: 'refundable' as const,
        breakfast: false,
        adults: room.adults,
        ages: room.ages,
      })),
    );
    const score = await propertyScore(code, sctx.nowMs);
    const distance = round1(Math.hypot(property.x - dest.cx, property.y - dest.cy));
    const avg = roundDiv(priced.total_minor, nights);
    const base = params.tax === 1 ? priced.total_minor : priced.taxable_minor;
    const converted = convertTotal(base, params.cur, sctx.rates);
    const display = params.display === 'night' ? roundDiv(converted, nights) : converted;
    out.push({
      code,
      name: property.name,
      stars: property.stars,
      score,
      distance_km: distance,
      x: property.x,
      y: property.y,
      total_minor: priced.total_minor,
      taxable_minor: priced.taxable_minor,
      avg_night_minor: avg,
      display_minor: display,
      display_currency: params.cur,
      refundable: freeCancellationAhead(property, params.in, sctx.nowMs),
      rank: 3 * Math.round(score * 10) - 2 * Math.floor(distance) - Math.floor(avg / 1000),
      amenities: property.amenities,
    });
  }
  return out;
}

function comparator(sort: SortKey): (a: SearchResult, b: SearchResult) => number {
  switch (sort) {
    case 'price_asc':
      return (a, b) => a.total_minor - b.total_minor || compareCode(a, b);
    case 'price_desc':
      return (a, b) => b.total_minor - a.total_minor || compareCode(a, b);
    case 'score_desc':
      return (a, b) => Math.round(b.score * 10) - Math.round(a.score * 10) || compareCode(a, b);
    case 'distance_asc':
      return (a, b) => metres(a) - metres(b) || compareCode(a, b);
    default:
      return (a, b) => b.rank - a.rank || a.total_minor - b.total_minor || compareCode(a, b);
  }
}

function compareCode(a: SearchResult, b: SearchResult): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function metres(result: SearchResult): number {
  return Math.floor(result.distance_km * 1000 + 0.5);
}

export function cursorOf(result: SearchResult, sort: SortKey): string {
  switch (sort) {
    case 'price_asc':
    case 'price_desc':
      return `${result.total_minor}_${result.code}`;
    case 'score_desc':
      return `${Math.round(result.score * 10)}_${result.code}`;
    case 'distance_asc':
      return `${metres(result)}_${result.code}`;
    default:
      return `${result.rank}~${result.total_minor}_${result.code}`;
  }
}

/** Builds the sort position a cursor names, so paging never needs the row. */
function positionOfCursor(cursor: string, sort: SortKey): SearchResult | null {
  const split = cursor.indexOf('_');
  if (split < 0) return null;
  const value = cursor.slice(0, split);
  const code = cursor.slice(split + 1);
  const base: SearchResult = {
    code,
    name: '',
    stars: 0,
    score: 0,
    distance_km: 0,
    x: 0,
    y: 0,
    total_minor: 0,
    avg_night_minor: 0,
    display_minor: 0,
    display_currency: 'EUR',
    refundable: false,
    rank: 0,
  };
  if (sort === 'rank') {
    const [rank, total] = value.split('~');
    base.rank = Number(rank);
    base.total_minor = Number(total);
    if (!Number.isFinite(base.rank) || !Number.isFinite(base.total_minor)) return null;
    return base;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (sort === 'price_asc' || sort === 'price_desc') base.total_minor = numeric;
  else if (sort === 'score_desc') base.score = numeric / 10;
  else base.distance_km = numeric / 1000;
  return base;
}

export async function runSearch(params: SearchParams, sctx: SearchContext): Promise<SearchOutcome> {
  const all = await candidatesFor(params, sctx);
  const matchStars = (c: Candidate): boolean => params.stars.length === 0 || params.stars.includes(c.stars);
  const matchAmen = (c: Candidate): boolean =>
    params.amen.length === 0 || params.amen.some((a) => c.amenities.includes(a));
  const matchFree = (c: Candidate): boolean => !params.free || c.refundable;
  const matchPrice = (c: Candidate): boolean =>
    (params.min === null || params.min * 100 <= c.avg_night_minor) &&
    (params.max === null || c.avg_night_minor <= params.max * 100);
  const matchView = (c: Candidate): boolean =>
    params.zoom === null || params.cx === null || params.cy === null
      ? true
      : inView(c, params.zoom, params.cx, params.cy);

  const matching = all.filter((c) => matchStars(c) && matchAmen(c) && matchFree(c) && matchPrice(c) && matchView(c));

  const counts: SearchResponse['counts'] = {
    stars: { '3': 0, '4': 0, '5': 0 },
    amen: { pool: 0, parking: 0, wifi: 0, spa: 0, pets: 0 },
    free: 0,
  };
  for (const stars of [3, 4, 5]) {
    counts.stars[String(stars)] = all.filter(
      (c) => c.stars === stars && matchAmen(c) && matchFree(c) && matchPrice(c) && matchView(c),
    ).length;
  }
  for (const amenity of ['pool', 'parking', 'wifi', 'spa', 'pets']) {
    counts.amen[amenity] = all.filter(
      (c) => c.amenities.includes(amenity) && matchStars(c) && matchFree(c) && matchPrice(c) && matchView(c),
    ).length;
  }
  counts.free = all.filter((c) => c.refundable && matchStars(c) && matchAmen(c) && matchPrice(c) && matchView(c)).length;

  const histogramBase = all.filter((c) => matchStars(c) && matchAmen(c) && matchFree(c) && matchView(c));
  const histogram = Array.from({ length: 12 }, (_, i) => ({ from_minor: 5000 * i, count: 0 }));
  for (const c of histogramBase) {
    const bucket = Math.min(11, Math.floor(c.avg_night_minor / 5000));
    histogram[bucket].count += 1;
  }

  const compare = comparator(params.sort);
  const sorted = [...matching].sort(compare);
  let page = sorted;
  if (params.cursor) {
    const position = positionOfCursor(params.cursor, params.sort);
    if (position) page = sorted.filter((c) => compare(c, position) > 0);
  }
  const results = page.slice(0, config.pageSize);
  const next = page.length > config.pageSize ? cursorOf(results[results.length - 1], params.sort) : null;

  const pins = sorted.map((c) => ({
    code: c.code,
    name: c.name,
    x: c.x,
    y: c.y,
    score: c.score,
    display_minor: c.display_minor,
  }));

  return {
    count: matching.length,
    results: results.map(({ amenities, taxable_minor, ...rest }) => rest),
    counts,
    histogram,
    pins,
    next_cursor: next,
  };
}
