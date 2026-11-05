import { animate } from 'motion';
import { useEffect, useState } from 'react';

/** The three published speeds, in seconds, as the Motion library takes them. */
export const SPEED = {
  quick: 0.2,
  medium: 0.42,
  long: 0.7,
} as const;

export const EASE_OUT = [0.16, 0.84, 0.28, 1] as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export type Band = 'narrow' | 'medium' | 'wide';

export function bandOf(width: number): Band {
  if (width <= 639) return 'narrow';
  if (width <= 1023) return 'medium';
  return 'wide';
}

export function useBand(): Band {
  const [band, setBand] = useState<Band>(() => bandOf(typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    const update = (): void => setBand(bandOf(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return band;
}

/** Animates a number, or jumps to its end when reduced motion is requested. */
export function animateValue(
  from: number,
  to: number,
  duration: number,
  onUpdate: (value: number) => void,
): () => void {
  if (prefersReducedMotion() || from === to) {
    onUpdate(to);
    return () => undefined;
  }
  const controls = animate(from, to, {
    duration,
    ease: [...EASE_OUT],
    onUpdate,
    onComplete: () => onUpdate(to),
  });
  return () => controls.stop();
}

export function animateElement(
  element: Element,
  keyframes: Record<string, unknown>,
  options: Record<string, unknown>,
): void {
  if (prefersReducedMotion()) {
    const final: Record<string, string> = {};
    for (const [name, value] of Object.entries(keyframes)) {
      const last = Array.isArray(value) ? value[value.length - 1] : value;
      final[name] = String(last);
    }
    Object.assign((element as HTMLElement).style, final);
    return;
  }
  void animate(element, keyframes, options);
}
