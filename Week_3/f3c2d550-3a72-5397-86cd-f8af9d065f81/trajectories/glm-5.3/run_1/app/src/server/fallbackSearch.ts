// Fallback search while search is unreachable or being rebuilt: `q` matches as a
// case-insensitive substring of title, maker, notes, finish or any material;
// filters match exactly; results are newest capture first.

import type { Pool } from "pg";
import { listStored } from "./repo.js";
import type { Reference } from "../shared/domain.js";

export interface SearchFilters { colour_family?: string; material?: string; finish?: string }

export async function fallbackSearch(pool: Pool, q: string, filters: SearchFilters): Promise<{ source: "fallback"; results: Reference[] }> {
  const all = await listStored(pool);
  const needle = q.trim().toLowerCase();
  const results = all.filter((r) => {
    const haystack = [r.title, r.maker ?? "", r.notes ?? "", r.finish ?? "", ...r.materials]
      .join(" ").toLowerCase();
    return haystack.includes(needle)
      && (!filters.colour_family || r.colour_family === filters.colour_family)
      && (!filters.material || r.materials.some((m) => m.toLowerCase() === filters.material!.toLowerCase()))
      && (!filters.finish || (r.finish ?? "").toLowerCase() === filters.finish!.toLowerCase());
  });
  return { source: "fallback", results };
}
