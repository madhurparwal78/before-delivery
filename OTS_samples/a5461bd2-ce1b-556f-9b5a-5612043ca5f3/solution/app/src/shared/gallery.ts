import type { Industry, Project, ProjectListItem, ProjectPage, Service } from "./types";

export interface GalleryFilter {
  services: string[];
  industry: string | null;
}

interface GalleryCounts {
  services: Record<string, number>;
  industries: Record<string, number>;
  allIndustries: number;
}

export const EMPTY_FILTER: GalleryFilter = { services: [], industry: null };

/** A project matches when it has at least one chosen service (or none is chosen) and is in the chosen industry. */
function matchesFilter(project: ProjectListItem, filter: GalleryFilter): boolean {
  const serviceMatch = filter.services.length === 0 || filter.services.some((id) => project.services.includes(id));
  const industryMatch = filter.industry === null || project.industry_id === filter.industry;
  return serviceMatch && industryMatch;
}

export function matchProjects<T extends ProjectListItem>(projects: T[], filter: GalleryFilter): T[] {
  return projects.filter((project) => matchesFilter(project, filter));
}

/** A service count ignores the service filter; an industry count ignores the industry filter. */
export function galleryCounts(projects: ProjectListItem[], services: Service[], industries: Industry[], filter: GalleryFilter): GalleryCounts {
  const byIndustry = matchProjects(projects, { ...filter, services: [] });
  const byService = matchProjects(projects, { ...filter, industry: null });
  return {
    services: Object.fromEntries(services.map((service) => [service.id, matchProjects(byIndustry, { services: [service.id], industry: null }).length])),
    industries: Object.fromEntries(industries.map((industry) => [industry.id, byService.filter((p) => p.industry_id === industry.id).length])),
    allIndustries: byService.length,
  };
}

function listItem(project: Project): ProjectListItem {
  const { slug, name, industry_id, industry, services, world_slug } = project;
  return { slug, name, industry_id, industry, services, world_slug };
}

/** One page of matches by offset, in gallery order; `next_offset` is null when no matches follow. */
export function pageOf<T>(matches: T[], offset: number, limit: number): { items: T[]; next_offset: number | null } {
  const items = matches.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, next_offset: items.length > 0 && next < matches.length ? next : null };
}

export function pageProjects(projects: Project[], filter: GalleryFilter, offset: number, limit: number): ProjectPage {
  const matches = matchProjects(projects, filter);
  const page = pageOf(matches, offset, limit);
  return { total: matches.length, items: page.items.map(listItem), next_offset: page.next_offset };
}

interface Neighbours {
  previous: { slug: string; name: string };
  next: { slug: string; name: string };
}

/** Previous and next project follow gallery order and wrap. */
export function neighboursOf(projects: Project[], slug: string): Neighbours {
  const at = projects.findIndex((project) => project.slug === slug);
  const previous = projects[(at - 1 + projects.length) % projects.length] as Project;
  const next = projects[(at + 1) % projects.length] as Project;
  return { previous: { slug: previous.slug, name: previous.name }, next: { slug: next.slug, name: next.name } };
}

/** The `offset` and `limit` of a project listing, or the messages for those that are not whole numbers. */
export function parsePaging(offsetText: string | null, limitText: string | null): { offset: number; limit: number | null } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (offsetText !== null && !/^\d+$/.test(offsetText)) errors.offset = "Must be a whole number of 0 or more.";
  if (limitText !== null && !/^[1-9]\d*$/.test(limitText)) errors.limit = "Must be a whole number of 1 or more.";
  if (Object.keys(errors).length > 0) return { errors };
  return { offset: offsetText === null ? 0 : Number(offsetText), limit: limitText === null ? null : Number(limitText) };
}

export function queryOfGallery(filter: GalleryFilter, services: Service[], pages: number): string {
  const params = new URLSearchParams();
  const ordered = services.filter((service) => filter.services.includes(service.id)).map((service) => service.id);
  if (ordered.length) params.set("service", ordered.join(","));
  if (filter.industry) params.set("industry", filter.industry);
  if (pages >= 2) params.set("pages", String(pages));
  const text = params.toString().replaceAll("%2C", ",");
  return text ? `?${text}` : "";
}

export function parseGalleryQuery(search: string, services: Service[], industries: Industry[]): { filter: GalleryFilter; pages: number } {
  const params = new URLSearchParams(search);
  const known = new Set((params.get("service") ?? "").split(","));
  const industry = params.get("industry");
  const pages = Number(params.get("pages"));
  return {
    filter: {
      services: services.filter((service) => known.has(service.id)).map((service) => service.id),
      industry: industries.some((entry) => entry.id === industry) ? industry : null,
    },
    pages: Number.isInteger(pages) && pages >= 2 ? pages : 1,
  };
}
