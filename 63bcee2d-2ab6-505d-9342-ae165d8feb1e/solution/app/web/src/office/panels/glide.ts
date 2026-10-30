import { useEffect, useState } from "react";

// Motion tokens read from the stylesheet, so element.animate() uses the one easing and the token
// durations, which reduced motion sets to zero.

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A duration token in milliseconds (0 under reduced motion). */
export function duration(name: "--t-quick" | "--t-mid" | "--t-slow"): number {
  const value = token(name);
  return value.endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000 || 0;
}

export const easing = (): string => token("--ease");

/** Runs an element animation with a token duration, or nothing when that duration is zero. */
export function animate(element: Element | null, keyframes: Keyframe[], name: "--t-quick" | "--t-mid" | "--t-slow"): void {
  const ms = duration(name);
  if (element && ms > 0) element.animate(keyframes, { duration: ms, easing: easing() });
}

/** Whether the operating system asks for reduced motion, kept current. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const change = (): void => setReduced(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return reduced;
}
