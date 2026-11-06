import { type ReactNode, useMemo, useState } from "react";
import type { Station } from "../types";

// The kitchen floor plan, drawn at runtime from the station list: one thin steel contour per
// station by kind, in loom order around a U-shaped line. Lit stations turn amber in row order,
// 40 ms apart; leaving stations dim in reverse row order with the same stagger.

const WIDTH = 1200;
const HEIGHT = 210;
const SIZE = 44;
const STAGGER_MS = 40;
const LEFT = 90;
const RIGHT = WIDTH - 90;
const TOP = 46;
const BOTTOM = 150;

interface Placed {
  station: Station;
  x: number;
  y: number;
  side: "left" | "bottom" | "right";
  /** Bottom-run labels alternate below and above the line so neighbours never collide. */
  above: boolean;
}

/** Loom order around the U: down the left arm, along the bottom run, up the right arm. */
function place(stations: Station[]): Placed[] {
  const arm = Math.max(1, Math.floor(stations.length / 5));
  const run = stations.length - 2 * arm;
  return stations.map((station, i) => {
    if (i < arm) return { station, x: LEFT, y: TOP + i * (SIZE + 16), side: "left", above: false };
    if (i < arm + run) {
      const k = i - arm;
      return { station, x: LEFT + 190 + ((k + 0.5) / run) * (RIGHT - LEFT - 450), y: BOTTOM, side: "bottom", above: k % 2 === 1 };
    }
    const k = stations.length - 1 - i;
    return { station, x: RIGHT, y: TOP + k * (SIZE + 16), side: "right", above: false };
  });
}

function shape(kind: Station["kind"]): ReactNode {
  const h = SIZE / 2;
  switch (kind) {
    case "oven":
      return (
        <>
          <rect x={-h} y={-h * 0.8} width={SIZE} height={SIZE * 0.8} />
          <line x1={-h} y1={h * 0.15} x2={h} y2={h * 0.15} />
          <line x1={-h * 0.45} y1={h * 0.45} x2={h * 0.45} y2={h * 0.45} />
        </>
      );
    case "mixer":
    case "kettle":
      return <circle r={h * 0.82} />;
    case "chiller":
    case "cooler":
      return (
        <>
          <rect x={-h} y={-h} width={SIZE} height={SIZE} />
          <line x1={-h} y1={h} x2={-h} y2={h - SIZE * 0.55} />
          <path d={`M ${-h} ${h - SIZE * 0.55} A ${SIZE * 0.55} ${SIZE * 0.55} 0 0 1 ${-h + SIZE * 0.55} ${h}`} />
        </>
      );
    case "range":
      return (
        <>
          <rect x={-h * 1.1} y={-h * 0.8} width={SIZE * 1.1} height={SIZE * 0.8} />
          {[-1, 1].flatMap((sx) => [-1, 1].map((sy) => <circle key={`${sx}${sy}`} cx={sx * h * 0.5} cy={sy * h * 0.38} r={h * 0.27} />))}
        </>
      );
    case "prep":
      return <rect x={-h * 1.6} y={-h * 0.32} width={SIZE * 1.6} height={SIZE * 0.32} />;
  }
}

function labelPosition(p: Placed): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  if (p.side === "left") return { x: SIZE * 0.9, y: 5, anchor: "start" };
  if (p.side === "right") return { x: -SIZE * 0.9, y: 5, anchor: "end" };
  return { x: 0, y: p.above ? -SIZE * 0.78 : SIZE * 0.98, anchor: "middle" };
}

/** Per-station transition delays for the latest change of the lit set (derived state). */
function useStagger(stations: Station[], lit: Set<string>): Map<string, number> {
  const [seen, setSeen] = useState<{ lit: Set<string>; delays: Map<string, number> }>({ lit: new Set(), delays: new Map() });
  const changed = seen.lit.size !== lit.size || [...lit].some((id) => !seen.lit.has(id));
  if (changed) {
    const joining = stations.filter((s) => lit.has(s.id) && !seen.lit.has(s.id));
    const leaving = stations.filter((s) => !lit.has(s.id) && seen.lit.has(s.id)).reverse();
    const delays = new Map<string, number>();
    joining.forEach((s, i) => delays.set(s.id, i * STAGGER_MS));
    leaving.forEach((s, i) => delays.set(s.id, i * STAGGER_MS));
    setSeen({ lit: new Set(lit), delays });
    return delays;
  }
  return seen.delays;
}

export function FloorPlan({ stations, lit }: { stations: Station[]; lit: Set<string> }) {
  const placed = useMemo(() => place(stations), [stations]);
  const delays = useStagger(stations, lit);
  const line = `M ${LEFT - 40} ${TOP - 24} L ${LEFT - 40} ${BOTTOM + 34} L ${RIGHT + 40} ${BOTTOM + 34} L ${RIGHT + 40} ${TOP - 24}`;
  return (
    <div className="plan-band">
      <svg role="group" aria-label="Kitchen floor plan" className="plan" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet">
        <path className="plan-line" d={line} aria-hidden="true" />
        {placed.map((p) => {
          const on = lit.has(p.station.id);
          const label = labelPosition(p);
          return (
            <g
              key={p.station.id}
              role="img"
              aria-label={on ? `${p.station.name}, lit` : p.station.name}
              className={on ? "station lit" : "station"}
              transform={`translate(${p.x} ${p.y})`}
              style={{ transitionDelay: `${delays.get(p.station.id) ?? 0}ms` }}
            >
              <g className="contour">{shape(p.station.kind)}</g>
              <text className="station-name" x={label.x} y={label.y} textAnchor={label.anchor}>
                {p.station.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
