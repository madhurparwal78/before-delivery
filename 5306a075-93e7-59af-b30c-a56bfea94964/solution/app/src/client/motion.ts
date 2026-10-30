// Motion tokens (brief: Motion and effects) for element.animate(); CSS reads the same values from tokens.css.
export const QUICK = 167;
export const MEDIUM = 280;
export const SLOW = 420;
export const SETTLE = "cubic-bezier(0.2, 0, 0, 1)";

export const prefersReducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isWide = (): boolean => matchMedia("(min-width: 900px)").matches;

/** Counts a numeral's text from `from` to `to` while a medium-tempo animation plays; lands on `to` when it ends. */
export function countTo(element: HTMLElement, from: number, to: number): Promise<void> {
  if (from === to || prefersReducedMotion()) {
    element.textContent = String(to);
    return Promise.resolve();
  }
  const animation = element.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: MEDIUM, easing: SETTLE });
  const tick = (): void => {
    const progress = Math.min(1, (animation.currentTime === null ? 0 : Number(animation.currentTime)) / MEDIUM);
    element.textContent = String(Math.round(from + (to - from) * progress));
    if (animation.playState === "running") requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return animation.finished.then(() => { element.textContent = String(to); }, () => { element.textContent = String(to); });
}
