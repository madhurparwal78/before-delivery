// Loading state: three grey strokes draw in on a charcoal panel and repeat only while the request is pending.
import { useEffect, useRef } from 'react';
import { reducedMotion } from './motion.ts';

const STROKES = ['M16 22 H224', 'M16 48 H132 V74 H224', 'M16 74 H88'];
const STROKE_MS = 700;

export function LoadingStrokes() {
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const node = svg.current;
    if (!node || reducedMotion()) return;
    let active = true;
    let running: Animation[] = [];
    const run = (): void => {
      running = [...node.querySelectorAll('path')].map((path, index) =>
        path.animate({ strokeDashoffset: [1, 0] }, { duration: STROKE_MS, delay: index * 120, easing: 'ease-out', fill: 'both', iterations: 1 }),
      );
      const last = running[running.length - 1];
      if (last) last.onfinish = () => { if (active) run(); };
    };
    run();
    return () => {
      active = false;
      for (const animation of running) animation.cancel();
    };
  }, []);

  return (
    <div className="loading-panel" aria-busy="true">
      <svg ref={svg} viewBox="0 0 240 96" aria-hidden="true">
        {STROKES.map((d) => <path key={d} d={d} pathLength={1} className="loading-stroke" />)}
      </svg>
    </div>
  );
}
