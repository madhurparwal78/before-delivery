import { useId, type ReactElement } from "react";
import { CircuitStill } from "./CircuitStill";
import { objectsOf, partsOf, type Part } from "./flatten";
import { HOLE_GREY, mixHex } from "./palette";
import type { SnapshotStillProps } from "./types";

/** Isometric view from the +x,+y,+z corner: elevation 35.264 degrees, so every axis shortens equally. */
const RIGHT = Math.SQRT1_2;
const DEPTH = 0.40825;
const RISE = 0.8165;
const ELLIPSE = 0.57735;
const DEG = Math.PI / 180;

type Point = [number, number];

function project(x: number, y: number, z: number): Point {
  return [(x - y) * RIGHT, (x + y) * DEPTH - z * RISE];
}

/** Nearer parts have larger depth; the painter draws far ones first. */
function depthOf(part: Part): number {
  return part.x + part.y + part.z;
}

function polygon(points: Point[]): string {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

interface Painted {
  elements: ReactElement[];
  min: Point;
  max: Point;
}

function boxCorners(part: Part): { bottom: Point[]; top: Point[]; ground: [number, number][] } {
  const cos = Math.cos(part.rotationZ * DEG), sin = Math.sin(part.rotationZ * DEG);
  const ground = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]): [number, number] => {
    const lx = (sx * part.w) / 2, ly = (sy * part.d) / 2;
    return [part.x + lx * cos - ly * sin, part.y + lx * sin + ly * cos];
  });
  return {
    ground,
    bottom: ground.map(([x, y]) => project(x, y, part.z - part.h / 2)),
    top: ground.map(([x, y]) => project(x, y, part.z + part.h / 2)),
  };
}

function paintBox(part: Part, key: string, fills: { top: string; side: (shade: number) => string }, stroke: string): Painted {
  const { ground, bottom, top } = boxCorners(part);
  const elements: ReactElement[] = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const a = ground[i] ?? [0, 0], b = ground[next] ?? [0, 0];
    const normal: Point = [b[1] - a[1], a[0] - b[0]];
    const length = Math.hypot(normal[0], normal[1]) || 1;
    const nx = normal[0] / length, ny = normal[1] / length;
    if (nx + ny <= 1e-6) continue;
    const lit = 0.5 + 0.5 * (-0.5 * nx + 0.866 * ny);
    elements.push(
      <polygon key={`${key}-side${i}`} points={polygon([bottom[i] ?? [0, 0], bottom[next] ?? [0, 0], top[next] ?? [0, 0], top[i] ?? [0, 0]])} fill={fills.side(lit)} stroke={stroke} strokeWidth="0.6" strokeLinejoin="round" />,
    );
  }
  elements.push(<polygon key={`${key}-top`} points={polygon(top)} fill={fills.top} stroke={stroke} strokeWidth="0.6" strokeLinejoin="round" />);
  const all = [...bottom, ...top];
  return {
    elements,
    min: [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))],
    max: [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))],
  };
}

function paintCylinder(part: Part, key: string, fills: { top: string; body: string }, stroke: string): Painted {
  const r = (part.w + part.d) / 4;
  const [sx, topY] = project(part.x, part.y, part.z + part.h / 2);
  const [, bottomY] = project(part.x, part.y, part.z - part.h / 2);
  const ry = r * ELLIPSE;
  const body = `M${sx - r} ${topY} V${bottomY} A${r} ${ry} 0 0 0 ${sx + r} ${bottomY} V${topY}Z`;
  return {
    elements: [
      <path key={`${key}-body`} d={body} fill={fills.body} stroke={stroke} strokeWidth="0.6" strokeLinejoin="round" />,
      <ellipse key={`${key}-top`} cx={sx} cy={topY} rx={r} ry={ry} fill={fills.top} stroke={stroke} strokeWidth="0.6" />,
    ],
    min: [sx - r, topY - ry],
    max: [sx + r, bottomY + ry],
  };
}

function paintSphere(part: Part, key: string, fill: string, stroke: string): Painted {
  const r = (part.w + part.d + part.h) / 6;
  const [sx, sy] = project(part.x, part.y, part.z);
  return {
    elements: [<circle key={key} cx={sx} cy={sy} r={r} fill={fill} stroke={stroke} strokeWidth="0.6" />],
    min: [sx - r, sy - r],
    max: [sx + r, sy + r],
  };
}

/** An empty design: a dashed ground tile to stand on. */
function GroundTile({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -40 120 80" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden="true" focusable="false">
      <polygon points="0,-24 42,0 0,24 -42,0" fill="none" stroke="var(--slate)" strokeWidth="1.5" strokeDasharray="5 4" strokeLinejoin="round" />
    </svg>
  );
}

function ModelStill({ parts, className }: { parts: Part[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  if (parts.length === 0) return <GroundTile className={className} />;
  const solids = parts.filter((p) => !p.hole).sort((a, b) => depthOf(a) - depthOf(b));
  const holes = parts.filter((p) => p.hole).sort((a, b) => depthOf(a) - depthOf(b));
  const paints: Painted[] = [];
  const defs: ReactElement[] = [];
  solids.forEach((part, i) => {
    const key = `${id}-s${i}`;
    const base = part.color;
    const light = mixHex(base, "#ffffff", 0.28);
    const dark = mixHex(base, "#000000", 0.3);
    const outline = mixHex(base, "#000000", 0.45);
    if (part.kind === "box") {
      paints.push(paintBox(part, key, { top: light, side: (lit) => mixHex(base, "#000000", 0.32 - 0.3 * lit) }, outline));
    } else if (part.kind === "cylinder") {
      defs.push(
        <linearGradient key={`${key}-g`} id={`${key}-g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={light} /><stop offset="0.45" stopColor={base} /><stop offset="1" stopColor={dark} />
        </linearGradient>,
      );
      paints.push(paintCylinder(part, key, { top: light, body: `url(#${key}-g)` }, outline));
    } else {
      defs.push(
        <radialGradient key={`${key}-g`} id={`${key}-g`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor={mixHex(base, "#ffffff", 0.45)} /><stop offset="0.5" stopColor={base} /><stop offset="1" stopColor={dark} />
        </radialGradient>,
      );
      paints.push(paintSphere(part, key, `url(#${key}-g)`, outline));
    }
  });
  const stripes = `${id}-stripes`;
  holes.forEach((part, i) => {
    const key = `${id}-h${i}`;
    const fill = `url(#${stripes})`;
    if (part.kind === "box") paints.push(paintBox(part, key, { top: fill, side: () => fill }, HOLE_GREY));
    else if (part.kind === "cylinder") paints.push(paintCylinder(part, key, { top: fill, body: fill }, HOLE_GREY));
    else paints.push(paintSphere(part, key, fill, HOLE_GREY));
  });
  const minX = Math.min(...paints.map((p) => p.min[0])), minY = Math.min(...paints.map((p) => p.min[1]));
  const maxX = Math.max(...paints.map((p) => p.max[0])), maxY = Math.max(...paints.map((p) => p.max[1]));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.06 + 1;
  const period = Math.max(2, (maxX - minX) / 28);
  return (
    <svg className={className} viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        {defs}
        <pattern id={stripes} width={period} height={period} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={period} height={period} fill={HOLE_GREY} fillOpacity="0.28" />
          <rect width={period / 2} height={period} fill={HOLE_GREY} fillOpacity="0.55" />
        </pattern>
      </defs>
      {paints.flatMap((p) => p.elements)}
    </svg>
  );
}

/**
 * A still isometric render drawn as SVG from a snapshot, with no WebGL. Solids use their toy colours; holes are
 * translucent grey with diagonal stripes. A circuit shows a small wiring picture; a blocks snapshot shows its objects.
 * Decorative: aria-hidden.
 */
export function SnapshotStill({ snapshot, className }: SnapshotStillProps) {
  if (snapshot.kind === "circuit") return <CircuitStill snapshot={snapshot} className={className} />;
  return <ModelStill parts={partsOf(objectsOf(snapshot))} className={className} />;
}
