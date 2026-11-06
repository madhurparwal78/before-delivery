// The charge ribbon: the yacht's battery across the passage, 0% at the bottom to 100% at the top, with a point
// at each arrival, a dashed brick line at the 20% reserve and a hatched reserve zone beneath it.
import { RESERVE_PCT } from "../../shared/energy";

const RIBBON_HEIGHT = 140;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

export interface RibbonPoint {
  x: number;
  pct: number;
}

export function ribbonY(pct: number): number {
  return PAD_TOP + (1 - pct / 100) * (RIBBON_HEIGHT - PAD_TOP - PAD_BOTTOM);
}

/** A smooth line through the points with level tangents, so the ribbon reads as one continuous charge curve. */
export function ribbonPath(points: RibbonPoint[]): string {
  if (!points.length) return "";
  let d = `M ${points[0].x} ${ribbonY(points[0].pct)}`;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const mid = (a.x + b.x) / 2;
    d += ` C ${mid} ${ribbonY(a.pct)} ${mid} ${ribbonY(b.pct)} ${b.x} ${ribbonY(b.pct)}`;
  }
  return d;
}

export function areaPath(points: RibbonPoint[]): string {
  if (points.length < 2) return "";
  const base = RIBBON_HEIGHT - PAD_BOTTOM;
  return `${ribbonPath(points)} L ${points[points.length - 1].x} ${base} L ${points[0].x} ${base} Z`;
}

export function Ribbon({ points, width, minCharge, fluid }: { points: RibbonPoint[]; width: number; minCharge: number | null; fluid?: boolean }) {
  const reserveY = ribbonY(RESERVE_PCT);
  const base = RIBBON_HEIGHT - PAD_BOTTOM;
  return (
    <svg
      class="ribbon"
      role="img"
      aria-label="Charge ribbon"
      data-min-charge={minCharge === null ? "" : String(minCharge)}
      viewBox={`0 0 ${width} ${RIBBON_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: fluid ? "100%" : `${width}px` }}
    >
      <defs>
        <pattern id="reserve-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" class="ribbon__hatch-line" />
        </pattern>
      </defs>
      {[25, 50, 75, 100].map((pct) => (
        <line key={pct} x1="0" x2={width} y1={ribbonY(pct)} y2={ribbonY(pct)} class="ribbon__grid" vector-effect="non-scaling-stroke" />
      ))}
      <rect x="0" y={reserveY} width={width} height={base - reserveY} fill="url(#reserve-hatch)" class="ribbon__zone" />
      <line x1="0" x2={width} y1={reserveY} y2={reserveY} class="ribbon__reserve" vector-effect="non-scaling-stroke" />
      <line x1="0" x2={width} y1={base} y2={base} class="ribbon__base" vector-effect="non-scaling-stroke" />
      <path class="ribbon__area" d={areaPath(points)} />
      <path class="ribbon__line" d={ribbonPath(points)} vector-effect="non-scaling-stroke" />
      {points.map((p, i) => (
        <path
          key={i}
          class={`ribbon__point${i === 0 ? " ribbon__point--start" : ""}`}
          data-point={i}
          d={`M ${p.x} ${ribbonY(p.pct)} h 0`}
          vector-effect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
