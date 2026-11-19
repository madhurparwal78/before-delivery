import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../../shared/layout.ts';

/** The margin kept either side of a stage that has to shrink; a stage with room for all 1280 has none. */
const GUTTER = 8;

/**
 * The desktop stage: 1280 by 800 in its own coordinates, drawn 1:1 when there is room and scaled down as a unit to the
 * width it is given, so the page never scrolls sideways.
 */
export function Stage({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, gutter: 0 });

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const gutter = width >= STAGE_WIDTH ? 0 : GUTTER;
      setFit({ scale: Math.min(1, (width - 2 * gutter) / STAGE_WIDTH), gutter });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="stage-frame" ref={frame} style={{ height: STAGE_HEIGHT * fit.scale, paddingInline: fit.gutter }}>
      <div className="stage" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${fit.scale})` }}>
        {children}
      </div>
    </div>
  );
}
