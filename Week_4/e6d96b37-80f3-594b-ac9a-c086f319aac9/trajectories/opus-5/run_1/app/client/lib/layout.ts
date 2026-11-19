import { useEffect, useState } from 'react';

/**
 * The three published layouts. The phone layout applies below 768 CSS pixels,
 * the tablet layout from 768 to 1279, and the desktop layout at 1280 and wider.
 * No other breakpoint changes which layout a viewport gets.
 */

export type Layout = 'phone' | 'tablet' | 'desktop';

export function layoutFor(width: number): Layout {
  if (width >= 1280) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'phone';
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  useEffect(() => {
    const measure = (): void => setLayout(layoutFor(window.innerWidth));
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  return layout;
}

/** Under reduced motion every fade becomes an instant change. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
