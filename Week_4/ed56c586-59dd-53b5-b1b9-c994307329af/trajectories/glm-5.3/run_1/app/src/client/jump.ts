/**
 * Section jumps: every jump lands its heading 80 px from the viewport top with
 * focus on it, adds one history entry with the target hash, and glides unless
 * the page is loaded with reduced motion. A jump on load or under reduced
 * motion is instant, and a second jump started during a glide wins.
 */
import { JUMP_OFFSET } from "../shared/domain.js";
import { prefersReducedMotion } from "./core.js";

let glideUntil = 0;

/** The heading of a section: `<id>-heading`, or the element itself when it is a heading. */
export function headingOf(id: string): HTMLElement | null {
  const direct = document.getElementById(id);
  if (direct && (direct.tagName === "H1" || direct.tagName === "H2")) return direct;
  const heading = document.getElementById(`${id}-heading`);
  if (heading) return heading;
  const section = document.getElementById(id);
  if (section) {
    const inner = section.querySelector<HTMLElement>("h2[id], h1[id]");
    if (inner) return inner;
  }
  return direct;
}

export function focusHeading(id: string): HTMLElement | null {
  const heading = headingOf(id);
  if (!heading) return null;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
  return heading;
}

/** Positions the page so the heading's top edge is exactly 80 px from the top. */
export function placeHeading(id: string): void {
  const heading = headingOf(id);
  if (!heading) return;
  const top = heading.getBoundingClientRect().top + window.scrollY - JUMP_OFFSET;
  window.scrollTo({ top, behavior: "auto" });
}

export type JumpOptions = {
  /** add a history entry carrying the target hash */
  history: boolean;
};

/**
 * A section jump. The glide uses the browser's own smooth scroll towards the
 * same target; a second jump during the glide simply re-places the page at
 * its own target, so the newest jump wins. The landing is settled once the
 * glide window ends, so the heading ends exactly 80 px from the top.
 */
export function jumpToSection(id: string, options: JumpOptions): void {
  if (options.history) {
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.pushState({}, "", url);
  }
  const reduced = prefersReducedMotion();
  const startTop = window.scrollY;
  placeHeading(id);
  const target = window.scrollY;
  focusHeading(id);
  if (!reduced && Math.abs(target - startTop) > 40) {
    window.scrollTo({ top: startTop, behavior: "auto" });
    window.scrollTo({ top: target, behavior: "smooth" });
    glideUntil = performance.now() + 900;
    window.setTimeout(() => {
      placeHeading(id);
      focusHeading(id);
    }, 950);
  }
}

/** True while a jump's glide is still settling. */
export function gliding(): boolean {
  return performance.now() < glideUntil;
}

/** Instant jump used for hash loads, popstate restores and reduced motion. */
export function instantToHeading(id: string): void {
  glideUntil = 0;
  placeHeading(id);
  focusHeading(id);
}

/** Moves the page so a focused element sits clear of the fixed header. */
export function ensureFocusClear(element: Element): void {
  if (gliding()) return;
  const rect = element.getBoundingClientRect();
  const minimumTop = 72;
  if (rect.top < minimumTop) {
    window.scrollBy({ top: rect.top - minimumTop, behavior: "auto" });
    return;
  }
  if (rect.bottom > window.innerHeight && rect.height <= window.innerHeight - 72) {
    window.scrollBy({ top: rect.bottom - window.innerHeight, behavior: "auto" });
  }
}
