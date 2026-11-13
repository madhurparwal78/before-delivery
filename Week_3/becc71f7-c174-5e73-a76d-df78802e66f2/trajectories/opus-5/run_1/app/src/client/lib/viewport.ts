import { useEffect, useState } from 'preact/hooks';

export type Width = 'narrow' | 'medium' | 'wide';

/**
 * The rail is three columns beside a filters column from 1100 pixels wide, two columns
 * with a side sheet from 768, and one column with a bottom sheet below that.
 */
const WIDE = '(min-width: 1100px)';
const MEDIUM = '(min-width: 768px)';

function measure(): Width {
  if (typeof window === 'undefined') return 'wide';
  if (window.matchMedia(WIDE).matches) return 'wide';
  return window.matchMedia(MEDIUM).matches ? 'medium' : 'narrow';
}

export function useWidth(): Width {
  const [width, setWidth] = useState<Width>(measure);
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const medium = window.matchMedia(MEDIUM);
    const update = (): void => setWidth(measure());
    wide.addEventListener('change', update);
    medium.addEventListener('change', update);
    update();
    return () => {
      wide.removeEventListener('change', update);
      medium.removeEventListener('change', update);
    };
  }, []);
  return width;
}
