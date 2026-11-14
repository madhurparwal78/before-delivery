import type { Catalog, Project, Service, World } from "./types";

export const SITE_NAME = "Vellum Orbit Studio";

export type NotFoundKind = "world" | "project" | "service" | "page";

export type Route =
  | { name: "home" }
  | { name: "world"; world: World }
  | { name: "work" }
  | { name: "case-study"; project: Project }
  | { name: "services"; service: Service }
  | { name: "studio" }
  | { name: "pricing" }
  | { name: "faq" }
  | { name: "contact" }
  | { name: "not-found"; kind: NotFoundKind };

const SINGLE_PAGES: Record<string, Route> = {
  "/": { name: "home" },
  "/work": { name: "work" },
  "/studio": { name: "studio" },
  "/pricing": { name: "pricing" },
  "/faq": { name: "faq" },
  "/contact": { name: "contact" },
};

/** Maps an address to its page; the server and the browser both decide pages and not-found answers here. */
export function resolveRoute(pathname: string, catalog: Catalog): Route {
  const single = SINGLE_PAGES[pathname];
  if (single) return single;
  const parts = pathname.split("/");
  const [empty, section, id, ...rest] = parts;
  if (empty !== "" || rest.length > 0 || section === undefined) return { name: "not-found", kind: "page" };
  if (section === "services" && id === undefined) return { name: "services", service: firstService(catalog) };
  if (id === undefined || id === "") return { name: "not-found", kind: "page" };
  switch (section) {
    case "worlds": {
      const world = catalog.worlds.find((candidate) => candidate.slug === id);
      return world ? { name: "world", world } : { name: "not-found", kind: "world" };
    }
    case "work": {
      const project = catalog.projects.find((candidate) => candidate.slug === id);
      return project ? { name: "case-study", project } : { name: "not-found", kind: "project" };
    }
    case "services": {
      const service = catalog.services.find((candidate) => candidate.id === id);
      return service ? { name: "services", service } : { name: "not-found", kind: "service" };
    }
    default:
      return { name: "not-found", kind: "page" };
  }
}

function firstService(catalog: Catalog): Service {
  return catalog.services[0] as Service;
}

export function titleOf(route: Route): string {
  switch (route.name) {
    case "home":
      return `${SITE_NAME} | Eight brand worlds`;
    case "world":
      return `${route.world.name} | ${SITE_NAME}`;
    case "work":
      return `Selected work | ${SITE_NAME}`;
    case "case-study":
      return `${route.project.name} | ${SITE_NAME}`;
    case "services":
      return `Services | ${SITE_NAME}`;
    case "studio":
      return `The studio | ${SITE_NAME}`;
    case "pricing":
      return `Price list | ${SITE_NAME}`;
    case "faq":
      return `Questions and answers | ${SITE_NAME}`;
    case "contact":
      return `Start a project | ${SITE_NAME}`;
    case "not-found":
      return `Not found | ${SITE_NAME}`;
  }
}

export const NOT_FOUND_COPY: Record<NotFoundKind, { heading: string; link: string; href: string }> = {
  world: { heading: "This world does not exist.", link: "Back to the worlds", href: "/" },
  project: { heading: "This project does not exist.", link: "All work", href: "/work" },
  service: { heading: "This service does not exist.", link: "All services", href: "/services" },
  page: { heading: "This page does not exist.", link: `Back to ${SITE_NAME}`, href: "/" },
};

export function isPublishedPath(pathname: string, catalog: Catalog): boolean {
  return resolveRoute(pathname, catalog).name !== "not-found";
}
