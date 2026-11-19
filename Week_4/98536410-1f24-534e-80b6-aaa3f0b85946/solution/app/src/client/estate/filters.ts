// The estate's filters live in the address: /estate?q=<text>&state=<list>&shop=<shop code>.
import type { DisplayState } from "../types";
import { ALL_STATES } from "./stateDef";

export interface Filters {
  q: string;
  /** The checked states in published order; empty with `none` when no state is checked. */
  states: DisplayState[];
  none: boolean;
  shop: string | null;
}

export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const q = (params.get("q") ?? "").trim();
  const raw = params.get("state");
  const shop = params.get("shop") || null;
  if (raw === "none") return { q, states: [], none: true, shop };
  const wanted = new Set((raw ?? "").split(",").map((word) => word.trim()));
  const states = ALL_STATES.filter((state) => wanted.has(state));
  return { q, states: raw === null || states.length === 0 ? ALL_STATES : states, none: false, shop };
}

export function filtersToSearch(filters: Filters): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters.none) parts.push("state=none");
  else if (filters.states.length < ALL_STATES.length) parts.push(`state=${filters.states.join(",")}`);
  if (filters.shop) parts.push(`shop=${encodeURIComponent(filters.shop)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function withStates(filters: Filters, states: DisplayState[]): Filters {
  const ordered = ALL_STATES.filter((state) => states.includes(state));
  return { ...filters, states: ordered.length ? ordered : [], none: ordered.length === 0 };
}

/** The query string the shop list API takes for these filters. */
export function listQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.states.length < ALL_STATES.length) params.set("state", filters.states.join(","));
  const text = params.toString();
  return text ? `?${text}` : "";
}
