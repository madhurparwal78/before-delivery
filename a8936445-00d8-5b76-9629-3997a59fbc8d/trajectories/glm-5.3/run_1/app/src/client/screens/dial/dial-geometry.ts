/** Dial geometry: the kitchen day as a clockwise ring from twelve o'clock. */

export const CX = 300;
export const CY = 300;
export const RING_INNER = 245;
export const RING_OUTER = 282;
export const RING_MID = (RING_INNER + RING_OUTER) / 2;
export const HANDLE_R = 15;

/** Minute of day → degrees clockwise from twelve o'clock. */
export function minuteToAngle(minute: number): number {
  return (minute / 1440) * 360;
}

/** Degrees clockwise from top → SVG point at the given radius. */
export function angleToPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) };
}

/** SVG point → minute of day (0..1440) clockwise from the top. */
export function pointToMinute(x: number, y: number): number {
  const dx = x - CX;
  const dy = y - CY;
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return (angle / 360) * 1440;
}

/** A closed annular sector path for block arcs on the ring. */
export function ringSector(fromMinute: number, toMinute: number): string {
  const a1 = angleToPoint(minuteToAngle(fromMinute), RING_INNER);
  const a2 = angleToPoint(minuteToAngle(toMinute), RING_INNER);
  const b2 = angleToPoint(minuteToAngle(toMinute), RING_OUTER);
  const b1 = angleToPoint(minuteToAngle(fromMinute), RING_OUTER);
  const large = toMinute - fromMinute > 720 ? 1 : 0;
  return [
    `M ${a1.x.toFixed(2)} ${a1.y.toFixed(2)}`,
    `A ${RING_INNER} ${RING_INNER} 0 ${large} 1 ${a2.x.toFixed(2)} ${a2.y.toFixed(2)}`,
    `L ${b2.x.toFixed(2)} ${b2.y.toFixed(2)}`,
    `A ${RING_OUTER} ${RING_OUTER} 0 ${large} 0 ${b1.x.toFixed(2)} ${b1.y.toFixed(2)}`,
    "Z"
  ].join(" ");
}

/** SVG point in client coordinates → SVG viewBox coordinates. */
export function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const scale = 600 / rect.width;
  return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
}

export const snapStep = (minute: number): number => Math.round(minute / 15) * 15;

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
