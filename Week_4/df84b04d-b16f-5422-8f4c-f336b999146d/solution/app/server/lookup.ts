import { containerOf } from "../shared/moves.js";
import { matchesQuery, parseQuery, type SearchTerm } from "../shared/search.js";
import type { SearchResult, Suggestion } from "../shared/types.js";
import type { OutlineState, Row } from "./outline.js";

function walk(state: OutlineState, rootId: string | null, visit: (row: Row, below: () => boolean) => boolean): void {
  const level = (container: string | null, path: Set<string>): boolean => {
    let any = false;
    for (const id of state.childrenOf(container)) {
      const row = state.placement(id);
      if (row === undefined) continue;
      const inner = containerOf(state, id);
      const below = (): boolean => {
        if (path.has(inner)) return false;
        path.add(inner);
        const found = level(inner, path);
        path.delete(inner);
        return found;
      };
      if (visit(row, below)) any = true;
    }
    return any;
  };
  const start = rootId === null ? null : containerOf(state, rootId);
  level(start, new Set(start === null ? [] : [start]));
}

export function searchView(state: OutlineState, rootId: string | null, query: string): SearchResult {
  const terms: SearchTerm[] = parseQuery(query);
  const matches = new Set<string>();
  const context = new Set<string>();
  const originals = new Set<string>();
  walk(state, rootId, (row, below) => {
    const original = state.originalOf(row);
    const hit = original !== undefined && matchesQuery(terms, {
      text: original.text,
      ...(() => {
        const bullet = state.bullet(row, 0);
        return { tags: bullet.tags, mentions: bullet.mentions, hasDate: bullet.date !== null };
      })(),
      completed: original.completed,
    });
    const inside = below();
    if (hit && original !== undefined) {
      matches.add(row.id);
      originals.add(original.id);
    } else if (inside) context.add(row.id);
    return hit || inside;
  });
  return { query, count: originals.size, matches: [...matches], context: [...context] };
}

export function suggestions(state: OutlineState, rootId: string | null, kind: "tag" | "mention", prefix: string): Suggestion[] {
  const wanted = prefix.replace(/^[#@]/, "").toLowerCase();
  const users = new Map<string, Set<string>>();
  walk(state, rootId, (row, below) => {
    const original = state.originalOf(row);
    if (original !== undefined) {
      const bullet = state.bullet(row, 0);
      for (const name of kind === "tag" ? bullet.tags : bullet.mentions) {
        const set = users.get(name) ?? new Set<string>();
        set.add(original.id);
        users.set(name, set);
      }
    }
    below();
    return false;
  });
  const marker = kind === "tag" ? "#" : "@";
  return [...users]
    .filter(([name]) => name.startsWith(wanted))
    .map(([name, set]) => ({ value: `${marker}${name}`, count: set.size }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 8);
}
