import type { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError } from './store.js';
import type { Account } from '../domain/types.js';
import {
  bulletMatches,
  parseSearchQuery,
} from '../domain/text.js';
import { viewOrder } from '../domain/tree.js';
import { loadScope } from './outline-service.js';

export interface SearchResponse {
  query: string;
  count: number;
  matches: string[];
  context: string[];
}

export async function runSearch(
  pool: Pool,
  config: Config,
  account: Account,
  rootId: string | null,
  query: string,
): Promise<SearchResponse> {
  if (query.length > config.searchMaxChars) {
    throw new ApiError(422, {
      errors: { q: `Search holds at most ${config.searchMaxChars} characters.` },
    });
  }
  const now = Date.now();
  const loaded = await loadScope(pool, account, rootId, now, config);
  const terms = parseSearchQuery(query);
  const entries = viewOrder(loaded.rows, loaded.root ? loaded.root.id : null, now, config.trashSeconds);
  const matchedOriginals = new Set<string>();
  const matchedPlacements = new Set<string>();
  for (const entry of entries) {
    if (entry.placeholder) continue;
    if (bulletMatches(entry.original, terms)) {
      matchedOriginals.add(entry.original.id);
    }
  }
  for (const entry of entries) {
    if (matchedOriginals.has(entry.original.id)) {
      matchedPlacements.add(entry.placement.id);
    }
  }
  const context = new Set<string>();
  for (const entry of entries) {
    if (!matchedPlacements.has(entry.placement.id)) continue;
    let parentId = entry.placement.parentId;
    const seen = new Set<string>();
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      context.add(parentId);
      const parent = loaded.rows.get(parentId);
      if (!parent) break;
      parentId = parent.parentId;
    }
  }
  return {
    query,
    count: matchedOriginals.size,
    matches: entries.filter((e) => matchedPlacements.has(e.placement.id)).map((e) => e.placement.id),
    context: entries.filter((e) => context.has(e.placement.id)).map((e) => e.placement.id),
  };
}

export interface Suggestion {
  value: string;
  count: number;
}

export async function runSuggest(
  pool: Pool,
  config: Config,
  account: Account,
  rootId: string | null,
  kind: 'tag' | 'mention',
  prefix: string,
): Promise<Suggestion[]> {
  const now = Date.now();
  const loaded = await loadScope(pool, account, rootId, now, config);
  const entries = viewOrder(loaded.rows, loaded.root ? loaded.root.id : null, now, config.trashSeconds);
  const usage = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.placeholder) continue;
    const values = kind === 'tag' ? entry.original.tags : entry.original.mentions;
    for (const value of values) {
      if (!value.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const set = usage.get(value) ?? new Set<string>();
      set.add(entry.original.id);
      usage.set(value, set);
    }
  }
  return [...usage.entries()]
    .map(([value, set]) => ({ value: (kind === 'tag' ? '#' : '@') + value, count: set.size }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value))
    .slice(0, 8);
}
