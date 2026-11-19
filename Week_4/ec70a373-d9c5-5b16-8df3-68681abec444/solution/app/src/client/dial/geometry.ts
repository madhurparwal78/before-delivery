// Dial geometry: a 24-hour ring of site-local wall time, 0° at 00:00 at the top, 0.25° per minute clockwise.
import { wallDegrees } from "../../shared/time.ts";

export const VIEW = 276;
export const CENTRE = VIEW / 2;
export const RING_INNER = 80;
export const RING_OUTER = 104;
/** Hour labels sit outside the ring, past the ticks. */
export const LABEL_RADIUS = 126;
const RING_MID = (RING_INNER + RING_OUTER) / 2;
export const RING_WIDTH = RING_OUTER - RING_INNER;

export function point(radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [CENTRE + radius * Math.sin(radians), CENTRE - radius * Math.cos(radians)];
}

function fmt(n: number): string {
  return n.toFixed(3);
}

/** A filled ring segment between two wall times. */
export function annulus(startMinutes: number, endMinutes: number, inner = RING_INNER, outer = RING_OUTER): string {
  const a0 = wallDegrees(startMinutes);
  const a1 = wallDegrees(endMinutes);
  if (a1 - a0 >= 360) {
    return [
      `M ${fmt(CENTRE)} ${fmt(CENTRE - outer)}`,
      `A ${outer} ${outer} 0 1 1 ${fmt(CENTRE)} ${fmt(CENTRE + outer)}`,
      `A ${outer} ${outer} 0 1 1 ${fmt(CENTRE)} ${fmt(CENTRE - outer)}`,
      `M ${fmt(CENTRE)} ${fmt(CENTRE - inner)}`,
      `A ${inner} ${inner} 0 1 0 ${fmt(CENTRE)} ${fmt(CENTRE + inner)}`,
      `A ${inner} ${inner} 0 1 0 ${fmt(CENTRE)} ${fmt(CENTRE - inner)}`,
      "Z",
    ].join(" ");
  }
  const large = a1 - a0 > 180 ? 1 : 0;
  const [ox0, oy0] = point(outer, a0);
  const [ox1, oy1] = point(outer, a1);
  const [ix1, iy1] = point(inner, a1);
  const [ix0, iy0] = point(inner, a0);
  return [
    `M ${fmt(ox0)} ${fmt(oy0)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${fmt(ox1)} ${fmt(oy1)}`,
    `L ${fmt(ix1)} ${fmt(iy1)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${fmt(ix0)} ${fmt(iy0)}`,
    "Z",
  ].join(" ");
}

/** The centre line of the ring between two wall times, for stroked arcs that retract. */
export function centreArc(startMinutes: number, endMinutes: number): string {
  const a0 = wallDegrees(startMinutes);
  const a1 = Math.min(wallDegrees(endMinutes), a0 + 359.99);
  if (a1 <= a0) {
    const [x, y] = point(RING_MID, a0);
    return `M ${fmt(x)} ${fmt(y)}`;
  }
  const [x0, y0] = point(RING_MID, a0);
  const [x1, y1] = point(RING_MID, a1);
  return `M ${fmt(x0)} ${fmt(y0)} A ${RING_MID} ${RING_MID} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${fmt(x1)} ${fmt(y1)}`;
}

export function arcLength(startMinutes: number, endMinutes: number): number {
  return ((wallDegrees(endMinutes) - wallDegrees(startMinutes)) * Math.PI * RING_MID) / 180;
}

/** Wall minutes under a point of the dial box, or null when the point lies outside the given radii. */
export function minutesAt(box: DOMRect, x: number, y: number, minRadius: number, maxRadius: number): number | null {
  const scale = box.width / VIEW;
  const dx = (x - box.left) / scale - CENTRE;
  const dy = (y - box.top) / scale - CENTRE;
  const radius = Math.hypot(dx, dy);
  if (radius < minRadius || radius > maxRadius || radius === 0) return null;
  const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return degrees * 4;
}
