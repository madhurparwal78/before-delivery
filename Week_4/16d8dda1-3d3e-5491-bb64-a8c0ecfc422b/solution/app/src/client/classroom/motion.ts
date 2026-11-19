import { useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';
const PHONE = '(max-width: 599px)';
const TABLET = '(max-width: 1023px)';

export const prefersReducedMotion = (): boolean => window.matchMedia(REDUCED).matches;

function watch(query: string): (listener: () => void) => () => void {
  return (listener) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(watch(REDUCED), prefersReducedMotion);
}

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

const currentMode = (): LayoutMode => (window.matchMedia(PHONE).matches ? 'phone' : window.matchMedia(TABLET).matches ? 'tablet' : 'desktop');

function subscribeMode(listener: () => void): () => void {
  const stops = [watch(PHONE)(listener), watch(TABLET)(listener)];
  return () => stops.forEach((stop) => stop());
}

/** The room and its panels are laid out for phone (< 600), tablet (< 1024) or desktop. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribeMode, currentMode);
}

/**
 * Runs `onFrame(progress)` from 0 to 1 over `duration` ms on requestAnimationFrame and performance.now(), so it
 * moves with the page clock a test steps. Returns a cancel function.
 */
export function tween(duration: number, onFrame: (progress: number) => void, onDone: () => void): () => void {
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const progress = Math.min(1, (performance.now() - start) / duration);
    onFrame(progress);
    if (progress < 1) frame = requestAnimationFrame(step);
    else onDone();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
