// An SVG of strokes that draw themselves with element.animate(): once on mount, or once the first time it scrolls into view.
// Under reduced motion no animation object is created and every stroke and grip is drawn from the first paint.
import { useLayoutEffect, useRef } from 'react';
import { DRAW_MS, STAGGER_MS, drawPath, popGrip, reducedMotion } from '../ui/motion.ts';
import type { Stroke } from './geometry.ts';

interface DrawnLinesProps {
  strokes: readonly Stroke[];
  /** `mount` draws at once, `visible` waits for the first scroll into view, `static` never animates. */
  mode: 'mount' | 'visible' | 'static';
  viewBox: string;
  preserveAspectRatio?: string;
  className?: string;
}

const GRIP = 8;

export function DrawnLines({ strokes, mode, viewBox, preserveAspectRatio, className }: DrawnLinesProps) {
  const svg = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const node = svg.current;
    if (!node || mode === 'static' || reducedMotion()) return;
    const play = (): void => {
      node.removeAttribute('data-draw');
      node.querySelectorAll('g.stroke').forEach((group, index) => {
        const path = group.querySelector('path');
        const grip = group.querySelector('rect');
        if (path) drawPath(path, index);
        if (grip) popGrip(grip, index * STAGGER_MS + DRAW_MS);
      });
    };
    if (mode === 'mount') {
      play();
      return;
    }
    node.setAttribute('data-draw', 'pending');
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      play();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode]);

  return (
    <svg ref={svg} className={className} viewBox={viewBox} preserveAspectRatio={preserveAspectRatio} aria-hidden="true" focusable="false">
      {strokes.map((stroke, index) => (
        <g key={index} className="stroke">
          <path d={stroke.d} pathLength={1} className={mode === 'static' ? 'wire' : 'wire draw'} />
          {stroke.grip ? <rect x={stroke.grip[0] - GRIP / 2} y={stroke.grip[1] - GRIP / 2} width={GRIP} height={GRIP} className="grip" /> : null}
        </g>
      ))}
    </svg>
  );
}
