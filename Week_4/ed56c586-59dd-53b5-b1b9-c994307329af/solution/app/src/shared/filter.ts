import { DISCIPLINES, PROJECTS, type DisciplineValue, type Project } from "./catalog.js";

/** The filter rules and the canonical form of the addresses that carry them. */

export const CATEGORY_PARAM = "category";

/** Pressed disciplines from an address value: unknown and repeated values are dropped, the rest sit in canonical order. */
export function parseCategories(raw: string | null): readonly DisciplineValue[] {
  const named = new Set((raw ?? "").split(","));
  return DISCIPLINES.filter((discipline) => named.has(discipline.value)).map((discipline) => discipline.value);
}

function categoryParam(categories: readonly DisciplineValue[]): string {
  return categories.join(",");
}

/** Whether an address value differs from the canonical form of what it applies. */
export function needsCanonicalCategories(raw: string | null): boolean {
  return raw !== null && raw !== categoryParam(parseCategories(raw));
}

export function toggleCategory(categories: readonly DisciplineValue[], value: DisciplineValue): readonly DisciplineValue[] {
  const pressed = new Set(categories);
  if (pressed.has(value)) pressed.delete(value);
  else pressed.add(value);
  return DISCIPLINES.filter((discipline) => pressed.has(discipline.value)).map((discipline) => discipline.value);
}

/** `All` is pressed exactly when no discipline is. */
export function isPressed(categories: readonly DisciplineValue[], button: DisciplineValue | "all"): boolean {
  return button === "all" ? categories.length === 0 : categories.includes(button);
}

function projectMatches(project: Project, categories: readonly DisciplineValue[]): boolean {
  return categories.length === 0 || project.disciplines.some((value) => categories.includes(value));
}

export function visibleProjects(categories: readonly DisciplineValue[]): readonly Project[] {
  return PROJECTS.filter((project) => projectMatches(project, categories));
}

export function resultsText(shown: number): string {
  return `Showing ${shown} of ${PROJECTS.length} projects.`;
}

const GALLERY_COLUMNS = 3;

/** The column a shown card takes at the widest layout; the middle column starts lower. */
export function galleryColumn(shownIndex: number): number {
  return shownIndex % GALLERY_COLUMNS;
}

/** The query string of address parameters. Commas in a value stay as they are, as in `?category=motion,design`. */
export function addressQuery(params: URLSearchParams): string {
  const parts = [...params].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%2C/g, ",")}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** Writes the pressed disciplines into the address parameters, or removes `category` when none is pressed. */
export function applyCategories(params: URLSearchParams, categories: readonly DisciplineValue[]): void {
  if (categories.length === 0) params.delete(CATEGORY_PARAM);
  else params.set(CATEGORY_PARAM, categoryParam(categories));
}

function queryOf(categories: readonly DisciplineValue[]): string {
  const params = new URLSearchParams();
  applyCategories(params, categories);
  return addressQuery(params);
}

export function caseStudyHref(slug: string, categories: readonly DisciplineValue[]): string {
  return `/work/${slug}${queryOf(categories)}`;
}

export function galleryHref(categories: readonly DisciplineValue[]): string {
  return `/${queryOf(categories)}#work`;
}
