import { pushAddress } from "./address.js";
import { isPrimaryClick, prefersReducedMotion } from "./dom.js";
import { applyViewportRules } from "./viewport.js";

/** Section jumps: the target heading ends 80 px from the viewport top with focus on it. A jump by link glides on the
 * browser's own smooth scroll and adds one history entry; a jump on load, from history, or with reduced motion is instant. */

const JUMP_TOP_PX = 80;

export function headingOf(id: string): HTMLElement | null {
  return id === "intro" ? document.getElementById("page-title") : document.getElementById(`${id}-title`);
}

let gliding = false;
window.addEventListener("scrollend", () => {
  gliding = false;
});

let disarmStaleGlideUndo: (() => void) | undefined;

/** An instant scroll that interrupts a glide is followed by one stale step of that glide; the first such step is undone. */
function undoStaleGlideStep(position: number): void {
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const disarm = (): void => {
    window.removeEventListener("scroll", undo);
    for (const name of inputs) window.removeEventListener(name, disarm);
  };
  const undo = (): void => {
    if (window.scrollY === position) return;
    disarm();
    window.scrollTo({ top: position, behavior: "instant" });
    applyViewportRules();
  };
  window.addEventListener("scroll", undo);
  for (const name of inputs) window.addEventListener(name, disarm, { passive: true });
  disarmStaleGlideUndo = disarm;
}

function scrollTop(top: number, smooth: boolean): void {
  disarmStaleGlideUndo?.();
  disarmStaleGlideUndo = undefined;
  if (smooth && !prefersReducedMotion()) {
    gliding = true;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    return;
  }
  const interrupted = gliding;
  gliding = false;
  window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  if (interrupted) undoStaleGlideStep(window.scrollY);
  applyViewportRules();
}

/** Scrolls so the section's heading sits at the jump position; no focus change. */
export function placeHeading(id: string, smooth: boolean): boolean {
  const heading = headingOf(id);
  if (heading === null) return false;
  scrollTop(heading.getBoundingClientRect().top + window.scrollY - JUMP_TOP_PX, smooth);
  return true;
}

export function jumpTo(id: string, smooth: boolean): boolean {
  if (!placeHeading(id, smooth)) return false;
  headingOf(id)?.focus({ preventScroll: true });
  return true;
}

/** The top of the page with focus on the level-1 heading. */
export function jumpToTop(smooth: boolean): void {
  scrollTop(0, smooth);
  headingOf("intro")?.focus({ preventScroll: true });
}

function sectionIdOf(link: HTMLAnchorElement): string | undefined {
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.hash === "") return undefined;
  const samePage = url.pathname === window.location.pathname;
  return samePage && headingOf(url.hash.slice(1)) !== null ? url.hash.slice(1) : undefined;
}

export function initJumps(): void {
  document.addEventListener("click", (event) => {
    if (!isPrimaryClick(event) || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (link === null || link.hasAttribute("data-enquire") || link.hasAttribute("data-skip-link")) return;
    if (link.hasAttribute("data-home-link") && window.location.pathname === "/") {
      event.preventDefault();
      goToTop();
      return;
    }
    const id = sectionIdOf(link);
    if (id === undefined) return;
    event.preventDefault();
    pushAddress(() => undefined, `#${id}`);
    jumpTo(id, true);
  });
  document.querySelector("[data-back-to-top]")?.addEventListener("click", goToTop);
  document.querySelector("[data-skip-link]")?.addEventListener("click", (event) => {
    event.preventDefault();
    headingOf("intro")?.focus();
  });
  window.addEventListener("popstate", restoreEntry);
}

function goToTop(): void {
  pushAddress(() => undefined, "");
  jumpToTop(true);
}

/** Back and Forward: the entry's target at the jump position, instantly, or the top of the page without a hash. */
function restoreEntry(): void {
  const id = window.location.hash.slice(1);
  if (id !== "" && jumpTo(id, false)) return;
  jumpToTop(false);
}
