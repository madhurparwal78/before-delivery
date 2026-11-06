import { useEffect, useState } from 'react';
import { THREAD_MS, QUICK_MS } from '../motion';

export interface Point {
  x: number;
  y: number;
}

/** The signature motion: a cobalt S-curve from the quote to the feature row. */
export function EvidenceThread({
  from,
  to,
  featureName,
  fading,
}: {
  from: Point;
  to: Point;
  featureName: string;
  fading: boolean;
}): JSX.Element {
  const [length, setLength] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setLength(1));
    return () => cancelAnimationFrame(frame);
  }, []);

  const midX = (from.x + to.x) / 2;
  const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  const span = Math.hypot(to.x - from.x, to.y - from.y) * 1.6 + 40;

  return (
    <svg
      className="evidence-thread"
      role="img"
      aria-label={`Evidence thread to ${featureName}`}
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={path}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        style={{
          strokeDasharray: span,
          strokeDashoffset: (1 - length) * span,
          opacity: fading ? 0 : 1,
          transition: `stroke-dashoffset ${THREAD_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${QUICK_MS}ms linear`,
        }}
      />
    </svg>
  );
}

/** The thread that follows the pointer while dragging a quote onto the rail. */
export function DragThread({ from, to }: { from: Point; to: Point }): JSX.Element {
  const midX = (from.x + to.x) / 2;
  return (
    <svg className="evidence-thread" aria-hidden="true" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <path
        d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
