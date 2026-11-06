/**
 * Still side-view line drawings, shown in place of the 3D model when WebGL is
 * unavailable. Drawn from the same shapes as the turned models.
 */

import { FINISH_APPEARANCE, cctColour, type FittingShape } from "./fittings.js";
import type { FinishCode } from "../../shared/types.js";

const hex = (value: number): string => `#${value.toString(16).padStart(6, "0")}`;

export function FittingDrawing({
  shape,
  finish,
  beamDeg,
  cctK,
  label,
  className,
}: {
  shape: FittingShape;
  finish: FinishCode;
  beamDeg: number;
  cctK: number;
  label: string;
  className?: string;
}) {
  const body = hex(Number(FINISH_APPEARANCE[finish].colour));
  const light = hex(cctColour(cctK));

  // The cone's half-width follows the beam angle, as the lit model does.
  const coneHeight = 150;
  const halfWidth = coneHeight * Math.tan((beamDeg / 2) * (Math.PI / 180));
  const emitterY = 96;

  return (
    <svg
      className={className}
      role="img"
      aria-label={label}
      viewBox="0 0 320 240"
      data-beam={beamDeg}
      data-cct={cctK}
      data-idle="off"
    >
      <rect width="320" height="240" fill="none" />
      <g stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5">
        <line x1="20" y1={emitterY} x2="300" y2={emitterY} strokeDasharray="3 5" />
      </g>

      <polygon
        points={`160,${emitterY} ${160 - halfWidth},${emitterY + coneHeight} ${160 + halfWidth},${emitterY + coneHeight}`}
        fill={light}
        opacity="0.22"
      />
      <ellipse cx="160" cy={emitterY + coneHeight} rx={halfWidth} ry={Math.max(4, halfWidth * 0.14)} fill={light} opacity="0.4" />

      <g fill={body} stroke="currentColor" strokeWidth="1.2">
        {shape === "downlight" && (
          <>
            <rect x="126" y="40" width="68" height="52" />
            <polygon points="126,92 194,92 206,96 114,96" />
            <rect x="114" y="92" width="92" height="5" />
          </>
        )}
        {shape === "gimbal" && (
          <>
            <rect x="130" y="38" width="60" height="46" />
            <path d="M126 92 a34 34 0 0 1 68 0 z" />
            <rect x="118" y="90" width="84" height="5" />
          </>
        )}
        {shape === "track-spot" && (
          <>
            <rect x="60" y="26" width="200" height="12" />
            <rect x="150" y="38" width="20" height="12" />
            <rect x="157" y="50" width="6" height="16" />
            <circle cx="160" cy="70" r="7" />
            <polygon points="140,96 180,96 176,76 144,76" />
          </>
        )}
        {shape === "pendant" && (
          <>
            <rect x="158" y="18" width="4" height="46" />
            <rect x="148" y="14" width="24" height="6" />
            <path d="M118 96 C124 72 140 62 160 62 C180 62 196 72 202 96 z" />
          </>
        )}
        {shape === "surface" && (
          <>
            <rect x="124" y="30" width="72" height="6" />
            <rect x="130" y="36" width="60" height="58" />
            <rect x="128" y="92" width="64" height="5" />
          </>
        )}
      </g>
    </svg>
  );
}

export interface PlanPool {
  id: string;
  code: string;
  xMm: number;
  yMm: number;
  diameterMm: number;
  cctK: number;
}

/**
 * The top-down room plan shown in place of the 3D room, with each pool drawn as a
 * tinted circle at its size and position.
 */
export function RoomPlan({
  widthMm,
  depthMm,
  pools,
  className,
}: {
  widthMm: number;
  depthMm: number;
  pools: readonly PlanPool[];
  className?: string;
}) {
  const pad = 16;
  const scale = Math.min((640 - pad * 2) / widthMm, (480 - pad * 2) / depthMm);
  const width = widthMm * scale + pad * 2;
  const height = depthMm * scale + pad * 2;

  return (
    <svg className={className} role="img" aria-label="Room plan" viewBox={`0 0 ${width} ${height}`}>
      <rect
        x={pad}
        y={pad}
        width={widthMm * scale}
        height={depthMm * scale}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.6"
      />
      {pools.map((pool) => (
        <g key={pool.id}>
          <circle
            cx={pad + pool.xMm * scale}
            cy={pad + pool.yMm * scale}
            r={(pool.diameterMm / 2) * scale}
            fill={hex(cctColour(pool.cctK))}
            opacity="0.4"
          />
          <circle cx={pad + pool.xMm * scale} cy={pad + pool.yMm * scale} r="3" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}
