// The embargo dial (brief: Interactions → Embargo dial; Visual design → Embargo dial; Motion → Dial change).
// Every value comes from the shared go-live and Night rules; this file only draws them.
import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CITY, MARKETS, type Market, type Wall, ZONE, hhmm, instantText, isNight, rollingOpenings, simultaneousInstant, wallAt } from "../shared/time";
import { Countdown } from "./countdown";
import { NightMark } from "./ui";

export type DropType = "simultaneous" | "rolling";

interface PinState {
  market: Market;
  /** Local wall time in the market's zone, null inside the Copenhagen gap of a simultaneous drop. */
  local: Wall | null;
  utc: number | null;
  night: boolean;
  shiftMinutes: number;
}

interface DialState {
  gap: boolean;
  copenhagenUtc: number | null;
  pins: PinState[];
}

export function dialState(date: Pick<Wall, "year" | "month" | "day">, type: DropType, minutes: number): DialState {
  const wall: Wall = { ...date, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 };
  if (type === "simultaneous") {
    const ms = simultaneousInstant(wall);
    if (ms === null) return { gap: true, copenhagenUtc: null, pins: MARKETS.map((market) => ({ market, local: null, utc: null, night: false, shiftMinutes: 0 })) };
    return {
      gap: false,
      copenhagenUtc: ms,
      pins: MARKETS.map((market) => {
        const local = wallAt(ms, ZONE[market]);
        return { market, local, utc: ms, night: isNight(local), shiftMinutes: 0 };
      }),
    };
  }
  const openings = rollingOpenings(wall);
  return {
    gap: false,
    copenhagenUtc: openings.find((o) => o.market === "copenhagen")?.ms ?? null,
    pins: openings.map((o) => {
      const local = wallAt(o.ms, ZONE[o.market]);
      return { market: o.market, local, utc: o.ms, night: isNight(local), shiftMinutes: o.shiftMinutes };
    }),
  };
}


/** The earliest market instant the dial shows, which the countdown counts down to. */
function firstOpening(state: DialState): number | null {
  const instants = state.pins.flatMap((p) => (p.utc === null ? [] : [p.utc]));
  return instants.length ? Math.min(...instants) : null;
}

const RING: Record<Market, number> = { copenhagen: 70, stockholm: 63, paris: 56, london: 49, new_york: 42, tokyo: 35 };

const polar = (deg: number, r: number): [number, number] => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];

function arc(fromDeg: number, toDeg: number, inner: number, outer: number): string {
  const sweep = (toDeg - fromDeg + 360) % 360;
  const large = sweep > 180 ? 1 : 0;
  const [x1, y1] = polar(fromDeg, outer);
  const [x2, y2] = polar(toDeg, outer);
  const [x3, y3] = polar(toDeg, inner);
  const [x4, y4] = polar(fromDeg, inner);
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

// The night band's ends come from the one Night rule: the hours where it switches on and off.
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const NIGHT_FROM = HOURS.find((hour) => isNight({ hour }) && !isNight({ hour: (hour + 23) % 24 })) ?? 0;
const NIGHT_TO = HOURS.find((hour) => !isNight({ hour }) && isNight({ hour: (hour + 23) % 24 })) ?? 0;
const onNight = (quarter: number): boolean => isNight({ hour: Math.floor(quarter / 4) });

/** The ring, the night band and the ticks, drawn under the hand and pins. */
export function DialFace(): JSX.Element {
  const ticks = [];
  for (let q = 0; q < 96; q += 1) {
    const deg = q * 3.75;
    const hour = q % 4 === 0;
    const [x1, y1] = polar(deg, 98);
    const [x2, y2] = polar(deg, hour ? 89 : 94);
    ticks.push(<line key={q} x1={x1} y1={y1} x2={x2} y2={y2} className={`tick${hour ? " tick-hour" : ""}${onNight(q) ? " on-night" : ""}`} />);
  }
  return (
    <svg className="dial-face" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
      <circle r="99" className="dial-ground" />
      <path d={arc(NIGHT_FROM * 15, NIGHT_TO * 15, 74, 99)} className="night-arc" />
      {MARKETS.map((m) => (
        <circle key={m} r={RING[m]} className="pin-ring" />
      ))}
      <circle r="99" className="dial-rim" />
      {ticks}
    </svg>
  );
}

/** Hour numerals every 3 hours, each on its own backing, drawn above the hand and the pin labels. */
export function DialNumerals(): JSX.Element {
  return (
    <svg className="dial-numerals" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
      {HOURS.filter((h) => h % 3 === 0).map((h) => {
        const [x, y] = polar(h * 15, 81);
        const night = onNight(h * 4);
        return (
          <g key={h} className={night ? "on-night" : undefined}>
            <rect x={x - 6} y={y - 4.5} width="12" height="9" rx="1.5" className="numeral-back" />
            <text x={x} y={y} className="numeral" textAnchor="middle" dominantBaseline="central">
              {String(h).padStart(2, "0")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LabelPlace {
  left: boolean;
  shift: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Places each pin label beside its pin, outermost ring first, on the side and row that covers no hour numeral,
 * the centre countdown or a label already placed, and stays on the dial.
 */
function placeLabels(pins: { market: Market; angle: number; text: string; night: boolean }[], radius: number): Record<Market, LabelPlace> {
  const scale = radius / 100;
  const phone = radius < 160;
  const charWidth = radius < 200 ? 6.4 : 7.4;
  const height = phone ? 16 : 18;
  const gap = phone ? 7 : 9;
  const taken: Box[] = HOURS.filter((h) => h % 3 === 0).map((h) => {
    const [x, y] = polar(h * 15, 81);
    return { x: (x - 6) * scale, y: (y - 4.5) * scale, w: 12 * scale, h: 9 * scale };
  });
  taken.push({ x: -0.3 * radius, y: -0.2 * radius, w: 0.6 * radius, h: 0.4 * radius });
  const places = {} as Record<Market, LabelPlace>;
  for (const pin of pins) {
    const [px, py] = polar(pin.angle, RING[pin.market] * scale);
    const w = pin.text.length * charWidth + (pin.night ? 52 : 0) + 12;
    const candidates = [0, 1, -1, 2, -2].flatMap((row) => [false, true].map((left) => ({ left, shift: row * height })));
    const boxes = candidates.map(({ left, shift }) => ({ x: left ? px - gap - w : px + gap, y: py - height / 2 + shift, w, h: height }));
    const score = boxes.map(
      (box) => taken.filter((t) => overlaps(box, t)).length * 2 + (box.x < -radius || box.x + box.w > radius ? 3 : 0),
    );
    const best = score.indexOf(Math.min(...score));
    places[pin.market] = candidates[best];
    taken.push(boxes[best]);
  }
  return places;
}

/** Turns each pin the shorter way round its own ring (half a turn goes clockwise). */
function useShortestAngles(targets: Record<Market, number | null>): Record<Market, number> {
  const angles = useRef<Record<Market, number> | null>(null);
  if (!angles.current) angles.current = Object.fromEntries(MARKETS.map((m) => [m, targets[m] ?? 0])) as Record<Market, number>;
  for (const m of MARKETS) {
    const target = targets[m];
    if (target === null) continue;
    const current = angles.current[m];
    let delta = (((target - current) % 360) + 360) % 360;
    if (delta > 180) delta -= 360;
    angles.current[m] = current + delta;
  }
  return angles.current;
}

export function Dial({
  state,
  minutes,
  onMinutes,
  now,
}: {
  state: DialState;
  minutes: number;
  onMinutes: (minutes: number) => void;
  now: number;
}): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const dragging = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setSize(el.getBoundingClientRect().width));
    observer.observe(el);
    setSize(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => void (dragging.current = null), []);
  const angles = useShortestAngles(
    Object.fromEntries(state.pins.map((p) => [p.market, p.local ? ((p.local.hour * 60 + p.local.minute) / 1440) * 360 : null])) as Record<Market, number | null>,
  );
  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const quarter = Math.round(deg / 3.75) % 96;
    onMinutes(quarter * 15);
  };
  const radius = size / 2;
  const labels = state.pins.map((pin) => `${CITY[pin.market]} ${pin.local ? hhmm(pin.local) : "—"}`);
  const places = placeLabels(
    state.pins.map((pin, i) => ({ market: pin.market, angle: angles[pin.market], text: labels[i], night: pin.night })),
    radius,
  );
  return (
    <div
      ref={root}
      role="group"
      aria-label="Embargo dial"
      className="dial"
      data-utc={state.copenhagenUtc === null ? "" : instantText(state.copenhagenUtc)}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current === e.pointerId) fromPointer(e);
      }}
      onPointerUp={(e) => {
        if (dragging.current === e.pointerId) dragging.current = null;
      }}
      onPointerCancel={() => (dragging.current = null)}
    >
      <DialFace />
      <div className="dial-hand" style={{ transform: `rotate(${(minutes / 1440) * 360}deg)` }} aria-hidden="true">
        <span className="hand-line" style={{ height: radius * 0.575, bottom: radius * 0.36 }} />
        <span className="hand-tip" style={{ bottom: radius * 0.935 }} />
      </div>
      {state.pins.map((pin) => {
        const angle = angles[pin.market];
        const local = pin.local ? hhmm(pin.local) : "";
        return (
          <div
            key={pin.market}
            className="pin"
            data-market={pin.market}
            data-local-time={local}
            data-night={pin.night ? "true" : "false"}
            data-utc={pin.utc === null ? "" : instantText(pin.utc)}
            style={{ transform: `rotate(${angle}deg)` }}
          >
            <span className="pin-anchor" style={{ top: -radius * (RING[pin.market] / 100) }}>
              <span className="pin-dot" />
              <span className="pin-label" style={{ transform: `rotate(${-angle}deg)` }}>
                <span className={`pin-text${places[pin.market].left ? " is-left" : ""}`} style={{ marginTop: places[pin.market].shift }}>
                  <span className="pin-city">{CITY[pin.market]}</span> <span className="mono pin-time">{local || "—"}</span>
                  {pin.night ? <NightMark /> : null}
                </span>
              </span>
            </span>
          </div>
        );
      })}
      <DialNumerals />
      <div className="dial-centre">
        <Countdown label="Countdown to go-live" targetMs={firstOpening(state)} now={now} />
      </div>
    </div>
  );
}
