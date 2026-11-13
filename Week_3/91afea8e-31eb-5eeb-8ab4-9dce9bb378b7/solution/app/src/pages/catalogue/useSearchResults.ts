import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, failureMessage, get } from "../../lib/api";
import type { Hit } from "../../lib/types";
import { apiQuery, type SearchState } from "./query";
import { learnSellers } from "./sellers";

export interface Facets {
  category: Record<string, number>;
  brand: Record<string, number>;
  seller: Record<string, number>;
  rating: Record<string, number>;
}

interface Page {
  hits: Hit[];
  facets: Partial<Facets>;
  total: number;
  next_cursor: string | null;
  degraded: boolean;
}

interface SearchResults {
  hits: Hit[];
  total: number;
  facets: Facets;
  degraded: boolean;
  nextCursor: string | null;
}

const EMPTY_FACETS: Facets = { category: {}, brand: {}, seller: {}, rating: {} };

/** The last answers, so Back to a search shows its cards at once while a fresh answer is fetched. */
const answers = new Map<string, SearchResults>();

function settle(page: Page): SearchResults {
  learnSellers(page.hits);
  return {
    hits: page.hits,
    total: page.total,
    facets: { ...EMPTY_FACETS, ...page.facets },
    degraded: page.degraded,
    nextCursor: page.next_cursor,
  };
}

interface SearchView {
  results: SearchResults | null;
  /** The facets of the last answer, kept while the next answer is on its way. */
  facets: Facets;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Index of the first card the last "Load more" added. */
  appendedFrom: number | null;
  loadMore: () => Promise<void>;
  clearAppended: () => void;
}

export function useSearchResults(state: SearchState): SearchView {
  const key = apiQuery(state, null);
  const [held, setHeld] = useState<{ key: string; results: SearchResults } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [facets, setFacets] = useState<Facets>(() => answers.get(key)?.facets ?? EMPTY_FACETS);
  const [loadingMore, setLoadingMore] = useState(false);
  const [appendedFrom, setAppendedFrom] = useState<number | null>(null);
  const newest = useRef(key);
  const results = held?.key === key ? held.results : (answers.get(key) ?? null);
  const error = failed?.key === key ? failed.message : null;
  const current = useRef<SearchResults | null>(results);
  current.current = results;

  useEffect(() => {
    newest.current = key;
    get<Page>(`/api/search?${key}`).then(
      (page) => {
        if (newest.current !== key) return;
        const next = settle(page);
        answers.set(key, next);
        setHeld({ key, results: next });
        setFacets(next.facets);
      },
      (failure: unknown) => {
        if (newest.current !== key) return;
        if (!(failure instanceof ApiFailure)) throw failure;
        setFailed({ key, message: failureMessage(failure) });
      },
    );
  }, [key]);

  const loadMore = useCallback(async (): Promise<void> => {
    const base = current.current;
    if (!base?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await get<Page>(`/api/search?${apiQuery(state, base.nextCursor)}`);
      if (newest.current !== key) return;
      const seen = new Set(base.hits.map((hit) => hit.listing_id));
      const added = page.hits.filter((hit) => !seen.has(hit.listing_id));
      learnSellers(added);
      const merged: SearchResults = { ...base, hits: [...base.hits, ...added], nextCursor: page.next_cursor };
      answers.set(key, merged);
      setHeld({ key, results: merged });
      setAppendedFrom(base.hits.length);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setFailed({ key, message: failureMessage(failure) });
    } finally {
      setLoadingMore(false);
    }
  }, [key, state]);

  const clearAppended = useCallback((): void => setAppendedFrom(null), []);

  return { results, facets, loading: results === null && error === null, loadingMore, error, appendedFrom, loadMore, clearAppended };
}
