/**
 * SVG path morphs: the cart icon turns into a check mark and back (600 ms in all), the wishlist outline turns into a
 * filled heart (300 ms). Both interpolate the `d` attribute per animation frame, driven by frame timestamps.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "../lib/hooks";

type Point = [number, number];

const POINTS = 40;
const CART_D = "M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12";
const CART_OUTLINE: Point[] = [[2.05, 2.05], [4.05, 2.05], [6.71, 14.47], [7.2, 15.5], [8.71, 16.05], [18.49, 16.05], [19.8, 15.5], [20.44, 14.48], [22.09, 7.05], [5.12, 7.05]];
const CHECK_OUTLINE: Point[] = [[20, 6], [9, 17], [4, 12]];

function resample(points: Point[], count: number): Point[] {
  const lengths: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    lengths.push((lengths[index - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[lengths.length - 1] as number;
  const out: Point[] = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const at = (total * index) / (count - 1);
    while (segment < points.length - 1 && (lengths[segment] as number) < at) segment += 1;
    const from = points[segment - 1] as Point;
    const to = points[segment] as Point;
    const span = (lengths[segment] as number) - (lengths[segment - 1] as number);
    const mix = span === 0 ? 0 : (at - (lengths[segment - 1] as number)) / span;
    out.push([from[0] + (to[0] - from[0]) * mix, from[1] + (to[1] - from[1]) * mix]);
  }
  return out;
}

const CART = resample(CART_OUTLINE, POINTS);
const CHECK = resample(CHECK_OUTLINE, POINTS);

function heart(scale: number): Point[] {
  const out: Point[] = [];
  for (let index = 0; index <= POINTS; index += 1) {
    const t = (index / POINTS) * Math.PI * 2;
    const x = Math.sin(t) ** 3;
    const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
    out.push([12 + 10 * scale * x, 11.4 - 9.4 * scale * (y - 0.06)]);
  }
  return out;
}

const HEART_OUTLINE = heart(0.84);
const HEART_FILLED = heart(1);
const HEART_D = polyline(HEART_OUTLINE);

function polyline(points: Point[]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");
}

function blend(from: Point[], to: Point[], amount: number): string {
  return polyline(from.map((point, index) => [point[0] + ((to[index] as Point)[0] - point[0]) * amount, point[1] + ((to[index] as Point)[1] - point[1]) * amount]));
}

const easeOut = (x: number): number => 1 - (1 - x) ** 3;

/** 0 is the cart, 1 is the check: 150 ms in, 250 ms hold, 200 ms out. */
function cartProgress(elapsed: number): number {
  if (elapsed < 150) return easeOut(elapsed / 150);
  if (elapsed < 400) return 1;
  if (elapsed < 600) return 1 - easeOut((elapsed - 400) / 200);
  return 0;
}

const SVG_PROPS = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The cart icon; every time `run` goes up it morphs into a check mark and back. */
export function CartMorphIcon({ run }: { run: number }): ReactNode {
  const body = useRef<SVGPathElement>(null);
  const wheels = useRef<SVGGElement>(null);
  const reduced = useReducedMotion();
  const seen = useRef(run);

  useEffect(() => {
    if (seen.current === run) return undefined;
    seen.current = run;
    const path = body.current as SVGPathElement;
    const group = wheels.current as SVGGElement;
    let start: number | null = null;
    let frame = 0;
    const paint = (progress: number): void => {
      path.setAttribute("d", progress === 0 ? CART_D : blend(CART, CHECK, progress));
      group.style.opacity = String(1 - progress);
    };
    const tick = (now: number): void => {
      start ??= now;
      const elapsed = now - start;
      if (elapsed >= 600) {
        paint(0);
        return;
      }
      paint(reduced ? 1 : cartProgress(elapsed));
      frame = requestAnimationFrame(tick);
    };
    paint(reduced ? 1 : 0);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      paint(0);
    };
  }, [run, reduced]);

  return (
    <svg {...SVG_PROPS}>
      <g ref={wheels}>
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
      </g>
      <path ref={body} d={CART_D} />
    </svg>
  );
}

/** The wishlist heart: an outline that morphs into a filled heart when `saved` turns on, and back when it turns off. */
export function HeartMorphIcon({ saved }: { saved: boolean }): ReactNode {
  const body = useRef<SVGPathElement>(null);
  const reduced = useReducedMotion();
  const shown = useRef(saved ? 1 : 0);

  useEffect(() => {
    const path = body.current as SVGPathElement;
    const paint = (progress: number): void => {
      shown.current = progress;
      path.setAttribute("d", blend(HEART_OUTLINE, HEART_FILLED, progress));
      path.style.fillOpacity = String(progress);
    };
    const goal = saved ? 1 : 0;
    if (reduced || shown.current === goal) {
      paint(goal);
      return undefined;
    }
    const origin = shown.current;
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number): void => {
      start ??= now;
      const amount = Math.min(1, (now - start) / 300);
      paint(origin + (goal - origin) * easeOut(amount));
      if (amount < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [saved, reduced]);

  return (
    <svg {...SVG_PROPS}>
      <path ref={body} d={HEART_D} fill="currentColor" fillOpacity={saved ? 1 : 0} />
    </svg>
  );
}
