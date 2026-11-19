import { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";
import type { Leg, Stop } from "../../shared/api";
import { seatBandName, type SeatRow } from "../../shared/seats";
import { MOTION_MS } from "../../shared/motion";
import { isReduced, tween, useMotion } from "../lib/motion";

type Which = "from" | "to";

interface Props {
  stops: Stop[];
  legs: Leg[];
  seatMap: SeatRow[];
  routeKm: number;
  from: number;
  to: number;
  /** Passengers get handles and a tinted span; the driver sees the bands only. */
  interactive: boolean;
  cleared: boolean;
  assigned: readonly number[];
  onMove: (which: Which, index: number) => void;
}

function bounds(which: Which, from: number, to: number, count: number): { lo: number; hi: number } {
  return which === "from" ? { lo: 0, hi: to - 1 } : { lo: from + 1, hi: count - 1 };
}

interface HandleProps {
  which: Which;
  index: number;
  stops: Stop[];
  routeKm: number;
  from: number;
  to: number;
  inner: React.RefObject<HTMLDivElement | null>;
  onMove: (which: Which, index: number) => void;
}

function Handle({ which, index, stops, routeKm, from, to, inner, onMove }: HandleProps): ReactElement {
  const node = useRef<HTMLDivElement | null>(null);
  const motion = useMotion("handle-snap");
  const previous = useRef(index);
  const pending = useRef<number | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const drag = useRef<{ startX: number; base: number } | null>(null);
  const playMotion = motion.play;

  const px = (i: number): number => ((stops[i]?.km ?? 0) / routeKm) * (inner.current?.clientWidth ?? 0);

  const glide = (offset: number): void => {
    stop.current?.();
    const el = node.current;
    if (!el) return;
    if (isReduced() || offset === 0) {
      el.style.transform = "";
      return;
    }
    playMotion();
    stop.current = tween(
      MOTION_MS["handle-snap"],
      (p) => {
        el.style.transform = `translateX(${offset * (1 - p)}px)`;
      },
      () => {
        el.style.transform = "";
      },
    );
  };

  useLayoutEffect(() => {
    if (previous.current === index) return;
    const offset = pending.current ?? px(previous.current) - px(index);
    pending.current = null;
    previous.current = index;
    glide(offset);
  }, [index]);

  useEffect(() => () => stop.current?.(), []);

  const { lo, hi } = bounds(which, from, to, stops.length);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const keys: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      Home: lo,
      End: hi,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    if (target < lo || target > hi || target === index) return;
    onMove(which, target);
  };

  const release = (event: React.PointerEvent): void => {
    const gesture = drag.current;
    drag.current = null;
    if (!gesture) return;
    if (node.current?.hasPointerCapture(event.pointerId)) node.current.releasePointerCapture(event.pointerId);
    const x = Math.min(px(hi), Math.max(px(lo), gesture.base + (event.clientX - gesture.startX)));
    let snap = lo;
    for (let i = lo; i <= hi; i += 1) if (Math.abs(px(i) - x) < Math.abs(px(snap) - x)) snap = i;
    if (snap === index) glide(x - px(index));
    else {
      pending.current = x - px(snap);
      onMove(which, snap);
    }
  };

  return (
    <div
      ref={node}
      role="slider"
      tabIndex={0}
      aria-label={which === "from" ? "Boarding stop" : "Alighting stop"}
      aria-orientation="horizontal"
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuenow={index}
      aria-valuetext={stops[index]?.city}
      className="ls-handle"
      style={{ left: `${((stops[index]?.km ?? 0) / routeKm) * 100}%` }}
      data-motion="handle-snap"
      data-motion-ms={motion.ms}
      data-state={motion.state}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        stop.current?.();
        if (node.current) node.current.style.transform = "";
        node.current?.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, base: px(index) };
      }}
      onPointerMove={(event) => {
        const gesture = drag.current;
        if (!gesture || !node.current) return;
        const x = Math.min(px(hi), Math.max(px(lo), gesture.base + (event.clientX - gesture.startX)));
        node.current.style.transform = `translateX(${x - px(index)}px)`;
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="ls-tab" aria-hidden="true" />
    </div>
  );
}

function Band({ row, stops, legs, routeKm, from, to, assigned }: { row: SeatRow; stops: Stop[]; legs: Leg[]; routeKm: number; from: number; to: number; assigned: boolean }): ReactElement {
  const motion = useMotion("seat-fill");
  const previous = useRef(row.legs);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const play = motion.play;
  const ms = motion.ms;

  useEffect(() => {
    const before = previous.current;
    previous.current = row.legs;
    const changed = row.legs.map((status, i) => (before[i] !== status ? i : -1)).filter((i) => i >= 0);
    if (changed.length === 0) return;
    play();
    if (ms === 0) return;
    const each = ms / changed.length;
    changed.forEach((leg, k) => {
      const fill = fills.current[leg];
      const taken = row.legs[leg] === "taken";
      fill?.animate(
        { transform: taken ? ["scaleX(0)", "scaleX(1)"] : ["scaleX(1)", "scaleX(0)"] },
        { duration: each, delay: k * each, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      );
    });
  }, [row.legs, play, ms]);

  const name = seatBandName(row, stops.map((s) => s.city));
  return (
    <div
      role="img"
      aria-label={name}
      className={`ls-band${assigned ? " is-assigned" : ""}`}
      data-motion="seat-fill"
      data-motion-ms={motion.ms}
      data-state={motion.state}
    >
      {legs.map((leg, i) => {
        const start = stops[i]?.km ?? 0;
        const taken = row.legs[i] === "taken";
        return (
          <span
            key={leg.index}
            className={`ls-leg ${taken ? "taken" : "free"}${i >= from && i < to ? " in-span" : ""}`}
            style={{ left: `${(start / routeKm) * 100}%`, width: `${(leg.km / routeKm) * 100}%` }}
          >
            <span
              className="ls-fill"
              ref={(el) => {
                fills.current[i] = el;
              }}
              style={{ transform: taken ? "scaleX(1)" : "scaleX(0)" }}
            />
          </span>
        );
      })}
    </div>
  );
}

export function LegSpan({ stops, legs, seatMap, routeKm, from, to, interactive, cleared, assigned, onMove }: Props): ReactElement {
  const inner = useRef<HTMLDivElement | null>(null);
  const selected = interactive && !cleared;
  const startPct = ((stops[from]?.km ?? 0) / routeKm) * 100;
  const endPct = ((stops[to]?.km ?? routeKm) / routeKm) * 100;

  return (
    <div role="group" aria-label="Leg Span" className="legspan">
      <div className="ls-track">
        <div className="ls-inner" ref={inner}>
          {interactive ? (
            <div className="ls-handles">
              <Handle which="from" index={from} stops={stops} routeKm={routeKm} from={from} to={to} inner={inner} onMove={onMove} />
              <Handle which="to" index={to} stops={stops} routeKm={routeKm} from={from} to={to} inner={inner} onMove={onMove} />
            </div>
          ) : null}
          {selected ? <div className="ls-tint" style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} /> : null}
          <div className="ls-line" />
          <div className="ls-ticks">
            {stops.map((stop, i) => {
              const pct = (stop.km / routeKm) * 100;
              const gap = i === 0 ? 100 : pct - (stops[i - 1]!.km / routeKm) * 100;
              const edge = i === 0 ? " is-first" : i === stops.length - 1 ? " is-last" : "";
              return (
                <div key={stop.city} className={`ls-tick${edge}${gap < 34 && i > 0 ? " is-low" : ""}`} style={{ left: `${pct}%` }}>
                  <span className="ls-name">{stop.city}</span>
                </div>
              );
            })}
          </div>
          <div className="ls-bands">
            {seatMap.map((row) => (
              <Band
                key={row.seat}
                row={row}
                stops={stops}
                legs={legs}
                routeKm={routeKm}
                from={from}
                to={to}
                assigned={selected && assigned.includes(row.seat)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
