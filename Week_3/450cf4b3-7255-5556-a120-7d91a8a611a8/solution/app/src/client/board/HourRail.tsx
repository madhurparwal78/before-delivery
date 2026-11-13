// The hour rail: a kitchen-local span in half-hour steps from 05:00 to 23:00, set by dragging
// across the rail, dragging either end, or the two sliders' arrow, Home and End keys.

import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { clockText, CLOSES_MINUTE, HALF_HOUR, OPENS_MINUTE } from "../../shared/clock.js";

const RANGE = CLOSES_MINUTE - OPENS_MINUTE;
const HOURS = Array.from({ length: 19 }, (_, i) => 5 + i);
const TICKS = Array.from({ length: RANGE / HALF_HOUR + 1 }, (_, i) => OPENS_MINUTE + i * HALF_HOUR);

function pct(minute: number): string {
  return `${(((minute - OPENS_MINUTE) / RANGE) * 100).toFixed(4)}%`;
}

type End = "from" | "to";

const CELLS = (CLOSES_MINUTE - OPENS_MINUTE) / HALF_HOUR;

/** The cooler strip: one cell per half hour with a hairline tick per free shelf and a hatch at zero. */
function CoolerStrip({ rows }: { rows: readonly { time: string; freeShelves: number }[] }): JSX.Element {
  return (
    <div class="cooler-strip" aria-hidden="true">
      {rows.map((row, i) => (
        <span key={row.time} class="cooler-strip__cell" data-cooler-free={String(row.freeShelves)} data-cooler-time={row.time}
          data-empty={row.freeShelves === 0 ? "true" : undefined} style={`left:${((i / CELLS) * 100).toFixed(4)}%;width:${(100 / CELLS).toFixed(4)}%`}>
          {Array.from({ length: row.freeShelves }, (_, tick) => <i key={tick} class="cooler-strip__tick" />)}
        </span>
      ))}
    </div>
  );
}

export function HourRail({ from, to, cooler, coolerLine, onChange }: {
  from: number; to: number; cooler: readonly { time: string; freeShelves: number }[] | null; coolerLine: string | null;
  onChange: (from: number, to: number) => void;
}): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ end: End | "new"; anchor: number } | null>(null);

  const minuteAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return OPENS_MINUTE;
    const raw = OPENS_MINUTE + ((clientX - box.left) / box.width) * RANGE;
    return Math.min(CLOSES_MINUTE, Math.max(OPENS_MINUTE, Math.round(raw / HALF_HOUR) * HALF_HOUR));
  };

  const setEnd = (end: End, minute: number): void => {
    if (end === "from") onChange(Math.min(Math.max(minute, OPENS_MINUTE), to - HALF_HOUR), to);
    else onChange(from, Math.max(Math.min(minute, CLOSES_MINUTE), from + HALF_HOUR));
  };

  const follow = (clientX: number): void => {
    const state = drag.current;
    if (!state) return;
    const minute = minuteAt(clientX);
    if (state.end === "new") {
      const low = Math.min(state.anchor, minute);
      const high = Math.max(state.anchor, minute);
      if (high - low >= HALF_HOUR) onChange(low, high);
      else onChange(Math.min(low, CLOSES_MINUTE - HALF_HOUR), Math.min(low, CLOSES_MINUTE - HALF_HOUR) + HALF_HOUR);
    } else {
      setEnd(state.end, minute);
    }
  };

  const keys = (end: End) => (event: KeyboardEvent): void => {
    const value = end === "from" ? from : to;
    const moves: Record<string, number> = {
      ArrowLeft: value - HALF_HOUR, ArrowDown: value - HALF_HOUR, ArrowRight: value + HALF_HOUR, ArrowUp: value + HALF_HOUR,
      Home: OPENS_MINUTE, End: CLOSES_MINUTE,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setEnd(end, next);
  };

  const thumb = (end: End, label: string, value: number): JSX.Element => (
    <div class={`rail__thumb rail__thumb--${end}`} role="slider" tabIndex={0} aria-label={label}
      aria-valuemin={OPENS_MINUTE} aria-valuemax={CLOSES_MINUTE} aria-valuenow={value} aria-valuetext={clockText(value)}
      aria-orientation="horizontal" data-end={end} style={`left:${pct(value)}`} onKeyDown={keys(end)}>
      <span class="rail__grip" aria-hidden="true" />
      <span class="rail__value" aria-hidden="true">{clockText(value)}</span>
    </div>
  );

  return (
    <div class="rail" role="group" aria-label="Hour rail"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const end = (event.target instanceof Element ? event.target.closest<HTMLElement>("[data-end]") : null)?.dataset.end;
        const minute = minuteAt(event.clientX);
        drag.current = end === "from" || end === "to" ? { end, anchor: minute } : { end: "new", anchor: minute };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (drag.current.end === "new") follow(event.clientX);
      }}
      onPointerMove={(event) => follow(event.clientX)}
      onPointerUp={(event) => {
        follow(event.clientX);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}>
      <div class="rail__track" ref={track}>
        <div class="rail__span" style={`left:${pct(from)};width:${(((to - from) / RANGE) * 100).toFixed(4)}%`} aria-hidden="true" />
        {TICKS.map((minute) => (
          <span key={minute} class={`rail__tick${minute % 60 === 0 ? " rail__tick--hour" : ""}`} style={`left:${pct(minute)}`} aria-hidden="true" />
        ))}
        {HOURS.map((hour) => (
          <span key={hour} class="rail__hour" style={`left:${pct(hour * 60)}`}>{String(hour).padStart(2, "0")}</span>
        ))}
        {thumb("from", "Span start", from)}
        {thumb("to", "Span end", to)}
      </div>
      {cooler ? <CoolerStrip rows={cooler} /> : null}
      {coolerLine ? <p class="cooler-line">{coolerLine}</p> : null}
    </div>
  );
}
