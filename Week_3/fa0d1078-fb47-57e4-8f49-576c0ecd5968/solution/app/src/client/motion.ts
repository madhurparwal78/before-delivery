/** True when the player asked the system for reduced motion: no animation runs anywhere. */
export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
