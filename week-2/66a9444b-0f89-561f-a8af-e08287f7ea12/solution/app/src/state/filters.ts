// One shared filter state for the lattice, its toggle grid and the schedule comboboxes: the URL query.
import { setQuery, useLocation } from "../router.ts";
import type { Programme } from "../types.ts";

export type Filters = { day: string | null; venue: string | null; discipline: string | null; clashes: boolean };

function readFilters(search: URLSearchParams, programme: Programme | null): Filters {
  const valid = (value: string | null, ids: string[] | undefined) => (value && (!ids || ids.includes(value)) ? value : null);
  return {
    day: valid(search.get("day"), programme?.festival_days.map((d) => d.date)),
    venue: valid(search.get("venue"), programme?.venues.map((v) => v.id)),
    discipline: valid(search.get("discipline"), programme?.disciplines.map((d) => d.id)),
    clashes: search.get("clashes") === "1",
  };
}

export function useFilters(programme: Programme | null): Filters {
  return readFilters(useLocation().search, programme);
}

export function setFilters(changes: Partial<Filters>): void {
  const query: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(changes)) {
    query[key] = key === "clashes" ? (value ? "1" : null) : ((value as string | null) || null);
  }
  setQuery(query);
}

/** Drops unknown filter values from the URL once the programme is known. */
export function dropUnknownFilters(search: URLSearchParams, programme: Programme): void {
  const known = readFilters(search, programme);
  const stale: Record<string, null> = {};
  for (const key of ["day", "venue", "discipline"] as const) if (search.get(key) && !known[key]) stale[key] = null;
  if (Object.keys(stale).length) setQuery(stale, { replace: true });
}

/** The lattice's raised objects, in the order day, venue, discipline. */
export function raisedList(f: Filters): string {
  return [f.day && `day:${f.day}`, f.venue && `venue:${f.venue}`, f.discipline && `discipline:${f.discipline}`].filter(Boolean).join(",");
}
