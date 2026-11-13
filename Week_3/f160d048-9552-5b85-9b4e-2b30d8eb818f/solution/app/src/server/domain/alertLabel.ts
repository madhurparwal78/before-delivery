import { CITIES, PAY_BANDS, ROLE_FAMILIES, WORK_PATTERNS } from "../../shared/reference";

export type AlertFilters = { q: string; city: string[]; role: string[]; remote: string[]; band: string[] };

/** The trimmed query text, then each chip label in facet order (City, Role, Work pattern, Pay band) and list order. */
export function alertLabel(filters: AlertFilters): string {
  const chips = [
    ...CITIES.filter((entry) => filters.city.includes(entry.id)).map((entry) => entry.name),
    ...ROLE_FAMILIES.filter((entry) => filters.role.includes(entry.id)).map((entry) => entry.name),
    ...WORK_PATTERNS.filter((entry) => filters.remote.includes(entry.id)).map((entry) => entry.name),
    ...PAY_BANDS.filter((entry) => filters.band.includes(entry.id)).map((entry) => entry.name),
  ];
  const parts = [filters.q.trim(), ...chips].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(", ") : "All jobs";
}

/** The query string of the job search these filters describe. */
export function alertSearch(filters: AlertFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim() !== "") params.set("q", filters.q.trim());
  for (const [name, values] of [["city", filters.city], ["role", filters.role], ["remote", filters.remote], ["band", filters.band]] as const) {
    for (const value of values) params.append(name, value);
  }
  return params.toString();
}

