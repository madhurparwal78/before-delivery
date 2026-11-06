/** Dial geometry in a 1000-unit square viewBox: midnight at the top, time running clockwise. */
export const SIZE = 1000;
export const CENTRE = 500;
const RING_OUTER = 428;
export const RING_INNER = 178;
const RING_GAP = 6;
export const COUNTDOWN_RADIUS = 446;
export const LABEL_RADIUS = 474;

export interface Ring { outer: number; inner: number; mid: number; band: number }

export function ring(index: number, count: number): Ring {
  const band = (RING_OUTER - RING_INNER) / Math.max(1, count);
  const outer = RING_OUTER - index * band;
  const inner = outer - band + RING_GAP;
  return { outer, inner, mid: (outer + inner) / 2, band: outer - inner };
}

export const angleOf = (minute: number, dayMinutes: number): number => (minute / dayMinutes) * 2 * Math.PI;

export function point(radius: number, angle: number): [number, number] {
  return [CENTRE + radius * Math.sin(angle), CENTRE - radius * Math.cos(angle)];
}

const fmt = (value: number): string => value.toFixed(2);

/** An annular sector from angle a0 to a1 (clockwise); a full turn becomes a ring. */
export function sector(outer: number, inner: number, a0: number, a1: number): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    return `M ${CENTRE} ${CENTRE - outer} A ${outer} ${outer} 0 1 1 ${CENTRE} ${CENTRE + outer} A ${outer} ${outer} 0 1 1 ${CENTRE} ${CENTRE - outer} Z `
      + `M ${CENTRE} ${CENTRE - inner} A ${inner} ${inner} 0 1 0 ${CENTRE} ${CENTRE + inner} A ${inner} ${inner} 0 1 0 ${CENTRE} ${CENTRE - inner} Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [ox0, oy0] = point(outer, a0);
  const [ox1, oy1] = point(outer, a1);
  const [ix1, iy1] = point(inner, a1);
  const [ix0, iy0] = point(inner, a0);
  return `M ${fmt(ox0)} ${fmt(oy0)} A ${outer} ${outer} 0 ${large} 1 ${fmt(ox1)} ${fmt(oy1)} L ${fmt(ix1)} ${fmt(iy1)} A ${inner} ${inner} 0 ${large} 0 ${fmt(ix0)} ${fmt(iy0)} Z`;
}

/** An open arc; `reverse` runs it anticlockwise so text along the lower half reads upright. */
export function arc(radius: number, a0: number, a1: number, reverse = false): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    return `M ${CENTRE} ${CENTRE - radius} A ${radius} ${radius} 0 1 1 ${CENTRE} ${CENTRE + radius} A ${radius} ${radius} 0 1 1 ${CENTRE} ${CENTRE - radius}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = point(radius, reverse ? a1 : a0);
  const [x1, y1] = point(radius, reverse ? a0 : a1);
  return `M ${fmt(x0)} ${fmt(y0)} A ${radius} ${radius} 0 ${large} ${reverse ? 0 : 1} ${fmt(x1)} ${fmt(y1)}`;
}

/** The minute of the day under a pointer, from the dial's on-screen box. */
export function minuteAt(box: DOMRect, clientX: number, clientY: number, dayMinutes: number): number {
  const dx = clientX - (box.left + box.width / 2);
  const dy = clientY - (box.top + box.height / 2);
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += 2 * Math.PI;
  return (angle / (2 * Math.PI)) * dayMinutes;
}
