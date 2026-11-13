// The bar ruler: a staff of per-bar ticks, numbered bars at the viewport's label interval, boxed
// rehearsal letters, and each stored cut collapsed to a four-pixel splice mark.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Cut, WorkDetail } from "../../shared/api";

const SPLICE_WIDTH = 4;
const LABEL_CHAR_PX = 7.2;

/** The splice in progress: `collapse` 0 is the full span, 1 the four-pixel mark; `hatch` covers 0..1 of it. */
export interface SpliceFrame {
  from: number;
  to: number;
  collapse: number;
  hatch: number;
}

export interface Span {
  from: number;
  to: number;
}

export interface RulerSelection {
  caret: number;
  anchor: number | null;
}

/** Bar numbers print on bar 1 and every 10th, 25th or 50th bar by the viewport's width. */
function labelInterval(viewportWidth: number): number {
  if (viewportWidth >= 1280) return 10;
  if (viewportWidth >= 768) return 25;
  return 50;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const update = (): void => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

function inCut(cuts: Span[], bar: number): Span | undefined {
  return cuts.find((cut) => cut.from <= bar && bar <= cut.to);
}

/** Left edge of every bar (index = bar, 1-based) and the end, for the pane width and the cuts. */
function barEdges(bars: number, width: number, cuts: Span[], frame: SpliceFrame | null): number[] {
  const unit = bars > 0 ? width / bars : 0;
  const edges = new Array<number>(bars + 2).fill(0);
  let x = 0;
  for (let bar = 1; bar <= bars; bar++) {
    edges[bar] = x;
    const cut = inCut(cuts, bar);
    if (!cut) {
      x += unit;
    } else if (frame && frame.from === cut.from && frame.to === cut.to) {
      const full = (cut.to - cut.from + 1) * unit;
      x += (full + (SPLICE_WIDTH - full) * frame.collapse) / (cut.to - cut.from + 1);
    } else if (bar === cut.to) {
      x += SPLICE_WIDTH;
    }
  }
  edges[bars + 1] = x;
  return edges;
}

interface RulerProps {
  work: WorkDetail;
  /** The cuts the ruler draws (the stored ones, plus or minus one while it splices). */
  cuts: Span[];
  frame: SpliceFrame | null;
  selection: RulerSelection;
  onSelection: (next: RulerSelection) => void;
  onCommit: (span: Span) => void;
  onRestore: (cut: Cut, opener: HTMLButtonElement) => void;
  sliderRef: React.RefObject<HTMLDivElement | null>;
}

export function Ruler({ work, cuts, frame, selection, onSelection, onCommit, onRestore, sliderRef }: RulerProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const viewport = useViewportWidth();
  const dragging = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bars = work.bars;
  const settled = cuts.filter((cut) => !(frame && frame.from === cut.from && frame.to === cut.to));
  const edges = barEdges(bars, width, cuts, frame);
  const interval = labelInterval(viewport);
  const spliceOf = (bar: number): Span | undefined => inCut(settled, bar);

  const uncut = (bar: number): boolean => !inCut(cuts, bar);
  const step = (from: number, direction: 1 | -1): number => {
    let bar = from + direction;
    while (bar >= 1 && bar <= bars && !uncut(bar)) bar += direction;
    return bar >= 1 && bar <= bars ? bar : from;
  };
  const firstUncut = (): number => (uncut(1) ? 1 : step(1, 1));
  const lastUncut = (): number => (uncut(bars) ? bars : step(bars, -1));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const { caret, anchor } = selection;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) {
        const next = caret + direction;
        const blocked = next < 1 || next > bars || !uncut(next);
        onSelection({ caret: blocked ? caret : next, anchor: anchor ?? caret });
      } else {
        onSelection({ caret: step(caret, direction), anchor: null });
      }
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onSelection({ caret: event.key === "Home" ? firstUncut() : lastUncut(), anchor: null });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (anchor !== null) onCommit({ from: Math.min(anchor, caret), to: Math.max(anchor, caret) });
    } else if (event.key === "Escape") {
      if (anchor !== null) event.preventDefault();
      onSelection({ caret, anchor: null });
    }
  };

  const barAt = (clientX: number): number => {
    const left = stage.current?.getBoundingClientRect().left ?? 0;
    const x = clientX - left;
    let bar = 1;
    while (bar < bars && (edges[bar + 1] ?? 0) <= x) bar++;
    return bar;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const bar = barAt(event.clientX);
    if (!uncut(bar)) return;
    dragging.current = bar;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelection({ caret: bar, anchor: null });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragging.current;
    if (start === null) return;
    const target = barAt(event.clientX);
    const direction = target >= start ? 1 : -1;
    let bar = start;
    while (bar !== target && uncut(bar + direction)) bar += direction;
    onSelection(bar === start ? { caret: start, anchor: null } : { caret: bar, anchor: start });
  };

  const onPointerUp = (): void => {
    dragging.current = null;
  };

  const lo = selection.anchor === null ? null : Math.min(selection.anchor, selection.caret);
  const hi = selection.anchor === null ? null : Math.max(selection.anchor, selection.caret);
  const valueText = lo !== null && hi !== null ? `Bars ${lo}–${hi} selected` : `Bar ${selection.caret}`;

  const labels: { bar: number; x: number }[] = [];
  let lastRight = -Infinity;
  for (let bar = 1; bar <= bars; bar++) {
    if (bar !== 1 && bar % interval !== 0) continue;
    if (spliceOf(bar)) continue;
    const textWidth = String(bar).length * LABEL_CHAR_PX;
    const x = Math.min(Math.max(edges[bar] ?? 0, textWidth / 2), Math.max(width - textWidth / 2, 0));
    if (x - textWidth / 2 < lastRight + 1) continue;
    labels.push({ bar, x });
    lastRight = x + textWidth / 2;
  }

  let ticks = "";
  let longTicks = "";
  for (let bar = 1; bar <= bars; bar++) {
    if (spliceOf(bar)) continue;
    const x = Math.round(edges[bar] ?? 0) + 0.5;
    if (bar === 1 || bar % interval === 0) longTicks += `M${x} 0V30`;
    else ticks += `M${x} 10V30`;
  }

  const animatingOpacity = (bar: number): number =>
    frame && frame.from <= bar && bar <= frame.to ? 1 - frame.collapse : 1;

  return (
    <div className="ruler">
      <div className="ruler__stage" ref={stage}>
        <div
          ref={sliderRef}
          className="ruler__track"
          role="slider"
          tabIndex={0}
          aria-label="Bar ruler"
          aria-valuemin={1}
          aria-valuemax={bars}
          aria-valuenow={selection.caret}
          aria-valuetext={valueText}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="ruler__letters" aria-hidden="true">
            {work.rehearsal_letters
              .filter((letter) => !spliceOf(letter.bar) && animatingOpacity(letter.bar) > 0)
              .map((letter) => (
                <span
                  key={letter.letter}
                  className="ruler__letter"
                  style={{ left: `${edges[letter.bar] ?? 0}px`, opacity: animatingOpacity(letter.bar) }}
                >
                  {letter.letter}
                </span>
              ))}
          </div>
          <svg className="ruler__ticks" width={Math.max(width, 1)} height="30" aria-hidden="true">
            <path d={ticks} className="ruler__tick" />
            <path d={longTicks} className="ruler__tick ruler__tick--long" />
          </svg>
          {lo !== null && hi !== null && (
            <div
              className="ruler__selection"
              style={{ left: `${edges[lo] ?? 0}px`, width: `${Math.max((edges[hi + 1] ?? 0) - (edges[lo] ?? 0), 2)}px` }}
            />
          )}
          {frame && (
            <svg
              className="ruler__hatch"
              aria-hidden="true"
              style={{ left: `${edges[frame.from] ?? 0}px` }}
              width={Math.max(((edges[frame.to + 1] ?? 0) - (edges[frame.from] ?? 0)) * frame.hatch, 0)}
              height="30"
            >
              <defs>
                <pattern id="ruler-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#ruler-hatch)" />
            </svg>
          )}
          <div
            className="ruler__caret"
            aria-hidden="true"
            style={{ left: `${(edges[selection.caret] ?? 0) + Math.max(((edges[selection.caret + 1] ?? 0) - (edges[selection.caret] ?? 0)) / 2 - 1, 0)}px` }}
          />
          <div className="ruler__numbers" aria-hidden="true">
            {labels.map((label) => (
              <span key={label.bar} className="ruler__number" style={{ left: `${label.x}px` }}>
                {label.bar}
              </span>
            ))}
          </div>
        </div>
        {settled.map((span) => {
          const cut = work.cuts.find((c) => c.from_bar === span.from && c.to_bar === span.to);
          const x = edges[span.from] ?? 0;
          const left = `${x + SPLICE_WIDTH / 2}px`;
          return (
            <Fragment key={`${span.from}-${span.to}`}>
              <button
                type="button"
                className="splice"
                style={{ left }}
                aria-label={`Restore bars ${span.from}–${span.to}`}
                onClick={(event) => cut && onRestore(cut, event.currentTarget)}
              >
                <span className="splice__mark" aria-hidden="true" />
              </button>
              <span className="splice__label" style={{ left }}>
                <i>vi–de</i> <span className="mono">{span.from}</span>–<span className="mono">{span.to}</span>
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
