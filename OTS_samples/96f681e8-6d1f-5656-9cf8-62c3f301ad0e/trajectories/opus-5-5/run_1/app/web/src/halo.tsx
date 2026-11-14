import { useEffect, useRef, useState } from "preact/hooks";
import { mmss, useReducedMotion } from "./lib";

/** A hold's time as last read from the server, running on elapsed time since that answer. */
export type HoldClock = { remainingMs: number; at: number; totalMs: number };

export function clockFrom(remainingMs: number, totalMs: number): HoldClock {
  return { remainingMs, at: performance.now(), totalMs };
}

export function remainingOf(c: HoldClock) {
  return Math.max(0, c.remainingMs - (performance.now() - c.at));
}

const SEGMENTS = 10;
const GAP = 2;

function ringImage(r: number, segments: number | null) {
  if (segments === null) {
    const a = ((1 - r) * 360).toFixed(2);
    return `conic-gradient(from 0deg, transparent 0deg ${a}deg, currentColor ${a}deg 360deg)`;
  }
  const stops: string[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const from = i * 36;
    const shown = i >= SEGMENTS - segments;
    const color = shown ? "currentColor" : "transparent";
    stops.push(`transparent ${from}deg ${from + GAP}deg`, `${color} ${from + GAP}deg ${from + 36 - GAP}deg`, `transparent ${from + 36 - GAP}deg ${from + 36}deg`);
  }
  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

/**
 * The countdown halo: a 4 px ring on the outer edge of its parent that empties
 * clockwise from 12 o'clock with the server's remaining time.
 */
export function Halo({ clock, shape, onZero }: { clock: HoldClock; shape: "disc" | "cell"; onZero?: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [gone, setGone] = useState(false);
  const zero = useRef(onZero);
  zero.current = onZero;
  useEffect(() => {
    setGone(false);
    let fired = false;
    const paint = () => {
      const el = ref.current;
      const left = remainingOf(clock);
      if (left <= 0) {
        if (!fired) {
          fired = true;
          setGone(true);
          zero.current?.();
        }
        return;
      }
      if (!el) return;
      const r = Math.min(1, left / clock.totalMs);
      const segments = reduced ? Math.min(SEGMENTS, Math.ceil(left / 60000)) : null;
      el.style.backgroundImage = ringImage(r, segments);
      el.dataset.haloRemaining = r.toFixed(3);
      el.dataset.haloTone = left <= 60000 ? "ink" : "lime";
      if (segments === null) delete el.dataset.haloSegments;
      else el.dataset.haloSegments = String(segments);
    };
    paint();
    const id = window.setInterval(paint, 100);
    return () => window.clearInterval(id);
  }, [clock, reduced]);
  if (gone) return null;
  return <span ref={ref} class={`halo halo-${shape}`} aria-hidden="true" />;
}

/** The hold badge text, mm:ss rounded up to the next whole second. */
export function Countdown({ clock }: { clock: HoldClock }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, [clock]);
  return <>{mmss(remainingOf(clock))}</>;
}
