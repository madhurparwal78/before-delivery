/** The home page's signature reveal: a cover recedes left to right over the cockpit still in step with the scroll position. */
import { prefersReducedMotion } from "./dom";

/** How far the cover has receded, in whole thousandths: 0 covered, 1000 uncovered. */
const FULL = 1000;

/**
 * Starts when the still's top enters the bottom of the window and finishes when that top reaches the window's middle.
 * Read from scrollY on every frame, so an instant jump lands on the right picture one frame later.
 */
function revealProgress(stillTop: number, windowHeight: number): number {
  const travelled = windowHeight - stillTop;
  const span = windowHeight / 2;
  return Math.max(0, Math.min(FULL, Math.floor((travelled * FULL) / span)));
}

export function initScrollReveal(): void {
  const still = document.querySelector<HTMLElement>("[data-reveal]");
  const cover = document.querySelector<HTMLElement>("[data-reveal-cover]");
  if (!still || !cover || prefersReducedMotion()) return;

  let stillPageTop = 0;
  const measure = (): void => {
    stillPageTop = still.getBoundingClientRect().top + window.scrollY;
  };
  measure();
  new ResizeObserver(measure).observe(document.documentElement);

  let drawn = -1;
  const draw = (): void => {
    const progress = revealProgress(stillPageTop - window.scrollY, window.innerHeight);
    if (progress !== drawn) {
      drawn = progress;
      cover.style.transform = `scaleX(${(FULL - progress) / FULL})`;
    }
    requestAnimationFrame(draw);
  };
  draw();
}
