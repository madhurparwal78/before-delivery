// Line drawings drawn in code: each fitting's side elevation (the viewer's still fallback, card thumbnails before or
// without WebGL, empty states) and the room plan used when WebGL is unavailable.
import { useId } from "react";
import { poolRadiusMm } from "../../shared/lightpool";
import type { Placement } from "../../shared/types";
import { FINISH_COLOURS, lightColour, type FittingKind } from "../lib/format";

/** useId() values carry characters that do not survive inside `url(#…)`; keep letters, digits and hyphens. */
function useSvgId(): string {
  return `d${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
}

interface DrawingProps {
  kind: FittingKind;
  finish: string;
  beam: number;
  cct: number;
  label?: string;
  className?: string;
}

/** Body outline of each fitting in a 200 × 200 box; the light leaves from y = `lensY`. */
const BODIES: Record<FittingKind, { path: string; lensY: number; extra?: string }> = {
  recessed: { path: "M64 40 H136 V48 H124 L118 78 H82 L76 48 H64 Z", lensY: 78, extra: "M30 40 H170" },
  track: {
    path: "M78 24 H122 V34 H78 Z M96 34 H104 V48 H96 Z M82 48 H118 L114 92 H86 Z",
    lensY: 92,
    extra: "M24 24 H176",
  },
  pendant: { path: "M99 8 H101 V40 H99 Z M92 40 H108 V48 H92 Z M100 48 C70 52 56 70 54 84 H146 C144 70 130 52 100 48 Z", lensY: 84, extra: "M70 8 H130" },
  cylinder: { path: "M80 22 H120 V94 H80 Z", lensY: 94, extra: "M40 22 H160" },
  gimbal: { path: "M66 40 H134 V46 H66 Z M80 46 H120 L116 72 H84 Z", lensY: 72, extra: "M30 40 H170" },
};

export function FittingDrawing({ kind, finish, beam, cct, label, className }: DrawingProps) {
  const gradient = useSvgId();
  const body = BODIES[kind];
  // The drawing's cone uses the one light-pool formula, with the drawing's drop as the ceiling height.
  const spread = poolRadiusMm(196 - body.lensY, beam);
  const light = lightColour(cct);
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} stopOpacity="0.85" />
          <stop offset="1" stopColor={light} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path d={`M${100 - 14} ${body.lensY} L${100 - 14 - spread} 196 H${100 + 14 + spread} L${100 + 14} ${body.lensY} Z`} fill={`url(#${gradient})`} />
      <ellipse cx="100" cy="196" rx={14 + spread} ry="4" fill={light} opacity="0.55" />
      {body.extra && <path d={body.extra} stroke="currentColor" strokeWidth="1" opacity="0.6" />}
      <path d={body.path} fill={FINISH_COLOURS[finish] ?? "#888"} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

interface PlanProps {
  widthMm: number;
  depthMm: number;
  ceilingMm: number;
  placements: Placement[];
  label?: string;
}

/** Top-down plan: a ceiling grid and each pool drawn as a tinted circle at its size and position. */
export function RoomPlan({ widthMm, depthMm, ceilingMm, placements, label }: PlanProps) {
  const id = useSvgId();
  const lines: number[] = [];
  for (let x = 500; x < widthMm; x += 500) lines.push(x);
  const rows: number[] = [];
  for (let y = 500; y < depthMm; y += 500) rows.push(y);
  return (
    <svg
      viewBox={`0 0 ${widthMm} ${depthMm}`}
      preserveAspectRatio="none"
      className="room-plan"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      <defs>
        {[2700, 3000, 4000].map((cct) => (
          <radialGradient key={cct} id={`${id}-${cct}`}>
            <stop offset="0" stopColor={lightColour(cct)} stopOpacity="0.9" />
            <stop offset="0.7" stopColor={lightColour(cct)} stopOpacity="0.45" />
            <stop offset="1" stopColor={lightColour(cct)} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      <rect width={widthMm} height={depthMm} className="room-plan__floor" />
      {lines.map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={depthMm} className="room-plan__grid" />
      ))}
      {rows.map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={widthMm} y2={y} className="room-plan__grid" />
      ))}
      {placements.map((p) => (
        <circle
          key={p.id}
          cx={p.x_mm}
          cy={p.y_mm}
          r={poolRadiusMm(ceilingMm, p.beam_deg)}
          fill={`url(#${id}-${p.cct_k})`}
          className="room-plan__pool"
        />
      ))}
    </svg>
  );
}

/** The empty-state drawing: a downlight and its pool of light. */
export function EmptyDrawing() {
  return <FittingDrawing kind="recessed" finish="BK" beam={36} cct={2700} className="empty-state__drawing" />;
}
