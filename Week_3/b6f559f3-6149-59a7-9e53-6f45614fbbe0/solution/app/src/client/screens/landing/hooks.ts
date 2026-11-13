import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

const subscribeReduced = (listener: () => void): (() => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};

/** Whether the device asks for reduced motion. */
export const useReducedMotion = (): boolean => useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);

/** True once the element has entered the viewport (it stays true). */
export function useEntered<T extends Element>(threshold = 0.15): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || entered) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setEntered(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [entered, threshold]);
  return [ref, entered];
}

/** True while the element is on screen. */
export function useOnScreen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}

/** Progress 0..1 over `durationMs` once `active`; at once under reduced motion. */
export function useCountUp(active: boolean, durationMs = 600): number {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setProgress(1);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const t = Math.min((now - start) / durationMs, 1);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, durationMs, reduced]);
  return progress;
}

/** The text of a readout with each number scaled by `progress`, ending exactly on the final text. */
export function countText(final: string, progress: number): string {
  if (progress >= 1) return final;
  return final.replace(/-?\d+(?:\.\d+)?/g, (token) => {
    const decimals = token.includes('.') ? (token.split('.')[1] as string).length : 0;
    return (Number(token) * progress).toFixed(decimals);
  });
}
