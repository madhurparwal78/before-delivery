import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { DayStation, Segment } from "../types.js";
import { angleOf, arc, CENTRE, COUNTDOWN_RADIUS, LABEL_RADIUS, minuteAt, point, ring, RING_INNER, sector, SIZE } from "./geometry.js";

export interface Span { start: number; end: number; segment: Segment }
export interface ArcView { stationId: string; start: number; end: number; fill: number }
export interface DialTick { minute: number; label: string; zone: string; repeated: boolean }

interface DialProps {
  stations: DayStation[];
  spans: Map<string, Span[]>;
  dayMinutes: number;
  ticks: DialTick[];
  arc: ArcView | null;
  claimed: string | null;
  focused: string | null;
  note: { stationId: string; minute: number; text: string } | null;
  countdown: { fromMinute: number; fraction: number } | null;
  valueText: (stationId: string) => string;
  valueNow: (stationId: string) => number;
  ringRef: (stationId: string, element: SVGGElement | null) => void;
  onRingDown: (stationId: string, minute: number) => boolean;
  onMove: (minute: number) => void;
  onUp: () => void;
  onKey: (stationId: string, event: KeyboardEvent<SVGGElement>) => void;
  onFocusRing: (stationId: string | null) => void;
  children: ReactNode;
}

const KIND: Record<Segment["state"], string> = { booked: "booked", held: "held", yours_booked: "yours", yours_held: "yours" };

export function Dial(props: DialProps) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [scale, setScale] = useState(0.48);
  useEffect(() => {
    const element = svg.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setScale(Math.max(0.2, element.getBoundingClientRect().width / SIZE)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fontUnits = Math.max(14, 12 / scale);
  const count = props.stations.length;
  const { dayMinutes } = props;
  const clip = (minute: number): number => Math.min(dayMinutes, Math.max(0, minute));
  const toMinute = (event: PointerEvent): number => minuteAt((svg.current as SVGSVGElement).getBoundingClientRect(), event.clientX, event.clientY, dayMinutes);

  return (
    <div className="dial-frame">
      <svg
        ref={svg}
        className="dial"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="group"
        aria-label="Station dial"
        onPointerMove={(event) => { if (dragging.current) props.onMove(toMinute(event)); }}
        onPointerUp={() => { if (dragging.current) { dragging.current = false; props.onUp(); } }}
        onPointerCancel={() => { if (dragging.current) { dragging.current = false; props.onUp(); } }}
      >
        <defs>
          <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="14" className="hatch-line" />
          </pattern>
        </defs>
        <circle cx={CENTRE} cy={CENTRE} r={RING_INNER - 10} className="dial-face" aria-hidden="true" />
        {props.ticks.map((tick) => {
          const angle = angleOf(tick.minute, dayMinutes);
          const [x, y] = point(LABEL_RADIUS, angle);
          return (
            <text key={`${tick.minute}`} x={x} y={y} className={`tick-label${tick.repeated ? " tick-repeated" : ""}`} fontSize={Math.max(16, 12 / scale)} aria-hidden="true">
              {tick.label.slice(0, 2)}{tick.repeated ? ` ${tick.zone}` : ""}
            </text>
          );
        })}
        <circle cx={CENTRE} cy={CENTRE} r={COUNTDOWN_RADIUS} className="countdown-track" aria-hidden="true" />
        {props.countdown && props.countdown.fraction > 0 ? (
          <path
            className="countdown"
            d={arc(COUNTDOWN_RADIUS, angleOf(props.countdown.fromMinute, dayMinutes), angleOf(props.countdown.fromMinute, dayMinutes) + 2 * Math.PI * props.countdown.fraction)}
            aria-hidden="true"
          />
        ) : null}
        {props.stations.map((station, index) => {
          const bounds = ring(index, count);
          const spans = props.spans.get(station.id) ?? [];
          const focused = props.focused === station.id;
          return (
            <g
              key={station.id}
              ref={(element) => props.ringRef(station.id, element)}
              className={`ring${focused ? " ring-focused" : ""}`}
              role="slider"
              tabIndex={0}
              aria-label={station.name}
              aria-valuemin={0}
              aria-valuemax={dayMinutes}
              aria-valuenow={props.valueNow(station.id)}
              aria-valuetext={props.valueText(station.id)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                (event.currentTarget as SVGGElement).focus({ preventScroll: true });
                if (props.onRingDown(station.id, toMinute(event))) {
                  dragging.current = true;
                  svg.current?.setPointerCapture(event.pointerId);
                }
              }}
              onKeyDown={(event) => props.onKey(station.id, event)}
              onFocus={() => props.onFocusRing(station.id)}
              onBlur={() => props.onFocusRing(null)}
            >
              <path className="ring-band" d={sector(bounds.outer, bounds.inner, 0, 2 * Math.PI)} />
              {props.ticks.map((tick) => {
                const angle = angleOf(tick.minute, dayMinutes);
                const [x0, y0] = point(bounds.outer - 1, angle);
                const [x1, y1] = point(bounds.outer - bounds.band * 0.34, angle);
                return <line key={tick.minute} x1={x0} y1={y0} x2={x1} y2={y1} className="hour-tick" />;
              })}
              {spans.map((span) => {
                const a0 = angleOf(clip(span.start), dayMinutes);
                const a1 = angleOf(clip(span.end), dayMinutes);
                const kind = props.claimed && span.segment.hold_id === props.claimed ? "yours" : KIND[span.segment.state];
                const d = sector(bounds.outer - 2, bounds.inner + 2, a0, a1);
                const textLength = span.segment.label.length * fontUnits * 0.6;
                const fits = bounds.mid * (a1 - a0) > textLength + fontUnits * 1.5 && bounds.band > fontUnits * 1.25;
                const middle = (a0 + a1) / 2;
                const flipped = middle > Math.PI / 2 && middle < (3 * Math.PI) / 2;
                const pathId = `label-${station.id}-${span.start}`;
                return (
                  <g key={`${span.segment.start_at}-${span.segment.state}`} className={`segment segment-${kind}`}>
                    <path d={d} className="segment-fill" />
                    {kind === "booked" ? <path d={d} className="segment-hatch" fill="url(#hatch)" /> : null}
                    {fits ? (
                      <>
                        <path id={pathId} d={arc(bounds.mid - (flipped ? -fontUnits * 0.35 : fontUnits * 0.35), a0, a1, flipped)} fill="none" stroke="none" />
                        <text className="segment-label" fontSize={fontUnits}>
                          <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{span.segment.label}</textPath>
                        </text>
                      </>
                    ) : null}
                  </g>
                );
              })}
              {props.arc && props.arc.stationId === station.id && props.arc.end > props.arc.start ? (
                <path
                  className="claim-arc"
                  d={sector(bounds.outer - 1, bounds.inner + 1, angleOf(Math.max(0, props.arc.start), dayMinutes), angleOf(props.arc.end, dayMinutes))}
                  fillOpacity={props.arc.fill}
                />
              ) : null}
              {focused ? <path className="ring-focus" d={sector(bounds.outer + 3, bounds.inner - 3, 0, 2 * Math.PI)} /> : null}
            </g>
          );
        })}
        {props.note ? (() => {
          const index = props.stations.findIndex((station) => station.id === props.note?.stationId);
          const [x, y] = point(ring(Math.max(0, index), count).mid, angleOf(clip(props.note.minute), dayMinutes));
          const width = props.note.text.length * fontUnits * 0.62 + fontUnits;
          return (
            <g className="blocker-note" aria-hidden="true">
              <rect x={x - width / 2} y={y - fontUnits * 0.85} width={width} height={fontUnits * 1.7} />
              <text x={x} y={y} fontSize={fontUnits}>{props.note.text}</text>
            </g>
          );
        })() : null}
      </svg>
      {props.children}
    </div>
  );
}
