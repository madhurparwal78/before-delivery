import { useEffect, useState } from 'react';

export type Viewport = 'phone' | 'tablet' | 'desktop';

/** The phone layout applies below 700px, the tablet layout to 1199px, then desktop. */
function viewportOf(width: number): Viewport {
  if (width < 700) return 'phone';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === 'undefined' ? 'desktop' : viewportOf(window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setViewport(viewportOf(window.innerWidth));
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}
