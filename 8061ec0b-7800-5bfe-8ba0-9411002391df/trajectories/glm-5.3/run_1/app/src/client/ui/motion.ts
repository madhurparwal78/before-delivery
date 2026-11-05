// Motion vocabulary: the three published speeds, all through the Motion
// library, and everything instant under reduced motion (DP-52, DP-72).
import { animate } from "motion";

export const SPEEDS = {
  quick: { duration: 0.2 },
  medium: { duration: 0.42 },
  long: { duration: 0.7 },
} as const;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface KeyframePair {
  from: { transform?: string; opacity?: string };
  to: { transform?: string; opacity?: string };
}

export function animateValue(
  el: HTMLElement,
  pair: KeyframePair,
  speed: keyof typeof SPEEDS
): void {
  if (prefersReducedMotion()) {
    if (pair.to.transform !== undefined) el.style.transform = pair.to.transform;
    if (pair.to.opacity !== undefined) el.style.opacity = pair.to.opacity;
    return;
  }
  const keyframes: Record<string, string[]> = {};
  if (pair.from.transform !== undefined && pair.to.transform !== undefined) {
    keyframes.transform = [pair.from.transform, pair.to.transform];
  }
  if (pair.from.opacity !== undefined && pair.to.opacity !== undefined) {
    keyframes.opacity = [pair.from.opacity, pair.to.opacity];
  }
  void animate(el, keyframes, { ...SPEEDS[speed], ease: "easeOut" });
}

export interface SpringOptions {
  from: number;
  to: number;
  onUpdate(value: number): void;
  onComplete?(): void;
}

// The handle's measured spring: it passes the notch by 2 to 8 pixels and
// comes to rest between 600 and 800 milliseconds after the step.
export function springTo({ from, to, onUpdate, onComplete }: SpringOptions): void {
  if (prefersReducedMotion()) {
    onUpdate(to);
    onComplete?.();
    return;
  }
  const start = performance.now();
  const duration = 700;
  const overshootPx = 4;
  const distance = to - from;
  let last = -1;
  const frame = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    // Under-damped settle onto the notch.
    const envelope = 1 - Math.pow(1 - t, 3);
    const wobble = Math.sin(t * Math.PI * 2.2) * (1 - t) * overshootPx * Math.sign(distance || 1);
    const value = from + distance * envelope + wobble;
    if (value !== last) onUpdate(value);
    last = value;
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onUpdate(to);
      onComplete?.();
    }
  };
  requestAnimationFrame(frame);
}

export function animateNumber(
  el: HTMLElement,
  from: number,
  to: number,
  format: (value: number) => string,
  speed: "quick" | "medium" = "medium"
): void {
  if (prefersReducedMotion() || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const duration = SPEEDS[speed === "quick" ? "quick" : "medium"].duration * 1000;
  const frame = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 2);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
