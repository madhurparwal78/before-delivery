import type { Point } from '../../shared/engine';
import type { FloodState, Model } from './model';

const FLOOD_MS = 420;
const THUMB_GAP_MS = 30;
const COUNT_MS = 320;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

export interface FloodStart {
  index: number;
  oldColor: string;
  newColor: string;
  cursor: Point;
  seq: number;
  fromCount: number;
}

/**
 * Index Flood: rings grow from the editing cursor over 420 ms, then the thumbnails change left to right
 * 30 ms apart, then the swatch's count rolls up over 320 ms. Under reduced motion all of it lands at once.
 */
export function startFlood(m: Model, start: FloodStart, reduced: boolean): void {
  const finalCount = m.counts.pixels[start.index] ?? 0;
  const settle = (): void => {
    m.flood = null;
    m.shownUsed.delete(start.index);
    for (const frame of m.frames) m.thumbSeq.set(frame.id, start.seq);
    m.touchDocument();
    m.changed();
  };
  if (reduced) return settle();
  const maxRadius = Math.max(start.cursor[0], m.width - 1 - start.cursor[0], start.cursor[1], m.height - 1 - start.cursor[1]);
  const flood: FloodState = { ...start, maxRadius, radius: 0, rings: true, thumbsDone: 0 };
  m.flood = flood;
  m.shownUsed.set(start.index, start.fromCount);
  const begin = performance.now();
  const thumbsEnd = FLOOD_MS + THUMB_GAP_MS * Math.min(m.frames.length, 40);
  const tick = (): void => {
    if (m.flood !== flood) return;
    const elapsed = performance.now() - begin;
    const radius = elapsed < FLOOD_MS ? Math.round(maxRadius * easeOut(elapsed / FLOOD_MS)) : maxRadius;
    let panels = false;
    if (elapsed >= FLOOD_MS && flood.rings) {
      flood.rings = false;
      panels = true;
    }
    const thumbsDone = elapsed < FLOOD_MS ? 0 : Math.min(m.frames.length, Math.floor((elapsed - FLOOD_MS) / THUMB_GAP_MS) + 1);
    if (thumbsDone !== flood.thumbsDone) {
      flood.thumbsDone = thumbsDone;
      m.frames.slice(0, thumbsDone).forEach((frame) => m.thumbSeq.set(frame.id, start.seq));
      panels = true;
    }
    if (elapsed >= thumbsEnd) {
      const rolled = Math.min(1, (elapsed - thumbsEnd) / COUNT_MS);
      if (rolled >= 1) return settle();
      m.shownUsed.set(start.index, Math.round(start.fromCount + (finalCount - start.fromCount) * easeOut(rolled)));
      panels = true;
    }
    if (radius !== flood.radius) {
      flood.radius = radius;
      m.touchDocument([m.frameId]);
      m.redrawStage();
    }
    if (panels) m.changed();
    requestAnimationFrame(tick);
  };
  m.touchDocument();
  m.changed();
  requestAnimationFrame(tick);
}
