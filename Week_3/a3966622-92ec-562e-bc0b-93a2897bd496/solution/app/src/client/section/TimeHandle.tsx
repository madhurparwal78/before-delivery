// The time handle: a slider over the day's existing 5-minute steps, by keyboard, pointer and touch.
// The strip under it marks exactly the open windows the server returned.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clockText, minuteOfDay, STEP_MINUTES, type HandleKey } from "../../shared/portTime";

const DAY_LAST = 24 * 60 - STEP_MINUTES;

const KEYS: Record<string, HandleKey> = {
  ArrowLeft: "previous",
  ArrowDown: "previous",
  ArrowRight: "next",
  ArrowUp: "next",
  PageDown: "earlier30",
  PageUp: "later30",
  Home: "first",
  End: "last",
};

interface TimeHandleProps {
  minutes: number;
  windows: { from: string; to: string }[] | null;
  onKey: (key: HandleKey) => void;
  onPoint: (minutes: number) => void;
}

const percent = (minutes: number): string => `${(minutes / DAY_LAST) * 100}%`;

export function TimeHandle({ minutes, windows, onKey, onPoint }: TimeHandleProps) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const value = useRef<HTMLSpanElement>(null);
  // Widths in px of the track and the handle's value label, so a tick label is hidden when it would
  // sit under the value label (closer than the label's width plus 8 px), at any track width.
  const [px, setPx] = useState({ track: 0, label: 0 });
  useEffect(() => {
    const box = track.current;
    const label = value.current;
    if (!box || !label) return;
    const observer = new ResizeObserver(() => setPx({ track: box.clientWidth, label: label.offsetWidth }));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const clashes = (tick: number): boolean => {
    if (!px.track) return Math.abs(tick - minutes) <= 100;
    const at = (m: number): number => (m / DAY_LAST) * px.track;
    const left = Math.min(Math.max(at(minutes) - px.label / 2, 0), px.track - px.label);
    const tickLeft = at(tick);
    const tickRight = tickLeft + 3 + px.label;
    return left < tickRight + 8 && left + px.label + 8 > tickLeft;
  };

  const pointAt = (clientX: number): void => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    onPoint(Math.round((fraction * DAY_LAST) / STEP_MINUTES) * STEP_MINUTES);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const key = KEYS[event.key];
    if (!key) return;
    event.preventDefault();
    onKey(key);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    pointAt(event.clientX);
  };

  return (
    <div
      ref={track}
      className="handle"
      role="slider"
      tabIndex={0}
      aria-label="Boarding time"
      aria-valuemin={0}
      aria-valuemax={DAY_LAST}
      aria-valuenow={minutes}
      aria-valuetext={`${clockText(minutes)} port time`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => dragging.current && pointAt(event.clientX)}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <div className="handle-track" aria-hidden="true">
        {(windows ?? []).map((w) => {
          const from = minuteOfDay(w.from) ?? 0;
          const to = (minuteOfDay(w.to) ?? 0) + STEP_MINUTES;
          return <span key={w.from} className="handle-window" style={{ left: percent(from), width: percent(to - from) }} />;
        })}
        {[0, 360, 720, 1080].filter((m) => !clashes(m)).map((m) => (
          <span key={m} className="handle-tick" style={{ left: percent(m) }}>
            <span className="num">{clockText(m)}</span>
          </span>
        ))}
      </div>
      <span className="handle-thumb" style={{ left: percent(minutes) }} aria-hidden="true" />
      <span ref={value} className="handle-value num" style={{ left: `clamp(0px, calc(${percent(minutes)} - 2.5ch), calc(100% - 5ch))` }} aria-hidden="true">
        {clockText(minutes)}
      </span>
    </div>
  );
}
