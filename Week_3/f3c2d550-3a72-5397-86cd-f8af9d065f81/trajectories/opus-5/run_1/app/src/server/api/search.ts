import type { SearchJson } from '../../shared/types.js';
import { fallbackSearch, loadReferences } from '../db/references.js';
import { toReferenceJson } from '../db/references.js';
import { searchIds, type SearchFilters } from '../services/search.js';
import { searchUsable } from '../services/status.js';

export const MAX_QUERY_LENGTH = 200;

/** The index answers while it is up; otherwise the library's own records do. */
export async function searchReferences(
  query: string,
  filters: SearchFilters,
): Promise<SearchJson> {
  if (searchUsable()) {
    try {
      const ids = await searchIds(query, filters);
      const rows = await loadReferences(ids);
      const results = ids
        .map((id) => rows.get(id))
        .filter((row) => row !== undefined && row.state === 'stored')
        .map((row) => toReferenceJson(row!));
      return { source: 'index', results };
    } catch {
      // The index went away between the status check and the query.
    }
  }
  const rows = await fallbackSearch(query, filters);
  return { source: 'fallback', results: rows.map(toReferenceJson) };
}
