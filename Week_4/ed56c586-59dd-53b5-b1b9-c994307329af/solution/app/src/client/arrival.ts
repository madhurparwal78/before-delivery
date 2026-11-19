import { type PageKind } from "../shared/page-kind.js";
import { must } from "./dom.js";
import { endIntro } from "./intro.js";
import { jumpTo, jumpToTop, placeHeading } from "./jumps.js";
import { applyViewportRules } from "./viewport.js";

/** How a page is entered. Arriving by a link, or by Back or Forward, starts at the top with focus on the level-1 heading;
 * a hash lands on its section; returning from a case study lands on that project's card link. Opening an address
 * directly leaves focus alone, so the first Tab stop is `Skip to content`.
 *
 * A history entry is marked when a link leaves it (`left`, plus the project it opened as `from`), so the next load of
 * that entry is known to be a Back or Forward and not a reload. */

interface EntryMarks {
  readonly left: boolean;
  readonly from: string | undefined;
}

function marksOfEntry(): EntryMarks {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return { left: false, from: undefined };
  return {
    left: "left" in state && state.left === true,
    from: "from" in state && typeof state.from === "string" ? state.from : undefined,
  };
}

function writeMarks(marks: EntryMarks): void {
  window.history.replaceState({ left: marks.left, from: marks.from }, "");
}

/** Marks the current entry whenever a link to another page is followed. */
export function rememberDepartures(): void {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || event.defaultPrevented) return;
    const link = event.target.closest("a[href]");
    if (link === null || link.getAttribute("target") === "_blank") return;
    const url = new URL(link.getAttribute("href") ?? "", window.location.href);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
    writeMarks({ left: true, from: /^\/work\/([^/]+)$/.exec(url.pathname)?.[1] });
  });
}

function arrivedByLink(marks: EntryMarks): boolean {
  return marks.left || document.referrer.startsWith(window.location.origin);
}

/** The slug of the project just read, when this load is a return to the gallery. */
function projectJustRead(marks: EntryMarks): string | undefined {
  if (marks.left && marks.from !== undefined) return marks.from;
  const read = /\/work\/([^/?#]+)/.exec(document.referrer)?.[1];
  return read !== undefined && window.location.hash === "#work" ? read : undefined;
}

function returnToCard(slug: string): boolean {
  const link = document.querySelector<HTMLAnchorElement>(`[data-project="${slug}"]:not([hidden]) [data-card-link]`);
  if (link === null) return false;
  link.scrollIntoView({ block: "center", behavior: "instant" });
  link.focus({ preventScroll: true });
  applyViewportRules();
  return true;
}

export function initArrival(page: PageKind): void {
  window.history.scrollRestoration = "manual";
  const marks = marksOfEntry();
  writeMarks({ left: false, from: undefined });
  const slug = page === "home" ? projectJustRead(marks) : undefined;
  let moved = false;
  for (const name of ["wheel", "touchstart", "keydown", "pointerdown"]) window.addEventListener(name, () => (moved = true), { once: true, passive: true });

  if (slug !== undefined && returnToCard(slug)) endIntro(must<HTMLElement>(document, "#intro"));
  else if (window.location.hash !== "" && jumpTo(window.location.hash.slice(1), false)) applyViewportRules();
  else if (arrivedByLink(marks) && document.activeElement === document.body) jumpToTop(false);

  const replace = (): void => {
    if (moved) return;
    if (slug !== undefined) returnToCard(slug);
    else if (window.location.hash !== "") placeHeading(window.location.hash.slice(1), false);
  };
  window.addEventListener("load", replace);
  void document.fonts.ready.then(replace);
}
