import { useId } from "react";
import type { DesignObject } from "../../shared/types";
import { partsOf, type Part } from "./flatten";
import { HOLE_GREY, mixHex } from "./palette";

const GRID_MM = 20;
const MIN_SPAN_MM = 120;
/** The grid reaches past any viewBox, so it fills the drawing at every aspect ratio. */
const GRID_REACH_MM = 5000;

interface TopViewProps {
  objects: DesignObject[];
  className?: string;
}

function outline(part: Part): { points: [number, number][] | null; rx: number; ry: number } {
  if (part.kind !== "box") return { points: null, rx: part.w / 2, ry: part.d / 2 };
  const turn = (part.rotationZ * Math.PI) / 180;
  const cos = Math.cos(turn), sin = Math.sin(turn);
  const points = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]): [number, number] => {
    const lx = (sx * part.w) / 2, ly = (sy * part.d) / 2;
    return [part.x + lx * cos - ly * sin, part.y + lx * sin + ly * cos];
  });
  return { points, rx: 0, ry: 0 };
}

function extent(part: Part): { min: [number, number]; max: [number, number] } {
  const { points, rx, ry } = outline(part);
  if (!points) return { min: [part.x - rx, part.y - ry], max: [part.x + rx, part.y + ry] };
  return {
    min: [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
    max: [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
  };
}

/**
 * A flat top-view drawing of design objects on a millimetre grid, x to the right and y up. It stands in for the 3D
 * view of an editor when WebGL is missing. Decorative: aria-hidden.
 */
export function TopView({ objects, className }: TopViewProps) {
  const id = useId().replace(/:/g, "");
  const parts = partsOf(objects);
  const solids = parts.filter((p) => !p.hole).sort((a, b) => a.z - b.z);
  const holes = parts.filter((p) => p.hole);
  const spans = parts.map(extent);
  const minX = Math.min(0, ...spans.map((s) => s.min[0])), maxX = Math.max(0, ...spans.map((s) => s.max[0]));
  const minY = Math.min(0, ...spans.map((s) => s.min[1])), maxY = Math.max(0, ...spans.map((s) => s.max[1]));
  const span = Math.max(MIN_SPAN_MM, maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const half = span * 0.55;
  const stripes = `${id}-stripes`;
  const shapes = [...solids, ...holes].map((part, i) => {
    const { points, rx, ry } = outline(part);
    const fill = part.hole ? `url(#${stripes})` : part.color;
    const stroke = part.hole ? HOLE_GREY : mixHex(part.color, "#000000", 0.4);
    const common = { fill, stroke, strokeWidth: 0.8, strokeDasharray: part.hole ? "3 2" : undefined };
    if (points) return <polygon key={i} points={points.map((p) => p.join(",")).join(" ")} {...common} />;
    return <ellipse key={i} cx={part.x} cy={part.y} rx={rx} ry={ry} transform={`rotate(${part.rotationZ} ${part.x} ${part.y})`} {...common} />;
  });
  return (
    <svg className={className} viewBox={`${cx - half} ${-cy - half} ${2 * half} ${2 * half}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${id}-grid`} width={GRID_MM} height={GRID_MM} patternUnits="userSpaceOnUse">
          <path d={`M${GRID_MM} 0H0V${GRID_MM}`} fill="none" stroke="var(--edge)" strokeWidth="0.5" />
        </pattern>
        <pattern id={stripes} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={HOLE_GREY} fillOpacity="0.28" />
          <rect width="3" height="6" fill={HOLE_GREY} fillOpacity="0.55" />
        </pattern>
      </defs>
      <g transform="scale(1,-1)">
        <rect x={cx - GRID_REACH_MM} y={cy - GRID_REACH_MM} width={2 * GRID_REACH_MM} height={2 * GRID_REACH_MM} fill={`url(#${id}-grid)`} />
        <path d={`M-5 0H5M0 -5V5`} stroke="var(--slate)" strokeWidth="0.8" />
        {shapes}
      </g>
    </svg>
  );
}
