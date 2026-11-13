import { useLayoutEffect, useRef } from "preact/hooks";
import { prefersReducedMotion } from "./time";
import type { ClockEntry } from "./types";

/** A time drawn digit by digit in fixed-width cells, so the columns hold steady as digits change. */
export function Digits({ text }: { text: string }) {
  const previous = useRef(text);
  const cells = useRef<(HTMLElement | null)[]>([]);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = text;
    if (before === text || prefersReducedMotion()) return;
    const up = text > before;
    [...text].forEach((ch, i) => {
      if (ch === before[i] || ch === ":") return;
      cells.current[i]?.animate(
        [
          { transform: `translateY(${up ? "55%" : "-55%"})`, opacity: 0.1 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 200, easing: "cubic-bezier(.3,.9,.3,1)" },
      );
    });
  });
  return (
    <span class="tc-digits" aria-hidden="true">
      {[...text].map((ch, i) => (
        <span class={ch === ":" ? "dg dg-colon" : "dg"} key={i}>
          <span class="dgi" ref={(el) => (cells.current[i] = el)}>
            {ch}
          </span>
        </span>
      ))}
    </span>
  );
}

interface Props {
  clocks: ClockEntry[];
  /** The ribbon drawn beside a block while it is dragged or resized. */
  ribbon?: boolean;
  /** Where the ribbon came from, so it can travel into the quick dialog's title row. */
  from?: DOMRect | null;
  style?: Record<string, string>;
  /** The date the times are read against, so a clock on another date says so. */
  baseDate?: string;
}

function dayNote(date: string, baseDate?: string): string | null {
  if (!baseDate || date === baseDate) return null;
  return date > baseDate ? "next day" : "previous day";
}

/** Three clocks: New York, London and Auckland, with a working-hours bar under each. */
export function ThreeClocks({ clocks, ribbon, from, style, baseDate }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    if (ribbon) {
      el.animate(
        [
          { transform: "translateX(-28px)", opacity: 0 },
          { transform: "translateX(0)", opacity: 1 },
        ],
        { duration: 330, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
      );
    } else if (from) {
      const to = el.getBoundingClientRect();
      el.animate(
        [
          { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 330, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
      );
    }
  }, []);
  return (
    <div role="group" aria-label="Three clocks" class={ribbon ? "tc tc-ribbon" : "tc"} ref={root} style={style}>
      {clocks.map((c) => {
        const note = dayNote(c.date, baseDate);
        return (
        <div
          role="group"
          class="tc-city"
          key={c.city}
          aria-label={`${c.city} ${c.time}, ${c.inside_hours ? "inside" : "outside"} working hours`}
        >
          <Digits text={c.time} />
          <span class="tc-name" aria-hidden="true">
            {c.city}
          </span>
          <span class="tc-bar" data-inside={c.inside_hours ? "yes" : "no"} aria-hidden="true" />
          {note && <span class="tc-note" aria-hidden="true">{note}</span>}
        </div>
        );
      })}
    </div>
  );
}

/** The three-clock line announced under reduced motion. */
export function clockLine(clocks: ClockEntry[]): string {
  return (
    clocks.map((c) => `${c.city} ${c.time} ${c.inside_hours ? "inside" : "outside"} working hours`).join(", ") + "."
  );
}
