import { useEffect, useState } from 'react';

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** The layout chosen for a window width, decided in one place. */
export function layoutFor(width: number): LayoutMode {
  if (width <= 767) return 'phone';
  if (width <= 1099) return 'tablet';
  return 'desktop';
}

export function useLayout(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const onResize = (): void => setMode(layoutFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mode;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
