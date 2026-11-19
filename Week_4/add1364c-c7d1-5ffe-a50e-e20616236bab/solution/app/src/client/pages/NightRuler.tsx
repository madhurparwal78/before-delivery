import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { addDays, officeDate } from "../lib/office";

const NIGHTS = 60;
const HALF = 44;

const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "short" });

/** Offset in effect at a given office midnight (rendering only; the server's as-of answer decides every state). */
function offsetAt(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 6, 0, 0));
  return zone.formatToParts(probe).find((part) => part.type === "timeZoneName")?.value ?? "";
}

function nightText(date: string): string {
  return `${officeDate(date)} ${date.slice(0, 4)}, 00:00 ${offsetAt(date)}`;
}

interface Props { today: string; value: number; onChange: (value: number) => void }

export function NightRuler({ today, value, onChange }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef(false);
  const night = addDays(today, value);

  const fraction = drag ?? (value - 1) / (NIGHTS - 1);

  const keepVisible = () => {
    const box = scroller.current;
    const knob = handle.current;
    if (!box || !knob) return;
    const b = box.getBoundingClientRect();
    const k = knob.getBoundingClientRect();
    if (k.left < b.left + 8) box.scrollLeft -= b.left + 8 - k.left;
    else if (k.right > b.right - 8) box.scrollLeft += k.right - (b.right - 8);
  };

  useEffect(() => { if (!dragging.current) keepVisible(); }, [value]);

  const fromPointer = (clientX: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left - HALF) / (rect.width - HALF * 2)));
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    event.currentTarget.focus({ preventScroll: true });
    setDrag((value - 1) / (NIGHTS - 1));
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const box = scroller.current?.getBoundingClientRect();
    if (box && scroller.current) {
      if (event.clientX < box.left + 40) scroller.current.scrollLeft -= 14;
      else if (event.clientX > box.right - 40) scroller.current.scrollLeft += 14;
    }
    const f = fromPointer(event.clientX);
    setDrag(f);
    const next = Math.round(f * (NIGHTS - 1)) + 1;
    if (next !== value) onChange(next);
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(NIGHTS, value + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(1, value - 1);
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = NIGHTS;
    else return;
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  const marks = Array.from({ length: NIGHTS }, (_, index) => {
    const date = addDays(today, index + 1);
    return { index, date };
  });

  return (
    <section className="ruler-region" aria-label="Lockset turns at midnight">
      <div className="ruler-head">
        <h2 className="ruler-title">Lockset turns at midnight</h2>
        <p className="ruler-readout fig">{nightText(night)}</p>
      </div>
      <div className="ruler-scroll" ref={scroller}>
        <div className="ruler-track" ref={track}>
          {marks.map(({ index, date }) => (
            <span key={date} className={`ruler-mark ${index % 5 === 0 ? "major" : ""} ${index % 10 === 0 ? "tenth" : ""}`} style={{ ["--f" as string]: index / (NIGHTS - 1) }}>
              <span className="mark-date">{officeDate(date)}</span>
              <span className="mark-off">{offsetAt(date)}</span>
            </span>
          ))}
          <div
            ref={handle}
            className={`ruler-handle ${drag !== null ? "dragging" : ""}`}
            role="slider"
            tabIndex={0}
            aria-label="Night ruler"
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuemax={NIGHTS}
            aria-valuenow={value}
            aria-valuetext={nightText(night)}
            style={{ ["--f" as string]: fraction }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={onKey}
          >
            <span className="knob" aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}
