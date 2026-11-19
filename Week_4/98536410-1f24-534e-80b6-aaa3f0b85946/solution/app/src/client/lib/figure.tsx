// An animated figure: counts from its old value to the new one in tabular figures. data-value holds
// the final value from the first frame; data-counting is true until the final value shows.
import { useLayoutEffect, useRef } from "react";
import { MOTION, easeOutCubic, reducedMotion } from "./motion";
import { formatEuro, formatKm } from "./format";

type FigureKind =
  | "legend-count" | "critical-lines" | "cart-total" | "checkout-total" | "order-total" | "on-hand" | "held"
  | "available" | "distance" | "shop-available" | "review-count" | "review-badge" | "slot-count";

type Unit = "euro" | "count" | "km";

function render(unit: Unit, value: number): string {
  if (unit === "euro") return formatEuro(Math.round(value));
  if (unit === "km") return formatKm(value);
  return String(Math.round(value));
}

function dataValue(unit: Unit, value: number): string {
  return unit === "km" ? formatKm(value) : String(value);
}

interface FigureProps {
  kind: FigureKind;
  value: number;
  unit?: Unit;
  className?: string;
}

export function Figure({ kind, value, unit = "count", className }: FigureProps) {
  const node = useRef<HTMLSpanElement | null>(null);
  const shown = useRef<number | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const counting = useRef(false);

  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return undefined;
    window.cancelAnimationFrame(frame.current ?? 0);
    element.setAttribute("data-value", dataValue(unit, value));
    const from = shown.current;
    if (from === null || reducedMotion() || (from === value && !counting.current)) {
      shown.current = value;
      counting.current = false;
      element.textContent = render(unit, value);
      element.setAttribute("data-counting", "false");
      return undefined;
    }
    counting.current = true;
    element.setAttribute("data-counting", "true");
    let started: number | null = null;
    const step = (now: number) => {
      started ??= now;
      const progress = Math.min(1, (now - started) / MOTION.figureMs);
      const current = from + (value - from) * easeOutCubic(progress);
      shown.current = progress >= 1 ? value : current;
      element.textContent = render(unit, shown.current);
      if (progress >= 1) {
        counting.current = false;
        element.setAttribute("data-counting", "false");
      } else frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame.current ?? 0);
  }, [value, unit]);

  return <span ref={node} className={className ? `figure ${className}` : "figure"} data-figure={kind} />;
}
