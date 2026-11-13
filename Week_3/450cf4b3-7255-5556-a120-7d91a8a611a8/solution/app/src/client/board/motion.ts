// Motion tokens (DESIGN.md): quick start, soft settle, no bounce, nothing over half a second.

export const MOTION = {
  press: 200,
  mid: 250,
  slow: 330,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
