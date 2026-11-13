import { config } from '../config';
import { db } from '../db/pool';
import { SEARCH_NOTICE } from '../errors';
import { ProductDocument, runSearch } from '../services/search';
import {
  CatalogueFilters,
  FILTER_GROUPS,
  FilterGroup,
  FilterOption,
  SearchResultItem,
  documentMatchesGroup,
  documentMatchesText,
  documentValues,
  optionsForGroup,
  publishedDocuments,
  resultFromDocument,
  sortDocuments
} from './catalogue';
import { AIRLINES, CATEGORY_LABELS, PRICE_BANDS, SIZE_ORDER } from './constants';

const FACET_ATTRIBUTE: Record<FilterGroup, string> = {
  category: 'category',
  colour: 'colour',
  size: 'size',
  material: 'material_slug',
  price: 'price',
  fit: 'fit'
};

export type CatalogueResult = {
  mode: 'search' | 'fallback';
  total: number;
  page: number;
  page_size: number;
  results: SearchResultItem[];
  facets: Record<string, Record<string, number>> | null;
  notice: string | null;
  options: Record<string, FilterOption[]>;
};

export function parseFilters(query: URLSearchParams, collection: string): CatalogueFilters {
  const list = (name: string): string[] => {
    const raw = query.get(name);
    if (raw === null) return [];
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  };
  const sortRaw = query.get('sort') ?? 'featured';
  const sort = ['featured', 'price-asc', 'price-desc', 'newest'].includes(sortRaw) ? sortRaw : 'featured';
  const pageRaw = Number(query.get('page') ?? '1');
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  return {
    q: query.get('q') ?? '',
    collection,
    category: list('category'),
    colour: list('colour'),
    size: list('size'),
    material: list('material'),
    price: list('price'),
    fit: list('fit'),
    sort,
    page
  };
}

function sortClause(filters: CatalogueFilters): string[] {
  if (filters.sort === 'price-asc') return ['min_price:asc', 'name:asc'];
  if (filters.sort === 'price-desc') return ['min_price:desc', 'name:asc'];
  if (filters.sort === 'newest') return ['published_at:desc', 'name:asc'];
  if (filters.q.trim() !== '') return ['min_price:asc'];
  return ['featured_rank:asc', 'name:asc'];
}

function groupFilter(group: FilterGroup, values: string[]): string[] {
  return values.map((value) => `${FACET_ATTRIBUTE[group]} = "${value.replace(/"/g, '')}"`);
}

function buildFilter(filters: CatalogueFilters, skip: FilterGroup | null): string[][] {
  const out: string[][] = [[`collection = "${filters.collection.replace(/"/g, '')}"`]];
  for (const group of FILTER_GROUPS) {
    if (group === skip) continue;
    const values = filters[group];
    if (values.length > 0) out.push(groupFilter(group, values));
  }
  return out;
}

function labelsFromDocuments(documents: ProductDocument[]): {
  colour: Map<string, string>;
  material: Map<string, string>;
} {
  const colour = new Map<string, string>();
  const material = new Map<string, string>();
  for (const document of documents) {
    for (const option of document.colour_options) colour.set(option.slug, option.name);
    for (const slug of document.material_slug) material.set(slug, document.material);
  }
  return { colour, material };
}

function buildOptions(
  documents: ProductDocument[],
  counts: Record<string, Record<string, number>> | null
): Record<string, FilterOption[]> {
  const labels = labelsFromDocuments(documents);
  const options: Record<string, FilterOption[]> = {};
  for (const group of FILTER_GROUPS) {
    const present = new Set<string>();
    for (const document of documents) {
      for (const value of documentValues(document, group)) present.add(value);
    }
    let list: FilterOption[];
    if (group === 'colour') {
      list = [...present]
        .map((value) => ({ value, label: labels.colour.get(value) ?? value, count: null as number | null }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } else if (group === 'material') {
      list = [...present]
        .map((value) => ({ value, label: labels.material.get(value) ?? value, count: null as number | null }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } else {
      list = optionsForGroup(group, present);
    }
    if (counts !== null) {
      const groupCounts = counts[group] ?? {};
      list = list.map((option) => ({ ...option, count: groupCounts[option.value] ?? 0 }));
    }
    options[group] = list;
  }
  return options;
}

export function orderedColourOptions(options: FilterOption[]): FilterOption[] {
  return options;
}

async function searchWithEngine(filters: CatalogueFilters): Promise<CatalogueResult> {
  const collectionDocs = await runSearch({
    q: '',
    filter: [[`collection = "${filters.collection.replace(/"/g, '')}"`]],
    sort: ['featured_rank:asc'],
    offset: 0,
    limit: 1000
  });

  const main = await runSearch({
    q: filters.q,
    filter: buildFilter(filters, null),
    sort: sortClause(filters),
    offset: (filters.page - 1) * config.pageSize,
    limit: config.pageSize
  });

  const counts: Record<string, Record<string, number>> = {};
  for (const group of FILTER_GROUPS) {
    const response = await runSearch({
      q: filters.q,
      filter: buildFilter(filters, group),
      sort: [],
      offset: 0,
      limit: 0,
      facets: [FACET_ATTRIBUTE[group]]
    });
    counts[group] = response.facetDistribution?.[FACET_ATTRIBUTE[group]] ?? {};
  }

  return {
    mode: 'search',
    total: main.estimatedTotalHits,
    page: filters.page,
    page_size: config.pageSize,
    results: main.hits.map(resultFromDocument),
    facets: counts,
    notice: null,
    options: buildOptions(collectionDocs.hits, counts)
  };
}

async function searchWithDatabase(filters: CatalogueFilters): Promise<CatalogueResult> {
  const all = await publishedDocuments(db);
  const inCollection = all.filter((document) => document.collection.includes(filters.collection));
  let matching = inCollection.filter((document) => documentMatchesText(document, filters.q));
  for (const group of FILTER_GROUPS) {
    matching = matching.filter((document) => documentMatchesGroup(document, group, filters[group]));
  }
  const sorted = sortDocuments(matching, filters.sort);
  const start = (filters.page - 1) * config.pageSize;
  return {
    mode: 'fallback',
    total: sorted.length,
    page: filters.page,
    page_size: config.pageSize,
    results: sorted.slice(start, start + config.pageSize).map(resultFromDocument),
    facets: null,
    notice: SEARCH_NOTICE,
    options: buildOptions(inCollection, null)
  };
}

export async function catalogueSearch(filters: CatalogueFilters): Promise<CatalogueResult> {
  try {
    return await searchWithEngine(filters);
  } catch {
    return await searchWithDatabase(filters);
  }
}

export async function catalogueSuggest(text: string): Promise<{ mode: 'search' | 'fallback'; suggestions: Array<{ name: string; slug: string }> }> {
  if (text.trim() === '') {
    try {
      await runSearch({ q: '', filter: [], sort: [], offset: 0, limit: 0 });
      return { mode: 'search', suggestions: [] };
    } catch {
      return { mode: 'fallback', suggestions: [] };
    }
  }
  try {
    const response = await runSearch({ q: text, filter: [], sort: [], offset: 0, limit: 6 });
    return {
      mode: 'search',
      suggestions: response.hits.map((hit) => ({ name: hit.name, slug: hit.slug }))
    };
  } catch {
    return { mode: 'fallback', suggestions: [] };
  }
}

export function groupLabel(group: FilterGroup): string {
  if (group === 'category') return 'Category';
  if (group === 'colour') return 'Colour';
  if (group === 'size') return 'Size';
  if (group === 'material') return 'Material';
  if (group === 'price') return 'Price';
  return 'Cabin fit';
}

export function optionLabel(group: FilterGroup, value: string, options: Record<string, FilterOption[]>): string {
  const found = (options[group] ?? []).find((option) => option.value === value);
  if (found !== undefined) return found.label;
  if (group === 'category') return CATEGORY_LABELS[value] ?? value;
  if (group === 'size') return SIZE_ORDER.find((size) => size.slug === value)?.label ?? value;
  if (group === 'price') return PRICE_BANDS.find((band) => band.slug === value)?.label ?? value;
  if (group === 'fit') return AIRLINES.find((airline) => airline.code === value)?.name ?? value;
  return value;
}
