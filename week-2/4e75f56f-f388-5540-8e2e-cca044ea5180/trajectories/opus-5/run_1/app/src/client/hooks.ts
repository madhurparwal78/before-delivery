import { useEffect, useState } from 'react';

export type Viewport = 'phone' | 'tablet' | 'desktop';

export function useViewport(): Viewport {
  const read = (): Viewport => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.innerWidth < 768) return 'phone';
    return window.innerWidth < 1280 ? 'tablet' : 'desktop';
  };
  const [viewport, setViewport] = useState<Viewport>(read);
  useEffect(() => {
    const onResize = (): void => setViewport(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function hasWebGl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
  } catch {
    return false;
  }
}
