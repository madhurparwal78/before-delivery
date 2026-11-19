import { api, ApiFailure } from "./api";
import type { SearchResult } from "./types";

// Workspace search. The server judges the query caps; a refused query comes back with its `q`
// copy and never opens the results panel. Accepted first pages are kept so Back, reload and a
// fresh submit show the same results at once.

export type SearchPage = { query: string; total: number; results: SearchResult[]; next_cursor: string | null };
type SearchOutcome = { page: SearchPage } | { refused: string };

const firstPages = new Map<string, SearchPage>();

export async function runSearch(query: string, before?: string): Promise<SearchOutcome> {
  const params = new URLSearchParams({ q: query, limit: "30" });
  if (before) params.set("before", before);
  try {
    const page = await api<SearchPage>("GET", `/api/search?${params.toString()}`);
    if (!before) firstPages.set(query, page);
    return { page };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422 && error.body?.errors?.q) return { refused: error.body.errors.q };
    throw error;
  }
}

export function cachedSearch(query: string): SearchPage | undefined {
  return firstPages.get(query);
}
