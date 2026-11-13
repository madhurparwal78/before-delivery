// group "Histogram": one button per bucket, Bucket Brush by drag or Shift+arrows, bars that settle when they change.
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { EASE_OUT, play } from "../../lib/motion";
import type { Bucket } from "./model";

const WELL_PX = 96;

export interface HistogramHandle {
  focus: () => void;
}

interface Props {
  interval: string;
  buckets: Bucket[];
  onBrush: (from: string, to: string) => void;
}

const barHeight = (count: number, max: number): number => (max === 0 ? 2 : Math.max(2, Math.round((count / max) * WELL_PX)));

export const Histogram = forwardRef<HistogramHandle, Props>(function Histogram({ interval, buckets, onBrush }, handle) {
  const group = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState(0);
  const [selection, setSelection] = useState<{ anchor: number; head: number } | null>(null);
  const dragging = useRef(false);
  const refocus = useRef(false);
  const previous = useRef<{ key: string; heights: number[] } | null>(null);
  const max = Math.max(0, ...buckets.map((b) => b.count));
  const heights = buckets.map((b) => barHeight(b.count, max));
  const key = buckets.map((b) => b.start).join("|");

  useImperativeHandle(handle, () => ({
    focus: () => group.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus(),
  }));

  useLayoutEffect(() => {
    const bars = group.current?.querySelectorAll<HTMLElement>(".bar") ?? [];
    const old = previous.current;
    if (old && old.key !== key) {
      bars.forEach((bar, k) => {
        const from = old.heights[k] ?? 0;
        const to = heights[k] ?? 0;
        if (from !== to) play(bar, "bar-settle", [{ height: `${from}px` }, { height: `${to}px` }], 200, EASE_OUT);
      });
    }
    previous.current = { key, heights };
    setFocusAt((current) => (current < buckets.length ? current : 0));
    if (refocus.current) {
      refocus.current = false;
      setFocusAt(0);
      group.current?.querySelector<HTMLElement>("button")?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const range = (s: { anchor: number; head: number }): [number, number] => [Math.min(s.anchor, s.head), Math.max(s.anchor, s.head)];
  const selected = (k: number): boolean => selection !== null && k >= range(selection)[0] && k <= range(selection)[1];

  const apply = (from: number, to: number): void => {
    const first = buckets[from];
    const last = buckets[to];
    if (!first || !last) return;
    refocus.current = true;
    setSelection(null);
    onBrush(first.start, last.end);
  };

  const indexAt = (x: number, y: number): number | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-bucket]");
    return hit && group.current?.contains(hit) ? Number(hit.dataset.bucket) : null;
  };

  const onPointerDown = (event: React.PointerEvent, k: number): void => {
    if (event.button !== 0) return;
    dragging.current = true;
    setFocusAt(k);
    setSelection({ anchor: k, head: k });
    const finish = (): void => {
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (!dragging.current) return;
      dragging.current = false;
      setSelection((current) => {
        if (current) apply(...range(current));
        return null;
      });
    };
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    if (!dragging.current) return;
    const at = indexAt(event.clientX, event.clientY);
    if (at !== null) setSelection((current) => (current ? { anchor: current.anchor, head: at } : current));
  };

  const onKeyDown = (event: React.KeyboardEvent, k: number): void => {
    const move = (to: number, extend: boolean): void => {
      event.preventDefault();
      const next = Math.max(0, Math.min(buckets.length - 1, to));
      setFocusAt(next);
      setSelection(extend ? { anchor: selection?.anchor ?? k, head: next } : selection);
      group.current?.querySelector<HTMLElement>(`[data-bucket="${next}"]`)?.focus();
    };
    if (event.key === "ArrowRight") move(k + 1, event.shiftKey);
    else if (event.key === "ArrowLeft") move(k - 1, event.shiftKey);
    else if (event.key === "Enter") {
      event.preventDefault();
      const [from, to] = selection ? range(selection) : [k, k];
      apply(from, to);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSelection(null);
    }
  };

  return (
    <div className="histogram">
      <p className="interval mono small">Interval: {interval}</p>
      <div ref={group} role="group" aria-label="Histogram" className="histogram-well" onPointerMove={onPointerMove}>
        {buckets.map((bucket, k) => (
          <button
            key={bucket.start}
            type="button"
            data-bucket={k}
            data-selected={selected(k) ? "true" : undefined}
            tabIndex={focusAt === k ? 0 : -1}
            aria-label={`Bucket ${bucket.label}, ${bucket.count} ${bucket.count === 1 ? "event" : "events"}`}
            className="bucket"
            onPointerDown={(event) => onPointerDown(event, k)}
            onKeyDown={(event) => onKeyDown(event, k)}
            onFocus={() => setFocusAt(k)}
          >
            <span className="bar" style={{ height: `${heights[k]}px` }} />
          </button>
        ))}
      </div>
      {buckets.length > 0 ? (
        <p className="histogram-axis mono small muted"><span>{buckets[0]?.label}</span><span>{buckets[buckets.length - 1]?.label}</span></p>
      ) : null}
    </div>
  );
});

/** The histogram's own box at its final height while the buckets load, so the grid below does not move when they arrive. */
export function HistogramPlaceholder() {
  return (
    <div className="histogram" aria-hidden="true">
      <p className="interval mono small">{"\u00a0"}</p>
      <div className="histogram-well" />
      <p className="histogram-axis mono small muted"><span>{"\u00a0"}</span></p>
    </div>
  );
}
