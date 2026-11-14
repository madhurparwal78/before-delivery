/** True when the person's system asks for reduced motion. Read at the moment of use, so a change applies at once. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
