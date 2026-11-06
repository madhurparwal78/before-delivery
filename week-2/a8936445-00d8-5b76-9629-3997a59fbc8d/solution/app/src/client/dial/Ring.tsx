// The 24-hour ring: the slider, its handle and spoke, the selected station's day, and arc drawing.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Block } from "../../shared/api";
import { DAY_MINUTES, MAX_HOLD_MINUTES, MIN_HOLD_MINUTES, STEP_MINUTES } from "../../shared/kitchen";
import { clampMinute, snapStep } from "./model";

const C = 200;
const R_TRACK = 182;
const R_OUTER = 196;
const R_INNER = 168;
const BAND = 22;
const HANDLE_HIT = 32;
/** The spoke drawn over the floor plan starts outside the centre readout. */
const SPOKE_CLEAR = 56;

function polar(minute: number, radius: number): [number, number] {
  const angle = ((minute / 4) * Math.PI) / 180;
  return [C + radius * Math.sin(angle), C - radius * Math.cos(angle)];
}

function arcPath(from: number, to: number, radius: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x1, y1] = polar(a, radius);
  const [x2, y2] = polar(b, radius);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${b - a > 720 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** An arc path that always starts at `anchor`, so a dash offset retracts it towards the press point. */
function anchoredPath(anchor: number, end: number, radius: number): string {
  const [x1, y1] = polar(anchor, radius);
  const [x2, y2] = polar(end, radius);
  const sweep = end >= anchor ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${Math.abs(end - anchor) > 720 ? 1 : 0} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

type ArcStatus = "drawing" | "pending" | "placed" | "refused";

interface Arc {
  anchor: number;
  end: number;
  status: ArcStatus;
}

interface RingProps {
  value: number;
  valueText: string;
  reduced: boolean;
  onChange: (minute: number) => void;
  /** A free station is selected, so dragging on the track draws a hold. */
  canDraw: boolean;
  onArc: (start: number, end: number) => Promise<boolean>;
  blocks: Block[];
  /** Changes whenever the drawn arc should be cleared (a new day load, another station). */
  resetKey: string;
}

type Drag =
  | { mode: "dial"; pointerId: number }
  | { mode: "arc"; pointerId: number; lastRaw: number; position: number; anchor: number; end: number };

export function Ring({ value, valueText, reduced, onChange, canDraw, onArc, blocks, resetKey }: RingProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [arc, setArc] = useState<Arc | null>(null);
  const angle = useRef(value / 4);
  const shown = useRef(value);
  const arcGroup = useRef<SVGGElement>(null);

  if (value !== shown.current) {
    const target = value / 4;
    const current = ((angle.current % 360) + 360) % 360;
    let delta = (target % 360) - current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    angle.current += delta;
    shown.current = value;
  }

  useEffect(() => {
    setArc((a) => (a && a.status !== "drawing" && a.status !== "pending" ? null : a));
  }, [resetKey]);

  const pointerMinute = (event: PointerEvent): { raw: number; nearHandle: boolean } => {
    const rect = (svg.current as SVGSVGElement).getBoundingClientRect();
    const scale = rect.width / 400;
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    const degrees = ((Math.atan2(x - C, -(y - C)) * 180) / Math.PI + 360) % 360;
    const [hx, hy] = polar(value, R_TRACK);
    return { raw: degrees * 4, nearHandle: Math.hypot(x - hx, y - hy) < HANDLE_HIT };
  };

  const dialMinute = (raw: number): number => {
    const snapped = snapStep(raw) % DAY_MINUTES;
    const options = [snapped, snapped + DAY_MINUTES].filter((m) => m <= DAY_MINUTES);
    return options.reduce((best, m) => (Math.abs(m - value) < Math.abs(best - value) ? m : best));
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !svg.current) return;
    const { raw, nearHandle } = pointerMinute(event);
    svg.current.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (nearHandle || reduced || !canDraw || (arc && arc.status === "pending")) {
      drag.current = { mode: "dial", pointerId: event.pointerId };
      if (!nearHandle) onChange(dialMinute(raw));
      return;
    }
    const anchor = snapStep(raw) % DAY_MINUTES;
    drag.current = { mode: "arc", pointerId: event.pointerId, lastRaw: raw, position: anchor, anchor, end: anchor };
    setArc({ anchor, end: anchor, status: "drawing" });
  };

  const onPointerMove = (event: PointerEvent): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const { raw } = pointerMinute(event);
    if (state.mode === "dial") {
      const next = dialMinute(raw);
      if (next !== value) onChange(next);
      return;
    }
    let delta = raw - state.lastRaw;
    if (delta > DAY_MINUTES / 2) delta -= DAY_MINUTES;
    if (delta < -DAY_MINUTES / 2) delta += DAY_MINUTES;
    state.lastRaw = raw;
    state.position += delta;
    const reach = Math.max(state.anchor - MAX_HOLD_MINUTES, Math.min(state.anchor + MAX_HOLD_MINUTES, snapStep(state.position)));
    state.end = clampMinute(reach);
    setArc({ anchor: state.anchor, end: state.end, status: "drawing" });
  };

  const finish = (event: PointerEvent): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (state.mode !== "arc") return;
    const length = Math.abs(state.end - state.anchor);
    if (length === 0) {
      setArc(null);
      onChange(dialMinute(state.anchor));
      return;
    }
    if (length < MIN_HOLD_MINUTES || event.type === "pointercancel") {
      setArc(null);
      return;
    }
    const drawn: Arc = { anchor: state.anchor, end: state.end, status: "pending" };
    setArc(drawn);
    void onArc(Math.min(state.anchor, state.end), Math.max(state.anchor, state.end)).then((placed) => {
      if (placed) setArc({ ...drawn, status: "placed" });
      else retract(drawn);
    });
  };

  const retract = (refused: Arc): void => {
    setArc({ ...refused, status: "refused" });
    requestAnimationFrame(() => {
      const group = arcGroup.current;
      const paths = group ? [...group.querySelectorAll<SVGPathElement>("path")] : [];
      if (!paths.length || reduced) {
        setArc(null);
        return;
      }
      const animations = paths.map((path) => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = `${length} ${length + 4}`;
        return path.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: length }], {
          duration: 200,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "forwards",
        });
      });
      void Promise.all(animations.map((a) => a.finished)).finally(() => setArc((a) => (a === null || a.status === "refused" ? null : a)));
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const moves: Record<string, (v: number) => number> = {
      ArrowRight: (v) => v + STEP_MINUTES,
      ArrowUp: (v) => v + STEP_MINUTES,
      ArrowLeft: (v) => v - STEP_MINUTES,
      ArrowDown: (v) => v - STEP_MINUTES,
      PageUp: (v) => v + 60,
      PageDown: (v) => v - 60,
      Home: () => 0,
      End: () => DAY_MINUTES,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = clampMinute(move(value));
    if (next !== value) onChange(next);
  };

  const [hx, hy] = [C, C - R_TRACK];
  const arcLen = arc ? Math.abs(arc.end - arc.anchor) : 0;

  return (
    <div
      class="ring-slider"
      role="slider"
      tabIndex={0}
      aria-label="Service dial"
      aria-valuemin={0}
      aria-valuemax={DAY_MINUTES}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={svg}
        class="ring"
        viewBox="0 0 400 400"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <circle class="ring-face" cx={C} cy={C} r={R_OUTER} />
        <circle class="ring-track" cx={C} cy={C} r={R_TRACK} stroke-width={R_OUTER - R_INNER} />
        <circle class="ring-edge" cx={C} cy={C} r={R_OUTER} />
        <circle class="ring-edge" cx={C} cy={C} r={R_INNER} />
        {Array.from({ length: DAY_MINUTES / STEP_MINUTES }, (_, i) => {
          const minute = i * STEP_MINUTES;
          const hour = i % 4 === 0;
          const major = i % 24 === 0;
          const [x1, y1] = polar(minute, R_INNER + 1);
          const [x2, y2] = polar(minute, R_INNER + (major ? 13 : hour ? 9 : 4));
          return <line key={i} class={major ? "tick tick-major" : hour ? "tick tick-hour" : "tick"} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {[0, 360, 720, 1080].map((minute) => {
          const [x, y] = polar(minute, 152);
          return (
            <text key={minute} class="ring-numeral" x={x} y={y} text-anchor="middle" dominant-baseline="central">
              {String(minute / 60).padStart(2, "0")}
            </text>
          );
        })}
        <g class="ring-blocks">
          {blocks.map((block) => {
            const key = "booking_id" in block ? block.booking_id : `${block.kind}-${block.start_minute}`;
            const kind = block.kind === "hold" ? "held" : block.kind === "cleaning" ? "cleaning" : "booked";
            const d = arcPath(block.start_minute, block.end_minute, R_TRACK);
            return (
              <g key={key} class={`ring-block ring-block-${kind}`}>
                <path class="band" d={d} stroke-width={BAND} />
                <path class="dots" d={d} stroke-width={BAND - 6} />
              </g>
            );
          })}
        </g>
        {arc && arcLen > 0 && (
          <g ref={arcGroup} class={`arc arc-${arc.status}${arcLen < MIN_HOLD_MINUTES ? " arc-short" : ""}`}>
            <path class="band" d={anchoredPath(arc.anchor, arc.end, R_TRACK)} stroke-width={BAND} />
            <path class="dots" d={anchoredPath(arc.anchor, arc.end, R_TRACK)} stroke-width={BAND - 6} />
            <path class="edge" d={anchoredPath(arc.anchor, arc.end, R_TRACK + BAND / 2)} />
            <path class="edge" d={anchoredPath(arc.anchor, arc.end, R_TRACK - BAND / 2)} />
          </g>
        )}
        <g class="hand" style={{ transform: `rotate(${angle.current}deg)` }}>
          <line class="spoke" x1={C} y1={C} x2={hx} y2={hy + 14} />
          <circle class="handle-hit" cx={hx} cy={hy} r={HANDLE_HIT - 6} />
          <circle class="handle" cx={hx} cy={hy} r={13} />
          <circle class="handle-core" cx={hx} cy={hy} r={4} />
        </g>
      </svg>
      <svg class="spoke-over" viewBox="0 0 400 400" aria-hidden="true">
        <g class="hand" style={{ transform: `rotate(${angle.current}deg)` }}>
          <line class="spoke spoke-thin" x1={C} y1={C - SPOKE_CLEAR} x2={hx} y2={hy + 14} />
        </g>
      </svg>
    </div>
  );
}
