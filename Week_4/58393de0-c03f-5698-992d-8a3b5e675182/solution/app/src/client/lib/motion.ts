export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A linear opacity fade on one element. Under reduced motion nothing animates and null comes back. */
export function fadeElement(element: HTMLElement, direction: "in" | "out", ms: number): Animation | null {
  if (prefersReducedMotion() || ms <= 0) return null;
  return element.animate(
    { opacity: direction === "in" ? [0, 1] : [1, 0] },
    { duration: ms, easing: "linear", fill: direction === "in" ? "backwards" : "forwards" },
  );
}
