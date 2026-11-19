import { layoutTop, reducedMotion } from "./dom.js";

const HEADING_TOP = 96;
const JUMP_MS = 220;

let cancelJump: (() => void) | null = null;

function easeOut(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * Scrolls so the heading sits clear of the fixed header, then focuses it. Smooth jumps follow the page clock
 * (requestAnimationFrame timestamps); reduced motion and page loads jump at once.
 */
export function jumpTo(heading: HTMLElement, instant: boolean, done?: () => void): void {
  cancelJump?.();
  const limit = document.documentElement.scrollHeight - innerHeight;
  const target = Math.max(0, Math.min(limit, layoutTop(heading) - HEADING_TOP));
  const arrive = (): void => {
    cancelJump = null;
    heading.focus({ preventScroll: true });
    done?.();
  };
  if (instant || reducedMotion()) {
    scrollTo(0, target);
    arrive();
    return;
  }
  const from = scrollY;
  let started: number | null = null;
  let frame = 0;
  const stop = (): void => {
    cancelAnimationFrame(frame);
    removeEventListener("wheel", stop);
    removeEventListener("touchstart", stop);
    cancelJump = null;
  };
  const step = (now: number): void => {
    started ??= now;
    const progress = Math.min(1, (now - started) / JUMP_MS);
    scrollTo(0, from + (target - from) * easeOut(progress));
    if (progress < 1) {
      frame = requestAnimationFrame(step);
      return;
    }
    removeEventListener("wheel", stop);
    removeEventListener("touchstart", stop);
    arrive();
  };
  addEventListener("wheel", stop, { passive: true, once: true });
  addEventListener("touchstart", stop, { passive: true, once: true });
  cancelJump = stop;
  frame = requestAnimationFrame(step);
}

const CLEAR_TOP = 72;

/** Keeps every focused control outside the header and menu below the header's edge, and inside the view. */
export function keepFocusClear(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".site-header, dialog, .skip-link")) return;
    if (target.matches("h1, h2, [tabindex='-1']") || !target.matches(":focus-visible")) return;
    const box = (target instanceof HTMLInputElement && target.type === "radio" ? target.closest("label") ?? target : target).getBoundingClientRect();
    if (box.top < CLEAR_TOP) scrollBy(0, box.top - HEADING_TOP);
    else if (box.bottom > innerHeight + 1 && box.height <= innerHeight - CLEAR_TOP) scrollBy(0, box.bottom - innerHeight + 24);
  });
}
