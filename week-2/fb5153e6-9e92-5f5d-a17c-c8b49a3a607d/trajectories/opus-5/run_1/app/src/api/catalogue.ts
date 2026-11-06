import { ApiError, fieldError, validationFailed } from '../http/errors.js';
import type { Category, Format } from '../domain/model.js';
import { CATEGORIES, FORMATS } from '../domain/model.js';
import type { CatalogueLicence } from '../domain/money.js';
import type { SearchSelection, SortOrder, SearchResult } from '../services/search.js';
import { search } from '../services/search.js';
import { hasUnconfirmedRemoval } from '../services/indexer.js';

export const PAGE_SIZE = 8;

const LICENCES: readonly CatalogueLicence[] = ['personal', 'commercial', 'studio'];
const SORTS: readonly SortOrder[] = ['newest', 'price_asc', 'price_desc'];

/** The parameter names `/api/catalogue` and the read API list accept. */
export const CATALOGUE_PARAMS: readonly string[] = [
  'q',
  'category',
  'licence',
  'format',
  'sort',
  'page',
];

function commaList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
): readonly T[] {
  if (raw === null || raw === '') return [];
  const values = raw.split(',').map((v) => v.trim());
  for (const value of values) {
    if (!allowed.includes(value as T)) {
      throw validationFailed([fieldError(field, 'choose_one')]);
    }
  }
  // Facet values keep the order shown in the rail.
  return allowed.filter((a) => values.includes(a));
}

export function parseSelection(query: URLSearchParams): SearchSelection {
  const q = query.get('q') ?? '';
  if ([...q].length > 100) throw validationFailed([fieldError('q', 'q')]);

  const sortRaw = query.get('sort');
  if (sortRaw !== null && !SORTS.includes(sortRaw as SortOrder)) {
    throw validationFailed([fieldError('sort', 'choose_one')]);
  }

  const pageRaw = query.get('page');
  let page = 1;
  if (pageRaw !== null) {
    if (!/^\d+$/.test(pageRaw)) throw validationFailed([fieldError('page', 'page')]);
    page = Number.parseInt(pageRaw, 10);
    if (page < 1) throw validationFailed([fieldError('page', 'page')]);
  }

  return {
    q,
    category: commaList<Category>(query.get('category'), CATEGORIES, 'category'),
    licence: commaList<CatalogueLicence>(query.get('licence'), LICENCES, 'licence'),
    format: commaList<Format>(query.get('format'), FORMATS, 'format'),
    sort: (sortRaw as SortOrder | null) ?? 'newest',
    page,
    pageSize: PAGE_SIZE,
  };
}

export interface CatalogueCard {
  readonly slug: string;
  readonly title: string;
  readonly category: Category;
  readonly formats: readonly Format[];
  readonly licences: readonly CatalogueLicence[];
  readonly price_from_cents: number;
  readonly preview_url: string;
  readonly rebuilding: boolean;
}

export interface CatalogueReply {
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly pages: number;
  readonly items: readonly CatalogueCard[];
  readonly facets: SearchResult['facets'];
}

/**
 * The search index is the only source for results, facet counts and the export.
 * While a removal is unconfirmed nothing is served, so no stale entry escapes.
 */
export async function runCatalogue(selection: SearchSelection): Promise<CatalogueReply> {
  if (await hasUnconfirmedRemoval()) throw new ApiError('search_unavailable');
  const result = await search(selection);
  return {
    total: result.total,
    page: selection.page,
    page_size: selection.pageSize,
    pages: Math.max(1, Math.ceil(result.total / selection.pageSize)),
    items: result.hits.map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      category: hit.category,
      formats: hit.formats,
      licences: hit.licences,
      price_from_cents: hit.price_from_cents,
      preview_url: `/media/${hit.slug}/preview.png`,
      rebuilding: hit.rebuilding,
    })),
    facets: result.facets,
  };
}

/** Writes the selection back into the address, leaving defaults out. */
export function selectionToQuery(selection: SearchSelection): URLSearchParams {
  const params = new URLSearchParams();
  if (selection.q !== '') params.set('q', selection.q);
  if (selection.category.length > 0) params.set('category', selection.category.join(','));
  if (selection.licence.length > 0) params.set('licence', selection.licence.join(','));
  if (selection.format.length > 0) params.set('format', selection.format.join(','));
  if (selection.sort !== 'newest') params.set('sort', selection.sort);
  if (selection.page !== 1) params.set('page', String(selection.page));
  return params;
}
