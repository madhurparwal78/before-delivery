import { FACET_VALUE_LIMIT, SEARCH_TEXT_LIMIT, MAX_PAGE_SIZE, PRICE_MIN, PRICE_MAX } from './shared.js';
import { FIELD_MSG, apiError } from './errors.js';
import { queryValues, type QueryBag } from './query.js';
import { BAND_IDS, BEDROOM_VALUES, FACING_VALUES, VIEW_VALUES, STATUS_VALUES, type FacetField } from './shared.js';

export interface SearchFilters {
  q: string;
  bedrooms: string[];
  band: string[];
  facing: string[];
  view: string[];
  status: string[];
  priceMin?: number;
  priceMax?: number;
}

export const FACET_VALUES: Record<FacetField, readonly string[]> = {
  bedrooms: BEDROOM_VALUES,
  band: BAND_IDS,
  facing: FACING_VALUES,
  view: VIEW_VALUES,
  status: STATUS_VALUES,
};

export const FACET_QUERY_NAMES: Record<FacetField, string> = {
  bedrooms: 'bedrooms',
  band: 'band',
  facing: 'facing',
  view: 'view',
  status: 'status',
};

export interface SearchInput {
  filters: SearchFilters;
  limit: number;
  after: { price: number; code: string } | null;
}

export type SearchResult =
  | { ok: true; input: SearchInput }
  | { ok: false; error: ReturnType<typeof apiError> };

// Search input bounds (Business rules). Every check runs before Meilisearch is
// consulted, so an invalid request answers 422 even while search is down.
export function parseSearchInput(bag: QueryBag, rawBody: string | null): SearchResult {
  const fields: Record<string, string> = {};

  const qRaw = rawValues(bag, 'q')[0] ?? '';
  let q = qRaw;
  if (q.length > SEARCH_TEXT_LIMIT) {
    fields.q = FIELD_MSG.q;
  }

  const bedrooms = rawValues(bag, 'bedrooms');
  const band = rawValues(bag, 'band');
  const facing = rawValues(bag, 'facing');
  const view = rawValues(bag, 'view');
  const status = rawValues(bag, 'status');

  const checkFacet = (field: FacetField, values: string[]): string[] => {
    const list: string[] = [];
    if (values.length > FACET_VALUE_LIMIT) {
      fields[field] = FIELD_MSG.facet;
      return list;
    }
    const allowed = FACET_VALUES[field];
    for (const v of values) {
      if (!allowed.includes(v)) {
        if (!fields[field]) fields[field] = FIELD_MSG.facetValue;
        continue;
      }
      list.push(v);
    }
    return list;
  };

  const bedroomList = checkFacet('bedrooms', bedrooms);
  const bandList = checkFacet('band', band);
  const facingList = checkFacet('facing', facing);
  const viewList = checkFacet('view', view);
  const statusList = checkFacet('status', status);

  const priceMin = parseWholePrice(rawValues(bag, 'priceMin')[0]);
  const priceMax = parseWholePrice(rawValues(bag, 'priceMax')[0]);
  if (rawValues(bag, 'priceMin')[0] !== undefined && priceMin === undefined) fields.priceMin = FIELD_MSG.price;
  if (rawValues(bag, 'priceMax')[0] !== undefined && priceMax === undefined) fields.priceMax = FIELD_MSG.price;
  if (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax) {
    fields.priceMin = FIELD_MSG.priceOrder;
  }

  const limitRaw = rawValues(bag, 'limit')[0];
  let limit = MAX_PAGE_SIZE;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) fields.limit = FIELD_MSG.limit;
    else limit = n;
  }

  const afterRaw = rawValues(bag, 'after')[0];
  let after: { price: number; code: string } | null = null;
  if (afterRaw !== undefined) {
    const parsed = decodeCursor(afterRaw);
    if (parsed === null) fields.after = FIELD_MSG.after;
    else after = parsed;
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: apiError(422, 'invalid', 'Check the highlighted fields.', fields) };
  }

  void rawBody;
  return {
    ok: true,
    input: {
      filters: {
        q: q.trim(),
        bedrooms: bedroomList,
        band: bandList,
        facing: facingList,
        view: viewList,
        status: statusList,
        priceMin,
        priceMax,
      },
      limit,
      after,
    },
  };
}

function rawValues(bag: QueryBag, key: string): string[] {
  return queryValues(bag, key);
}

function parseWholePrice(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^-?\d+$/.test(raw)) return undefined;
  if (raw.length > 1 && raw[0] === '0') return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0 || n > 100000000) return undefined;
  return n;
}

export function encodeCursor(price: number, code: string): string {
  return Buffer.from(`${price}|${code}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { price: number; code: string } | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const m = /^(\d+)\|([0-9]{1,2}[A-H])$/.exec(text);
  if (!m) return null;
  const price = Number(m[1]);
  if (!Number.isSafeInteger(price) || price < PRICE_MIN - 1 || price > PRICE_MAX) return null;
  return { price, code: m[2] };
}

export function searchQueryFor(filters: SearchFilters): string {
  const parts: string[] = [];
  const push = (field: string, values: string[]): void => {
    if (values.length === 0) return;
    parts.push(values.map((v) => `${field} = ${JSON.stringify(v)}`).join(' OR '));
  };
  push('bedrooms', filters.bedrooms);
  push('band', filters.band);
  push('facing', filters.facing);
  push('viewTag', filters.view);
  push('status', filters.status);
  if (filters.priceMin !== undefined) parts.push(`price >= ${filters.priceMin}`);
  if (filters.priceMax !== undefined) parts.push(`price <= ${filters.priceMax}`);
  return parts.join(' AND ');
}
