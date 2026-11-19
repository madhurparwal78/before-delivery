import { must, prefersReducedMotion } from "./dom.js";

/** The custom cursor: it follows the mouse with no lag, shows the state of what is under it, and hides on touch, pen,
 * leaving the window and reduced motion. It never catches clicks. */

type CursorState = "default" | "link" | "view" | "drag";

const LABELS: Readonly<Record<CursorState, string>> = { default: "", link: "", view: "View", drag: "Drag" };

function stateOf(target: EventTarget | null): CursorState {
  if (!(target instanceof Element)) return "default";
  if (target.closest("[data-project]") !== null) return "view";
  if (target.closest("[data-review-track]") !== null) return "drag";
  return target.closest("a, button, [role='tab']") === null ? "default" : "link";
}

export function initCursor(): void {
  const cursor = must<HTMLElement>(document, "[data-cursor]");
  const label = must<HTMLElement>(cursor, "[data-cursor-label]");
  const hide = (): void => {
    cursor.dataset["visible"] = "false";
  };
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || prefersReducedMotion()) {
      hide();
      return;
    }
    cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    const state = stateOf(event.target);
    cursor.dataset["cursorState"] = state;
    label.textContent = LABELS[state];
    cursor.dataset["visible"] = "true";
  });
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") hide();
  });
  document.documentElement.addEventListener("pointerleave", hide);
}
