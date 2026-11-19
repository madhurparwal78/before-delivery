import { reducedMotion } from "../lib/router";
import type { Motion } from "./controller";

const TITLE_MS = 150;
const CHILD_MS = 150;
const CHILD_STAGGER_MS = 40;
const STAGGER_ROWS = 12;
const INDENT = 24;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
/** Children fade over their whole 150ms so each one visibly lands after the one above. */
const FADE_EASE = "ease-out";

/** When the last staggered child of a zoom has settled; the view is refreshed from the server only after it. */
export const ZOOM_SETTLE_MS = CHILD_MS + (STAGGER_ROWS - 1) * CHILD_STAGGER_MS;

function lift(element: Element, from: DOMRect, ratio: number): void {
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  (element as HTMLElement).animate(
    [{ transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${ratio})` }, { transformOrigin: "top left", transform: "none" }],
    { duration: TITLE_MS, easing: EASE },
  );
}

/** The branch focus zoom: the title arrives, the children slide in one after another, the crumb settles. */
export function playMotion(motion: Motion, root: HTMLElement): void {
  if (reducedMotion()) return;
  if (motion.kind === "in") {
    const title = root.querySelector("[data-title]");
    if (title !== null && motion.fromRect !== null) {
      const ratio = Math.min(1, 15 / Math.max(15, parseFloat(getComputedStyle(title).fontSize)));
      lift(title, motion.fromRect, ratio);
    }
    root.querySelectorAll<HTMLElement>("[data-top-row]").forEach((row, index) => {
      const timing = { duration: CHILD_MS, delay: Math.min(index, STAGGER_ROWS - 1) * CHILD_STAGGER_MS, fill: "backwards" as const };
      row.animate([{ left: `${INDENT}px` }, { left: "0px" }], { ...timing, easing: EASE });
      row.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, easing: FADE_EASE });
    });
    root.querySelector<HTMLElement>("[data-crumb-last]")?.animate(
      [{ opacity: 0, transform: "translateX(16px)" }, { opacity: 1, transform: "none" }],
      { duration: CHILD_MS, easing: EASE },
    );
    return;
  }
  const target = motion.from === null ? null : root.querySelector(`[role="treeitem"][data-bullet-id="${CSS.escape(motion.from)}"] .cell`);
  if (target !== null && motion.fromRect !== null) lift(target, motion.fromRect, 32 / 15);
  const tree = root.querySelector<HTMLElement>("[data-tree]");
  tree?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TITLE_MS, easing: EASE });
  root.querySelectorAll<HTMLElement>("[data-top-row]").forEach((row, index) => {
    row.animate(
      [{ transform: `translateX(${INDENT}px)` }, { transform: "none" }],
      { duration: CHILD_MS, delay: Math.min(index, STAGGER_ROWS - 1) * CHILD_STAGGER_MS, easing: EASE },
    );
  });
}
