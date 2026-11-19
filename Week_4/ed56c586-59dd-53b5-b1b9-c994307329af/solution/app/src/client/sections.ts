import { CASE_STUDY_SECTIONS, NAV_SECTIONS } from "../shared/catalog.js";
import { currentSectionId } from "../shared/scroll-lines.js";
import { all } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** The current section: the last section whose top edge is at or above the 40% line. On a case study the same rule
 * marks the `On this page` link; no header link is current there. */

function markCurrent(links: readonly HTMLAnchorElement[], currentId: string | undefined, idOf: (link: HTMLAnchorElement) => string | undefined): void {
  for (const link of links) {
    if (idOf(link) !== undefined && idOf(link) === currentId) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

function topOf(id: string): number {
  return document.getElementById(id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
}

export function initHomeSections(): void {
  const links = all<HTMLAnchorElement>(document, ".primary-nav a, .menu-panel nav a");
  onViewportChange(() => {
    const tops = NAV_SECTIONS.map((section) => ({ id: section.id, top: topOf(section.id) }));
    markCurrent(links, currentSectionId(tops, window.innerHeight), (link) => link.dataset["sectionLink"]);
  });
}

export function initCaseStudySections(): void {
  const links = all<HTMLAnchorElement>(document, "[data-toc-link]");
  onViewportChange(() => {
    const tops = CASE_STUDY_SECTIONS.map((section) => ({ id: section.id, top: topOf(section.id) }));
    markCurrent(links, currentSectionId(tops, window.innerHeight), (link) => link.dataset["tocLink"]);
  });
}
