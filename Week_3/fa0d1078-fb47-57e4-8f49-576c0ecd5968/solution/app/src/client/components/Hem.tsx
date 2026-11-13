import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { stitchesLabel } from "../format";
import { reducedMotion } from "../motion";

const STITCH_MS = 240;
const COUNT_MS = 320;
const OPPONENT_STAGGER_MS = 24;
const THREAD_EASING = "cubic-bezier(0.2, 0.9, 0.3, 1)";

interface Place {
  style: Record<string, string>;
  side: "top" | "right" | "bottom" | "left";
}

/** Where stitch `index` of `slots` lies on the ring: slots are spread evenly around the four sides. */
function place(index: number, slots: number): Place {
  const around = ((index + 0.5) / slots) * 4;
  const side = Math.min(3, Math.floor(around));
  const along = (around - side) * 100;
  const length = (0.7 * 400) / slots;
  const start = Math.min(Math.max(along - length / 2, 0), 100 - length);
  switch (side) {
    case 0:
      return { side: "top", style: { left: `${start}%`, top: "0", width: `${length}%` } };
    case 1:
      return { side: "right", style: { top: `${start}%`, left: "100%", height: `${length}%` } };
    case 2:
      return { side: "bottom", style: { left: `${100 - start - length}%`, top: "100%", width: `${length}%` } };
    default:
      return { side: "left", style: { top: `${100 - start - length}%`, left: "0", height: `${length}%` } };
  }
}

const ORIGIN = { top: "left center", right: "center top", bottom: "right center", left: "center bottom" } as const;

interface HemProps {
  id: string;
  name: string;
  stitches: number;
  slots: number;
  variant: "own" | "opponent";
  closed?: boolean;
}

/** The thread around the board: one stitch per correct entry, drawn in with one browser animation each. */
export function Hem({ id, name, stitches, slots, variant, closed = false }: HemProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(stitches);
  const [rendered, setRendered] = useState(stitches);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = stitches;
    if (stitches === before) return;
    const ring = root.current;
    const low = Math.min(before, stitches);
    const grew = stitches > before;
    if (!ring || reducedMotion()) {
      setRendered(stitches);
      return;
    }
    const drawn = Array.from({ length: Math.abs(stitches - before) }, (_, offset) => ring.querySelector<HTMLElement>(`[data-stitch="${low + offset}"]`));
    const animations = drawn.map((stitch, offset) => {
      const axis = stitch?.dataset.side === "top" || stitch?.dataset.side === "bottom" ? "scaleX" : "scaleY";
      return stitch?.animate([{ transform: `${axis}(0)` }, { transform: `${axis}(1)` }], {
        duration: STITCH_MS,
        easing: THREAD_EASING,
        delay: variant === "opponent" ? offset * OPPONENT_STAGGER_MS : 0,
        direction: grew ? "normal" : "reverse",
        fill: grew ? "backwards" : "both",
      });
    });
    if (grew) setRendered(stitches);
    else void Promise.all(animations.map((animation) => animation?.finished)).then(() => setRendered(stitches), () => setRendered(stitches));
  }, [stitches]);
  const shown = Math.max(rendered, stitches);
  return (
    <div id={id} class={`hem hem-${variant}`} role="img" aria-label={`${name}: ${stitchesLabel(stitches)}`} data-stitches={stitches} ref={root}>
      {Array.from({ length: shown }, (_, index) => {
        const spot = place(index, slots);
        return <span key={index} class="stitch" data-stitch={index} data-side={spot.side} style={{ ...spot.style, transformOrigin: ORIGIN[spot.side] }} />;
      })}
      {closed && <span class="hem-loop" />}
    </div>
  );
}

interface CountProps {
  count: number;
}

/** `#hem-count`: the stitch count as text, rolling to a new number in one browser animation. */
export function HemCount({ count }: CountProps): JSX.Element {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(count);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = count;
    if (count === before || reducedMotion()) return;
    const from = count > before ? "70%" : "-70%";
    element.current?.animate([{ transform: `translateY(${from})`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], {
      duration: COUNT_MS,
      easing: THREAD_EASING,
    });
  }, [count]);
  return (
    <span id="hem-count" class="hem-count" ref={element}>
      {count}
    </span>
  );
}
