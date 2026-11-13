// The Report's figure: one isometric 3D bar per station standing on a shared floor line. Heights come
// from usageBarHeight; bars grow from a flat tile over 600 ms, 40 ms apart, on each settled date, and a
// live refresh moves only the bars whose height changed.

import type { JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { DailyReport } from "../../shared/api.js";
import { duration } from "../../shared/format.js";
import { usageBarHeight } from "../../shared/metrics.js";
import { MOTION, reducedMotion } from "../board/motion.js";

const SLOT = 52;
const MARGIN = 8;
const HALF_WIDTH = 20;
const HALF_DEPTH = 11.5;
const HEADROOM = 8;
const MAX_HEIGHT = 160;
const GROW_MS = 600;
const STAGGER_MS = 40;
const ANGLE = (Math.atan2(HALF_DEPTH, HALF_WIDTH) * 180) / Math.PI;
const FLOOR_Y = HEADROOM + MAX_HEIGHT + 2 * HALF_DEPTH;
const LABEL_LINE = 15;

const BARS_HEIGHT = FLOOR_Y + 12 + 3 * LABEL_LINE + 4;

/** Name lines of at most seven characters, split between words. */
function nameLines(name: string): string[] {
  const lines: string[] = [];
  for (const word of name.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= 7) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

const poly = (list: readonly (readonly [number, number])[]): string => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function Bar({ index, station, height, register }: {
  index: number; station: DailyReport["stations"][number]; height: number; register: (id: string, el: SVGGElement | null) => void;
}): JSX.Element {
  const cx = MARGIN + SLOT / 2 + index * SLOT;
  const back: [number, number] = [cx, FLOOR_Y - 2 * HALF_DEPTH];
  const right: [number, number] = [cx + HALF_WIDTH, FLOOR_Y - HALF_DEPTH];
  const front: [number, number] = [cx, FLOOR_Y];
  const left: [number, number] = [cx - HALF_WIDTH, FLOOR_Y - HALF_DEPTH];
  const lines = nameLines(station.stationName);
  return (
    <g class="bar" data-station-id={station.stationId} data-minutes={String(station.bookedMinutes)} data-height={String(height)}
      style={{ "--bh": String(height) }} ref={(el: SVGGElement | null) => register(station.stationId, el)}>
      <rect class="bar__face bar__face--left" width="1" height="1"
        style={{ transform: `translate(${left[0]}px, ${left[1]}px) skewY(${ANGLE}deg) scale(${HALF_WIDTH}, calc(var(--bh) * -1))` }} />
      <rect class="bar__face bar__face--right" width="1" height="1"
        style={{ transform: `translate(${front[0]}px, ${front[1]}px) skewY(${-ANGLE}deg) scale(${HALF_WIDTH}, calc(var(--bh) * -1))` }} />
      <polygon class="bar__top" points={poly([back, right, front, left])} style={{ transform: "translateY(calc(var(--bh) * -1px))" }} />
      <text class="bar__name" x={cx} y={FLOOR_Y + 16} text-anchor="middle">
        {lines.map((line, i) => <tspan key={line} x={cx} dy={i === 0 ? 0 : LABEL_LINE}>{line}</tspan>)}
        <tspan class="bar__value" x={cx} dy={LABEL_LINE}>{duration(station.bookedMinutes)}</tspan>
      </text>
    </g>
  );
}

export function UsageBars({ stations, settled }: { stations: DailyReport["stations"]; settled: string }): JSX.Element {
  const elements = useRef(new Map<string, SVGGElement>());
  const drawn = useRef<{ settled: string; heights: Map<string, number> } | null>(null);
  const largest = Math.max(0, ...stations.map((s) => s.bookedMinutes));
  const heights = new Map(stations.map((s) => [s.stationId, usageBarHeight(s.bookedMinutes, largest)] as const));

  useLayoutEffect(() => {
    const before = drawn.current;
    drawn.current = { settled, heights };
    if (reducedMotion()) return;
    const grow = (id: string, from: number, to: number, delay: number): void => {
      elements.current.get(id)?.animate([{ "--bh": String(from) }, { "--bh": String(to) }], { duration: GROW_MS, delay, easing: MOTION.easing, fill: "backwards" });
    };
    stations.forEach((s, i) => {
      const to = heights.get(s.stationId) ?? 0;
      if (!before || before.settled !== settled) grow(s.stationId, 0, to, i * STAGGER_MS);
      else if (before.heights.get(s.stationId) !== to) grow(s.stationId, before.heights.get(s.stationId) ?? 0, to, 0);
    });
  });

  const width = 2 * MARGIN + SLOT * stations.length;
  return (
    <svg class="bars" width={width} height={BARS_HEIGHT} viewBox={`0 0 ${width} ${BARS_HEIGHT}`} aria-hidden="true" focusable="false">
      <line class="bars__floor" x1="0" x2={width} y1={FLOOR_Y} y2={FLOOR_Y} />
      {stations.map((s, i) => (
        <Bar key={s.stationId} index={i} station={s} height={heights.get(s.stationId) ?? 0}
          register={(id, el) => { if (el) elements.current.set(id, el); else elements.current.delete(id); }} />
      ))}
    </svg>
  );
}
