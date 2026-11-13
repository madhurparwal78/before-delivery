import { AMENITIES, Amenity, CURS, Cur, DisplayMode, LANGS, Lang, SORTS, SearchNotice, SortKey } from '../shared/types';
import { MAX_NIGHTS } from './config';
import { addDays, diffDays, isDate } from './zone';
import { clampCentre } from '../shared/map';

export interface SearchParams {
  dest: string;
  in: string;
  out: string;
  adults: number;
  ages: number[];
  lang: Lang;
  cur: Cur;
  display: DisplayMode;
  tax: 0 | 1;
  stars: number[];
  amen: Amenity[];
  free: boolean;
  min: number | null;
  max: number | null;
  sort: SortKey;
  cursor: string | null;
  zoom: number | null;
  cx: number | null;
  cy: number | null;
  sel: string | null;
}

const KNOWN = [
  'dest',
  'in',
  'out',
  'adults',
  'ages',
  'lang',
  'cur',
  'display',
  'tax',
  'stars',
  'amen',
  'free',
  'min',
  'max',
  'sort',
  'cursor',
  'zoom',
  'cx',
  'cy',
  'sel',
];

function wholeNumber(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

export interface NormaliseInput {
  query: URLSearchParams;
  todayLocal: string;
  stored: { lang: Lang | null; cur: Cur | null };
  defaultCentre: { cx: number; cy: number };
}

export interface NormaliseResult {
  params: SearchParams;
  notices: SearchNotice[];
  canonical: string;
}

/** The published link normalisation, in order, with one notice per rule applied. */
export function normaliseSearch(input: NormaliseInput): NormaliseResult {
  const q = input.query;
  const notices: SearchNotice[] = [];

  for (const name of [...new Set([...q.keys()])]) {
    if (!KNOWN.includes(name)) notices.push({ key: 'notice.ignored', name });
  }

  const dest = q.get('dest') ?? '';

  let inDate = q.get('in') ?? '';
  if (!isDate(inDate) || inDate < input.todayLocal) {
    inDate = input.todayLocal;
    notices.push({ key: 'notice.arrival', date: inDate });
  }

  let outDate = q.get('out') ?? '';
  if (!isDate(outDate) || outDate <= inDate || diffDays(inDate, outDate) > MAX_NIGHTS) {
    outDate = addDays(inDate, 1);
    notices.push({ key: 'notice.departure', date: outDate });
  }

  let adults = 2;
  const adultsRaw = q.get('adults');
  if (adultsRaw !== null) {
    const value = wholeNumber(adultsRaw);
    if (value === null) {
      adults = 2;
      notices.push({ key: 'notice.adults', n: adults });
    } else if (value < 1 || value > 16) {
      adults = Math.min(16, Math.max(1, value));
      notices.push({ key: 'notice.adults', n: adults });
    } else {
      adults = value;
    }
  }

  const ages: number[] = [];
  const agesRaw = q.get('ages');
  if (agesRaw !== null && agesRaw !== '') {
    for (const part of agesRaw.split(',')) {
      const value = wholeNumber(part.trim());
      if (value === null || value < 0 || value > 17) {
        notices.push({ key: 'notice.age', value: part.trim() });
        continue;
      }
      ages.push(value);
    }
  }

  const resets: SearchNotice[] = [];
  let sort: SortKey = 'rank';
  const sortRaw = q.get('sort');
  if (sortRaw !== null) {
    if (SORTS.includes(sortRaw as SortKey)) sort = sortRaw as SortKey;
    else resets.push({ key: 'notice.reset', name: 'sort' });
  }

  let cur: Cur;
  const curRaw = q.get('cur');
  if (curRaw !== null && CURS.includes(curRaw as Cur)) cur = curRaw as Cur;
  else {
    cur = input.stored.cur ?? 'EUR';
    if (curRaw !== null) resets.push({ key: 'notice.reset', name: 'cur' });
  }

  let lang: Lang;
  const langRaw = q.get('lang');
  if (langRaw !== null && LANGS.includes(langRaw as Lang)) lang = langRaw as Lang;
  else {
    lang = input.stored.lang ?? 'en';
    if (langRaw !== null) resets.push({ key: 'notice.reset', name: 'lang' });
  }

  let display: DisplayMode = 'total';
  const displayRaw = q.get('display');
  if (displayRaw !== null) {
    if (displayRaw === 'total' || displayRaw === 'night') display = displayRaw;
    else resets.push({ key: 'notice.reset', name: 'display' });
  }
  notices.push(...resets);

  const tax: 0 | 1 = q.get('tax') === '0' ? 0 : 1;

  const stars = (q.get('stars') ?? '')
    .split(',')
    .map((part) => wholeNumber(part.trim()))
    .filter((value): value is number => value !== null && value >= 3 && value <= 5)
    .sort((a, b) => a - b);

  const amen = (q.get('amen') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is Amenity => (AMENITIES as readonly string[]).includes(part))
    .sort();

  const free = q.get('free') === '1';

  let min = numberOrNull(q.get('min'));
  let max = numberOrNull(q.get('max'));
  if (min !== null && max !== null && min > max) {
    [min, max] = [max, min];
    notices.push({ key: 'notice.swapped' });
  }

  const cursor = q.get('cursor');

  let zoom: number | null = null;
  let cx: number | null = null;
  let cy: number | null = null;
  const zoomRaw = wholeNumber(q.get('zoom') ?? '');
  const cxRaw = numberOrNull(q.get('cx'));
  const cyRaw = numberOrNull(q.get('cy'));
  if (zoomRaw !== null && cxRaw !== null && cyRaw !== null) {
    zoom = Math.min(5, Math.max(0, zoomRaw));
    cx = clampCentre(cxRaw);
    cy = clampCentre(cyRaw);
  }

  const sel = q.get('sel');

  const params: SearchParams = {
    dest,
    in: inDate,
    out: outDate,
    adults,
    ages: [...ages],
    lang,
    cur,
    display,
    tax,
    stars,
    amen: amen as Amenity[],
    free,
    min,
    max,
    sort,
    cursor: cursor === '' ? null : cursor,
    zoom,
    cx,
    cy,
    sel: sel === '' ? null : sel,
  };
  return { params, notices, canonical: canonicalQuery(params) };
}

function numberOrNull(raw: string | null): number | null {
  if (raw === null || raw === '' || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}

/** Every setting in the published order; defaults are left out. */
export function canonicalQuery(p: SearchParams): string {
  const parts: string[] = [];
  const add = (name: string, value: string): void => {
    parts.push(`${name}=${encodeURIComponent(value)}`);
  };
  add('dest', p.dest);
  add('in', p.in);
  add('out', p.out);
  if (p.adults !== 2) add('adults', String(p.adults));
  if (p.ages.length > 0) add('ages', p.ages.join(','));
  add('lang', p.lang);
  add('cur', p.cur);
  if (p.display !== 'total') add('display', p.display);
  if (p.tax !== 1) add('tax', String(p.tax));
  if (p.stars.length > 0) add('stars', p.stars.join(','));
  if (p.amen.length > 0) add('amen', p.amen.join(','));
  if (p.free) add('free', '1');
  if (p.min !== null) add('min', String(p.min));
  if (p.max !== null) add('max', String(p.max));
  if (p.sort !== 'rank') add('sort', p.sort);
  if (p.cursor) add('cursor', p.cursor);
  if (p.zoom !== null && p.cx !== null && p.cy !== null) {
    add('zoom', String(p.zoom));
    add('cx', String(p.cx));
    add('cy', String(p.cy));
  }
  if (p.sel) add('sel', p.sel);
  return parts.join('&');
}
