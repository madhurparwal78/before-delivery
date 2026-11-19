// The Sightline wedge (from the seat's centre to the stage lip corners) and its readout, with their motion.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LIP_HALF_WIDTH, type HallSeat } from "../../shared/hall.js";
import { readoutLine, type Look } from "./plan.js";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const EDGE_MS = 170;
const GLIDE_MS = 170;
const COUNT_MS = 250;

/** The same fast-then-gentle curve as EASE, for values moved frame by frame. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Moves `value` to `target` over `duration` ms frame by frame; with reduced motion it jumps in one frame. */
function useTween<T>(target: T, from: T, duration: number, mix: (a: T, b: T, t: number) => T, key: string): T {
  const [value, setValue] = useState<T>(reducedMotion() ? target : from);
  const current = useRef(value);
  current.current = value;
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return undefined;
    }
    const start = current.current;
    const began = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - began) / duration);
      setValue(t >= 1 ? target : mix(start, target, easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return value;
}

const mixPoint = (a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } =>
  ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mixNumber = (a: number, b: number, t: number): number => a + (b - a) * t;

export function Wedge({ seat, look }: { seat: HallSeat; look: Look }): JSX.Element {
  const left = useRef<SVGLineElement>(null);
  const right = useRef<SVGLineElement>(null);
  const fill = useRef<SVGPolygonElement>(null);
  const target = { x: seat.x, y: seat.y };
  const apex = useTween(target, target, GLIDE_MS, mixPoint, seat.id);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const timing = (delay: number): KeyframeAnimationOptions => ({ duration: EDGE_MS, delay, easing: EASE, fill: "backwards" });
    const draw: Keyframe[] = [{ strokeDasharray: "1 1", strokeDashoffset: 1 }, { strokeDasharray: "1 1", strokeDashoffset: 0 }];
    left.current?.animate(draw, timing(0));
    right.current?.animate(draw, timing(EDGE_MS));
    fill.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing(2 * EDGE_MS));
  }, []);

  const corners = `${-LIP_HALF_WIDTH},0 ${LIP_HALF_WIDTH},0`;
  return (
    <g class="wedge" data-sightline="" data-seat={seat.id} data-angle={String(seat.offCentreDeg)}
      data-distance={seat.stageDistanceM.toFixed(1)} data-state={look}>
      <polygon ref={fill} data-part="fill" points={`${apex.x},${apex.y} ${corners}`} />
      <line ref={left} data-part="left-edge" pathLength={1} x1={apex.x} y1={apex.y} x2={-LIP_HALF_WIDTH} y2={0} />
      <line ref={right} data-part="right-edge" pathLength={1} x1={apex.x} y1={apex.y} x2={LIP_HALF_WIDTH} y2={0} />
      <polygon class="outline" points={`${apex.x},${apex.y} ${corners}`} />
    </g>
  );
}

/**
 * The readout counts from the previous seat's values (from zero for the first seat) to this seat's. Its state line
 * keeps its height when empty, so hovering seats never moves the controls below the readout.
 */
export function Readout({ seat, look }: { seat: HallSeat; look: Look }): JSX.Element {
  const angle = useTween(seat.offCentreDeg, 0, COUNT_MS, mixNumber, seat.id);
  const distance = useTween(seat.stageDistanceM, 0, COUNT_MS, mixNumber, seat.id);
  const line = readoutLine(look);
  return (
    <div role="group" aria-label="Sightline" class="sightline">
      <p class="kicker">Sightline</p>
      <p class="reading"><span class="fig">{Math.round(angle)}</span>° off centre</p>
      <p class="reading"><span class="fig">{distance.toFixed(1)}</span> m to stage</p>
      <p class="state-line">{line}</p>
      <p class="sightline-seat">from {seat.label}</p>
    </div>
  );
}
