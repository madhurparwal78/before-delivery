// Megalitre figures: tabular numerals with the unit in its own column so stacks align on the point,
// and the 0.6 s count-up the brief names for confirmed strokes and the board's detail counters.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { fromMilli, toMilli, useReducedMotion } from "../lib.ts";

const COUNT_MS = 600;
// Cubic ease-out: starts quickly and settles gently.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Shows `value` (a three-decimal string); when it changes, counts from the old value over 0.6 s.
 * The text is written straight to the DOM on each animation frame so it follows the page clock. */
function CountUp({ value }: { value: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const span = ref.current!;
    const write = (text: string) => {
      shown.current = text;
      span.textContent = text;
    };
    if (reduced || shown.current === value || span.textContent === "") return write(value);
    const from = toMilli(shown.current);
    const to = toMilli(value);
    const started = performance.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - started) / COUNT_MS);
      write(t >= 1 ? value : fromMilli(from + ((to - from) * BigInt(Math.round(easeOut(t) * 1000))) / 1000n));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      write(value);
    };
  }, [value, reduced]);
  return <span ref={ref} />;
}

interface FigureProps {
  label: string;
  value: string;
  unit: string;
  size?: "xl" | "lg" | "md";
  animate?: boolean;
  tone?: "alert";
}

/** A labelled figure (`group "<label>"`): label above, figure and unit on one aligned line. */
export function Figure({ label, value, unit, size = "md", animate = false, tone }: FigureProps) {
  return (
    <div role="group" aria-label={label} className={`figure figure-${size}${tone ? ` figure-${tone}` : ""}`}>
      <span className="figure-label">{label}</span>
      <span className="figure-value num">{animate ? <CountUp value={value} /> : value}</span>
      <span className="figure-unit">{unit}</span>
    </div>
  );
}

export function FigureStack({ children }: { children: ReactNode }) {
  return <div className="figure-stack">{children}</div>;
}
