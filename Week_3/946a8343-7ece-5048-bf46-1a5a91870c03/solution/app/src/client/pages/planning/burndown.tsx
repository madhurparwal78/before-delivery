// The burndown chart: one point per day, drawn from the API's points. The chart is an image with the accessible name `Burndown`;
// each point carries its day, the weight remaining and whether the day is still ahead. It is drawn at the width of its container
// (no viewBox scaling), so the axis labels stay 12 px mono.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { BurndownPoint } from "./types.ts";

const MIN_WIDTH = 320;
const HEIGHT = 280;
const PAD = { left: 48, right: 24, top: 24, bottom: 48 };
const MIN_GRID_GAP = 10;
const MIN_LABEL_GAP = 16;

function useContainerWidth() {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setWidth(Math.max(MIN_WIDTH, Math.floor(parent.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** The whole numbers that get a gridline: every integer, thinned to the first step of 1, 2, 5, 10 … that keeps them apart. */
function gridValues(top: number, innerH: number): { values: number[]; labelled: boolean } {
  let step = 1;
  while ((innerH * step) / top < MIN_GRID_GAP) step = step < 2 ? 2 : step < 5 ? 5 : step * 2;
  const values: number[] = [];
  for (let value = 0; value <= top; value += step) values.push(value);
  return { values, labelled: (innerH * step) / top >= MIN_LABEL_GAP };
}

export function BurndownChart({ points }: { points: readonly BurndownPoint[] }) {
  const { ref, width } = useContainerWidth();
  const top = Math.max(1, ...points.map((point) => point.remaining));
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerH;
  const x = (index: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (innerW * index) / (points.length - 1));
  const y = (value: number) => PAD.top + innerH - (innerH * value) / top;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.remaining).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const grid = gridValues(top, innerH);
  return (
    <svg
      ref={ref}
      class="sp-burndown"
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="img"
      aria-label="Burndown"
    >
      {grid.values.map((value) => (
        <line key={value} class="sp-burndown__grid" x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
      ))}
      <line class="sp-burndown__axis" x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} />
      <line class="sp-burndown__axis" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={baseline} />
      {points.map((point, index) => (
        <line key={point.day} class="sp-burndown__axis" x1={x(index)} x2={x(index)} y1={baseline} y2={baseline + 6} />
      ))}
      {grid.values.map((value) =>
        grid.labelled || value === 0 || value === grid.values[grid.values.length - 1] ? (
          <text key={value} class="sp-burndown__tick" x={PAD.left - 8} y={y(value) + 4} text-anchor="end">
            {value}
          </text>
        ) : null,
      )}
      {first ? (
        <text class="sp-burndown__tick" x={PAD.left} y={HEIGHT - 16} text-anchor="start">
          {first.day}
        </text>
      ) : null}
      {last && points.length > 1 ? (
        <text class="sp-burndown__tick" x={width - PAD.right} y={HEIGHT - 16} text-anchor="end">
          {last.day}
        </text>
      ) : null}
      {points.length > 1 ? <path class="sp-burndown__line" d={line} fill="none" /> : null}
      {points.map((point, index) => (
        <rect
          key={point.day}
          class={`sp-burndown__point${point.future ? " sp-burndown__point--future" : ""}`}
          x={x(index) - 5}
          y={y(point.remaining) - 5}
          width={10}
          height={10}
          data-day={point.day}
          data-remaining={point.remaining}
          data-future={point.future ? "true" : "false"}
        />
      ))}
    </svg>
  );
}
