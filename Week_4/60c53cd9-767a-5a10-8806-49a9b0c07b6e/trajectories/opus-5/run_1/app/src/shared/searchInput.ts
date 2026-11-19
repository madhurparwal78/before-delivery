/** The one place that bounds and reads search input, shared by the API and the finder. */

import { FIELD_MESSAGES } from './errors';
import type { FacetName } from './types';

export const SEARCH_TEXT_LIMIT = 80;
export const FACET_VALUE_LIMIT = 6;
export const PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 24;
export const PRICE_BOUND_MAX = 100000000;

export const FACET_VALUES: Record<FacetName, readonly string[]> = {
  bedrooms: ['1', '2', '3'],
  band: ['03-09', '10-19', '20-29', '30-35', '36-38'],
  facing: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  view: ['harbour', 'harbour-partial', 'park', 'city', 'ridge'],
  status: ['available', 'held', 'reserved'],
};

export const FACET_NAMES: readonly FacetName[] = ['bedrooms', 'band', 'facing', 'view', 'status'];

export interface SearchFilters {
  q: string;
  bedrooms: string[];
  band: string[];
  facing: string[];
  view: string[];
  status: string[];
  priceMin: number | null;
  priceMax: number | null;
}

export interface SearchQuery extends SearchFilters {
  after: string | null;
  limit: number;
}

export const EMPTY_FILTERS: SearchFilters = {
  q: '',
  bedrooms: [],
  band: [],
  facing: [],
  view: [],
  status: [],
  priceMin: null,
  priceMax: null,
};

export interface RawSearchInput {
  q?: string | null;
  bedrooms?: readonly string[];
  band?: readonly string[];
  facing?: readonly string[];
  view?: readonly string[];
  status?: readonly string[];
  priceMin?: string | null;
  priceMax?: string | null;
  after?: string | null;
  limit?: string | null;
}

export interface ValidatedSearch {
  query: SearchQuery;
  fields: Record<string, string>;
}

const WHOLE_NUMBER = /^[0-9]+$/;

/**
 * Reads raw query values into filters and collects the field messages for
 * anything out of bounds. Runs before the search service is consulted.
 */
export function validateSearchInput(raw: RawSearchInput): ValidatedSearch {
  const fields: Record<string, string> = {};
  const q = (raw.q ?? '').toString();
  if (q.length > SEARCH_TEXT_LIMIT) fields.q = FIELD_MESSAGES.qTooLong;

  const facets: Record<FacetName, string[]> = { bedrooms: [], band: [], facing: [], view: [], status: [] };
  for (const name of FACET_NAMES) {
    const values = (raw[name] ?? []).map((value) => value.toString());
    if (values.length > FACET_VALUE_LIMIT) {
      fields[name] = FIELD_MESSAGES.facetTooMany;
    } else if (values.some((value) => !FACET_VALUES[name].includes(value))) {
      fields[name] = FIELD_MESSAGES.facetUnknown;
    }
    facets[name] = orderFacetValues(name, values);
  }

  const priceMin = readPriceBound(raw.priceMin, 'priceMin', fields);
  const priceMax = readPriceBound(raw.priceMax, 'priceMax', fields);
  if (priceMin !== null && priceMax !== null && !fields.priceMin && !fields.priceMax && priceMin > priceMax) {
    fields.priceMin = FIELD_MESSAGES.priceMinAboveMax;
  }

  let limit = PAGE_SIZE;
  if (raw.limit !== undefined && raw.limit !== null && raw.limit !== '') {
    const text = raw.limit.toString();
    const parsed = Number(text);
    if (!WHOLE_NUMBER.test(text) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
      fields.limit = FIELD_MESSAGES.limit;
    } else {
      limit = parsed;
    }
  }

  return {
    fields,
    query: {
      q,
      bedrooms: facets.bedrooms,
      band: facets.band,
      facing: facets.facing,
      view: facets.view,
      status: facets.status,
      priceMin,
      priceMax,
      after: raw.after && raw.after !== '' ? raw.after.toString() : null,
      limit,
    },
  };
}

function readPriceBound(
  value: string | null | undefined,
  field: 'priceMin' | 'priceMax',
  fields: Record<string, string>,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const text = value.toString();
  if (!WHOLE_NUMBER.test(text)) {
    fields[field] = FIELD_MESSAGES.priceBound;
    return null;
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > PRICE_BOUND_MAX) {
    fields[field] = FIELD_MESSAGES.priceBound;
    return null;
  }
  return parsed;
}

/** Facet values always travel in the order the API table lists them. */
export function orderFacetValues(name: FacetName, values: readonly string[]): string[] {
  const published = FACET_VALUES[name];
  const unknown = values.filter((value) => !published.includes(value));
  const known = published.filter((value) => values.includes(value));
  return [...known, ...unknown];
}

export function filtersToQueryString(filters: SearchFilters, unit: string | null): string {
  const params = new URLSearchParams();
  if (filters.q) params.append('q', filters.q);
  for (const name of FACET_NAMES) {
    for (const value of orderFacetValues(name, filters[name])) params.append(name, value);
  }
  if (filters.priceMin !== null) params.append('priceMin', String(filters.priceMin));
  if (filters.priceMax !== null) params.append('priceMax', String(filters.priceMax));
  if (unit) params.append('unit', unit);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Drops address values that are not valid, as the finder's address rules require. */
export function sanitiseAddressFilters(params: URLSearchParams): SearchFilters {
  const filters: SearchFilters = { ...EMPTY_FILTERS, bedrooms: [], band: [], facing: [], view: [], status: [] };
  const q = params.get('q') ?? '';
  if (q.length <= SEARCH_TEXT_LIMIT) filters.q = q;
  for (const name of FACET_NAMES) {
    const values = params.getAll(name);
    if (values.length > FACET_VALUE_LIMIT) continue;
    filters[name] = orderFacetValues(
      name,
      values.filter((value) => FACET_VALUES[name].includes(value)),
    );
  }
  const min = params.get('priceMin');
  const max = params.get('priceMax');
  const readBound = (value: string | null): number | null => {
    if (value === null || value === '') return null;
    if (!WHOLE_NUMBER.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= PRICE_BOUND_MAX ? parsed : null;
  };
  const minValue = readBound(min);
  const maxValue = readBound(max);
  if (minValue !== null && maxValue !== null && minValue > maxValue) {
    filters.priceMin = null;
    filters.priceMax = null;
  } else {
    filters.priceMin = minValue;
    filters.priceMax = maxValue;
  }
  return filters;
}

export function filtersAreEqual(a: SearchFilters, b: SearchFilters): boolean {
  if (a.q !== b.q || a.priceMin !== b.priceMin || a.priceMax !== b.priceMax) return false;
  return FACET_NAMES.every(
    (name) => a[name].length === b[name].length && a[name].every((value, index) => value === b[name][index]),
  );
}

/**
 * The search text rule: every word of `q` must match the start of a word in the
 * unit code, facing, view tag or band. No typo tolerance.
 */
export function matchesSearchText(
  q: string,
  fields: { code: string; facing: string; viewTag: string; band: string },
): boolean {
  const words = q.toLowerCase().split(/[^a-z0-9]+/i).filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const haystack = [fields.code, fields.facing, fields.viewTag, fields.band]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  return words.every((word) => haystack.some((candidate) => candidate.startsWith(word)));
}
