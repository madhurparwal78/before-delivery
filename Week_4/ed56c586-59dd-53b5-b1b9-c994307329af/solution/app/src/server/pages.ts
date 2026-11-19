import { SERVICE_PARAM, projectBySlug, serviceByValue } from "../shared/catalog.js";
import { CATEGORY_PARAM, parseCategories } from "../shared/filter.js";
import { caseStudyPage } from "./render/case-study.js";
import { homePage } from "./render/home.js";
import { notFoundPage } from "./render/not-found.js";

/** The pages of the site map: `/`, `/work/<slug>` for the six projects, and the not-found page for anything else. */

interface RenderedPage {
  readonly status: number;
  readonly html: string;
}

export function renderPage(pathname: string, query: URLSearchParams): RenderedPage {
  if (pathname === "/") {
    const categories = parseCategories(query.get(CATEGORY_PARAM));
    const service = serviceByValue(query.get(SERVICE_PARAM));
    const introDone = query.has(CATEGORY_PARAM) || query.has(SERVICE_PARAM);
    return { status: 200, html: homePage({ categories, service, introDone }) };
  }
  const slug = /^\/work\/([^/]+)$/.exec(pathname)?.[1];
  const project = slug === undefined ? undefined : projectBySlug(slug);
  if (project !== undefined) {
    return { status: 200, html: caseStudyPage(project, parseCategories(query.get(CATEGORY_PARAM))) };
  }
  return { status: 404, html: notFoundPage() };
}
