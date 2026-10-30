// Frame Odometer (brief: Motion and effects). Each digit is a vertical strip; a changed column travels through
// every intermediate digit. The rightmost column starts first, each column to its left 40 ms later; one digit
// takes 300 ms, nine take 800 ms; fast start, soft settle. Reduced motion: figures change at once.

import { useLayoutEffect, useRef } from "react";
import { frames, money } from "../shared/format.js";

const CELL_EM = 1.15;
const STAGGER_MS = 40;
const MIN_COLUMN_MS = 160;
const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const DASH_DIGITS = ["–", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DIGITS = DASH_DIGITS.slice(1);
const TENS = [" ", "1", "2"];

type Cell = { key: string; glyphs: string[]; index: number } | { key: string; char: string };

type OdometerKind = "frames" | "money";

function digitMs(travel: number): number {
  return travel === 0 ? 0 : 300 + (travel - 1) * 62.5;
}

function cells(kind: OdometerKind, value: number | null): Cell[] {
  if (kind === "frames") {
    if (value === null) return [{ key: "t", glyphs: TENS, index: 0 }, { key: "o", glyphs: DASH_DIGITS, index: 0 }, { key: ".", char: "." }, { key: "d", glyphs: DASH_DIGITS, index: 0 }];
    return [
      { key: "t", glyphs: TENS, index: Math.trunc(value / 100) },
      { key: "o", glyphs: DASH_DIGITS, index: (Math.trunc(value / 10) % 10) + 1 },
      { key: ".", char: "." },
      { key: "d", glyphs: DASH_DIGITS, index: (value % 10) + 1 },
    ];
  }
  const text = money(value ?? 0);
  let digit = 0;
  let other = 0;
  return [...text]
    .reverse()
    .map((char): Cell => (/\d/.test(char) ? { key: `d${digit++}`, glyphs: DIGITS, index: Number(char) } : { key: `s${other++}`, char }))
    .reverse();
}

function formatValue(kind: OdometerKind, value: number | null): string {
  if (kind === "money") return money(value ?? 0);
  return value === null ? "no samples" : frames(value);
}

/** The natural length of a roll from one value to another, in ms (stagger plus the longest column). */
export function rollSpan(kind: OdometerKind, from: number | null, to: number | null): number {
  const before = new Map(cells(kind, from).flatMap((cell) => ("glyphs" in cell ? [[cell.key, cell.index] as const] : [])));
  const columns = cells(kind, to).filter((cell): cell is Extract<Cell, { glyphs: string[] }> => "glyphs" in cell).reverse();
  return Math.max(0, ...columns.map((cell, position) => {
    const travel = Math.abs(cell.index - (before.get(cell.key) ?? 0));
    return travel === 0 ? 0 : position * STAGGER_MS + digitMs(travel);
  }));
}

/** Scale factor that fits a roll inside `budget` ms. */
function scaleFor(span: number, budget: number | undefined): number {
  return budget === undefined || span <= budget || span === 0 ? 1 : Math.max(0.05, budget / span);
}

interface OdometerProps {
  kind: OdometerKind;
  value: number | null;
  /** ms to wait before the first column moves. */
  delay?: number;
  /** ms the whole roll must fit in, counted from its first movement. */
  budget?: number;
  dim?: boolean;
  reduced: boolean;
  className?: string;
}

export function Odometer({ kind, value, delay = 0, budget, dim = false, reduced, className }: OdometerProps) {
  const strips = useRef(new Map<string, HTMLSpanElement>());
  const shown = useRef(new Map<string, number>());
  const mounted = useRef(false);
  const layout = cells(kind, value);

  useLayoutEffect(() => {
    const columns = layout.filter((cell): cell is Extract<Cell, { glyphs: string[] }> => "glyphs" in cell).reverse();
    const plan = columns.map((cell, position) => {
      const strip = strips.current.get(cell.key);
      let from = shown.current.get(cell.key) ?? 0;
      if (strip && strip.getAnimations().length > 0) {
        const height = strip.parentElement?.clientHeight || 1;
        from = -new DOMMatrixReadOnly(getComputedStyle(strip).transform).m42 / height;
        strip.getAnimations().forEach((animation) => animation.cancel());
      }
      shown.current.set(cell.key, cell.index);
      return { strip, from, to: cell.index, position };
    });
    const first = !mounted.current;
    mounted.current = true;
    if (reduced || first) return;
    const span = Math.max(0, ...plan.map((step) => (Math.abs(step.to - step.from) < 0.01 ? 0 : step.position * STAGGER_MS + digitMs(Math.ceil(Math.abs(step.to - step.from))))));
    const scale = scaleFor(span, budget);
    for (const step of plan) {
      const travel = Math.abs(step.to - step.from);
      if (!step.strip || travel < 0.01) continue;
      step.strip.animate([{ transform: `translateY(${-step.from * CELL_EM}em)` }, { transform: `translateY(${-step.to * CELL_EM}em)` }], {
        duration: scale === 1 ? digitMs(Math.ceil(travel)) : Math.max(MIN_COLUMN_MS, digitMs(Math.ceil(travel)) * scale),
        delay: delay + step.position * STAGGER_MS * scale,
        easing: EASING,
        fill: "backwards",
      });
    }
    // Runs only when the value changes; the plan reads the strips where they stand at that moment.
  }, [value, kind]);

  return (
    <span className={`odometer${dim ? " is-provisional" : ""}${className ? ` ${className}` : ""}`}>
      <span className="odometer-digits" aria-hidden="true">
        {layout.map((cell) =>
          "glyphs" in cell ? (
            <span className={`odo-col${cell.glyphs === TENS && cell.index === 0 ? " is-blank" : ""}`} key={cell.key}>
              <span
                className="odo-strip"
                data-glyphs={cell.glyphs.join("\n")}
                style={{ transform: `translateY(${-cell.index * CELL_EM}em)` }}
                ref={(element) => {
                  if (element) strips.current.set(cell.key, element);
                  else strips.current.delete(cell.key);
                }}
              />
            </span>
          ) : (
            <span className="odo-static" key={cell.key}>
              {cell.char}
            </span>
          ),
        )}
      </span>
      <span className="sr-only">{formatValue(kind, value)}</span>
    </span>
  );
}
