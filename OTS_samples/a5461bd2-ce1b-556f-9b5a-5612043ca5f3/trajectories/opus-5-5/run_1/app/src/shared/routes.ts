import { sanitiseGalleryFilter, worldsOf, type GalleryFilter, type PriceFilter } from "./rules.js";
import type { Content } from "./types.js";

export type Route =
  | { kind: "home" }
  | { kind: "world"; slug: string }
  | { kind: "work" }
  | { kind: "project"; slug: string }
  | { kind: "services"; id: string }
  | { kind: "studio" }
  | { kind: "pricing" }
  | { kind: "faq" }
  | { kind: "contact" }
  | { kind: "missing-world" }
  | { kind: "missing-project" }
  | { kind: "missing-service" }
  | { kind: "missing-page" };

export type RouteKind = Route["kind"];

const SITE = "Vellum Orbit Studio";

export function parseRoute(pathname: string, content: Content): Route {
  const parts = pathname.split("/").slice(1);
  const [first, second] = parts;
  if (pathname === "/") return { kind: "home" };
  if (parts.length === 1) {
    switch (first) {
      case "work":
        return { kind: "work" };
      case "services":
        return { kind: "services", id: content.services[0].id };
      case "studio":
        return { kind: "studio" };
      case "pricing":
        return { kind: "pricing" };
      case "faq":
        return { kind: "faq" };
      case "contact":
        return { kind: "contact" };
    }
  }
  if (parts.length === 2 && second !== "") {
    const slug = decodeSegment(second);
    if (first === "worlds")
      return worldsOf(content).some((w) => w.slug === slug) ? { kind: "world", slug } : { kind: "missing-world" };
    if (first === "work")
      return content.projects.some((p) => p.slug === slug) ? { kind: "project", slug } : { kind: "missing-project" };
    if (first === "services")
      return content.services.some((s) => s.id === slug) ? { kind: "services", id: slug } : { kind: "missing-service" };
  }
  return { kind: "missing-page" };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function isMissing(route: Route): boolean {
  return route.kind.startsWith("missing-");
}

export function pageTitle(route: Route, content: Content): string {
  switch (route.kind) {
    case "home":
      return `${SITE} | Eight brand worlds`;
    case "world":
    case "project":
      return `${content.projects.find((p) => p.slug === route.slug)?.name} | ${SITE}`;
    case "work":
      return `Selected work | ${SITE}`;
    case "services":
      return `Services | ${SITE}`;
    case "studio":
      return `The studio | ${SITE}`;
    case "pricing":
      return `Price list | ${SITE}`;
    case "faq":
      return `Questions and answers | ${SITE}`;
    case "contact":
      return `Start a project | ${SITE}`;
    default:
      return `Not found | ${SITE}`;
  }
}

export type NavSection = "work" | "services" | "studio" | "pricing" | "contact" | null;

export function currentSection(route: Route): NavSection {
  switch (route.kind) {
    case "work":
    case "project":
      return "work";
    case "services":
      return "services";
    case "studio":
    case "pricing":
    case "contact":
      return route.kind;
    default:
      return null;
  }
}

export interface GalleryState extends GalleryFilter {
  pages: number;
}

export function parseGalleryQuery(search: URLSearchParams, content: Content): GalleryState {
  const filter = sanitiseGalleryFilter(
    content,
    (search.get("service") ?? "").split(","),
    search.get("industry"),
  );
  const pagesText = search.get("pages") ?? "";
  const pages = /^[1-9][0-9]{0,3}$/.test(pagesText) ? Number(pagesText) : 1;
  return { ...filter, pages };
}

export function galleryQuery(state: GalleryState): string {
  const parts: string[] = [];
  if (state.services.length > 0) parts.push(`service=${state.services.join(",")}`);
  if (state.industry !== null) parts.push(`industry=${state.industry}`);
  if (state.pages >= 2) parts.push(`pages=${state.pages}`);
  return parts.length > 0 ? `/work?${parts.join("&")}` : "/work";
}

export function parsePriceQuery(search: URLSearchParams, content: Content): PriceFilter {
  const category = search.get("category");
  const type = search.get("type");
  return {
    category: content.services.some((s) => s.id === category) ? category : null,
    type: type === "fixed" || type === "custom" ? type : null,
  };
}

export function priceQuery(filter: PriceFilter): string {
  const parts: string[] = [];
  if (filter.category !== null) parts.push(`category=${filter.category}`);
  if (filter.type !== null) parts.push(`type=${filter.type}`);
  return parts.length > 0 ? `/pricing?${parts.join("&")}` : "/pricing";
}

export interface ContactPrefill {
  service: string | null;
  item: string | null;
}

export function parseContactQuery(search: URLSearchParams, content: Content): ContactPrefill {
  const service = content.services.some((s) => s.id === search.get("service")) ? search.get("service") : null;
  const itemId = search.get("item");
  const item =
    service !== null && content.prices.some((p) => p.id === itemId && p.category === service) ? itemId : null;
  return { service, item };
}

export function parseFaqQuery(search: URLSearchParams, content: Content): string | null {
  const open = search.get("open");
  return content.questions.some((q) => q.id === open) ? open : null;
}
