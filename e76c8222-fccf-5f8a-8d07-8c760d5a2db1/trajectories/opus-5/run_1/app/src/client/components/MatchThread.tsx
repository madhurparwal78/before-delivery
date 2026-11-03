import { ReactElement } from 'react';
interface Point {
  x: number;
  y: number;
}

/** A gently curved line from the chip's edge to the pointer, redrawn on every frame. */
export function MatchThread({
  from,
  to,
  phase,
  straight,
}: {
  from: Point;
  to: Point;
  phase: 'held' | 'pinning' | 'recoiling';
  straight: boolean;
}): ReactElement {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const bend = straight ? 0 : Math.min(60, Math.abs(to.x - from.x) / 3 + 12);
  const path = straight
    ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
    : `M ${from.x} ${from.y} Q ${midX} ${midY + bend} ${to.x} ${to.y}`;
  return (
    <svg className={`thread ${phase}`} role="img" aria-label="Match thread">
      <path d={path} />
    </svg>
  );
}
