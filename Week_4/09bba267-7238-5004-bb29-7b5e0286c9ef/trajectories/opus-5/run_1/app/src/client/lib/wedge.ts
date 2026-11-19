import { useEffect, useRef, useState } from 'react';

const EDGE_DRAW_MS = 167;
const GLIDE_MS = 167;
const COUNT_MS = 250;

export interface WedgeTarget {
  readonly seatId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly distance: number;
}

export interface WedgeView {
  readonly apexX: number;
  readonly apexY: number;
  /** How much of each edge is drawn, and how far the fill has faded in, from 0 to 1. */
  readonly leftDrawn: number;
  readonly rightDrawn: number;
  readonly fillShown: number;
  readonly shownAngle: number;
  readonly shownDistance: number;
}

function settled(target: WedgeTarget): WedgeView {
  return {
    apexX: target.x,
    apexY: target.y,
    leftDrawn: 1,
    rightDrawn: 1,
    fillShown: 1,
    shownAngle: target.angle,
    shownDistance: target.distance,
  };
}

function easeOut(fraction: number): number {
  return 1 - (1 - fraction) ** 2;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Draws the wedge in (left edge, then right edge, then fill), glides the apex when another seat
 * takes over, and counts the readout numerals. With reduced motion every value lands in one frame.
 */
export function useWedgeView(target: WedgeTarget | null, reducedMotion: boolean): WedgeView | null {
  const [view, setView] = useState<WedgeView | null>(null);
  const latest = useRef<WedgeView | null>(null);
  latest.current = view;
  const shownSeatId = useRef<string | null>(null);

  useEffect(() => {
    if (target === null) {
      shownSeatId.current = null;
      setView(null);
      return;
    }
    if (shownSeatId.current === target.seatId) return;
    const from = latest.current;
    shownSeatId.current = target.seatId;
    if (reducedMotion) {
      setView(settled(target));
      return;
    }
    const countFrom = { angle: from?.shownAngle ?? 0, distance: from?.shownDistance ?? 0 };
    let frame = 0;
    let start: number | null = null;
    const step = (now: number): void => {
      if (start === null) start = now;
      const elapsed = now - start;
      const countFraction = Math.min(1, elapsed / COUNT_MS);
      const shownAngle = Math.round(countFrom.angle + (target.angle - countFrom.angle) * easeOut(countFraction));
      const shownDistance = roundTo(
        countFrom.distance + (target.distance - countFrom.distance) * easeOut(countFraction),
        1,
      );
      const drawing = from === null;
      const motion = drawing
        ? {
            apexX: target.x,
            apexY: target.y,
            leftDrawn: easeOut(Math.min(1, elapsed / EDGE_DRAW_MS)),
            rightDrawn: easeOut(Math.max(0, Math.min(1, (elapsed - EDGE_DRAW_MS) / EDGE_DRAW_MS))),
            fillShown: easeOut(Math.max(0, Math.min(1, (elapsed - 2 * EDGE_DRAW_MS) / EDGE_DRAW_MS))),
          }
        : {
            apexX: from.apexX + (target.x - from.apexX) * easeOut(Math.min(1, elapsed / GLIDE_MS)),
            apexY: from.apexY + (target.y - from.apexY) * easeOut(Math.min(1, elapsed / GLIDE_MS)),
            leftDrawn: 1,
            rightDrawn: 1,
            fillShown: 1,
          };
      const done = elapsed >= (drawing ? 3 * EDGE_DRAW_MS : GLIDE_MS) && countFraction === 1;
      setView(done ? settled(target) : { ...motion, shownAngle, shownDistance });
      if (!done) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reducedMotion]);

  return view;
}
