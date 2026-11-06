// The flux timeline: the date window, one bar per UTC day around the zero rule, and the brush.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { COPY } from "../copy";
import { DAY, dayOf, epochOf, minuteDisplay, parseDay, signed } from "../format";
import type { TimelineDay } from "../types";
import { keyDelta, moveBrush, wholeHalfHours, type BrushPart, type Range } from "./model";
import { abs, bpPercent, divHalfEven, max, min, toUnits } from "./exact";

interface TimelineProps {
  days: TimelineDay[] | null;
  range: Range | null;
  brush: Range | null;
  from: number | null;
  to: number | null;
  recordDays: { first: number; last: number } | null;
  windowError: boolean;
  viewerNote: boolean;
  noReadings: boolean;
  onBrush: (brush: Range) => void;
  /** Returns false when the window was refused (To before From). */
  onApply: (from: number, to: number) => boolean;
}

const percent = (value: number, range: Range) => ((value - range.start) / (range.end - range.start)) * 100;

/** A UTC day's left edge and width in percent of the window, clipped to the window. */
function daySpan(date: string, range: Range): { left: number; width: number } {
  const start = epochOf(`${date}T00:00:00Z`);
  const left = percent(Math.max(start, range.start), range);
  return { left, width: percent(Math.min(start + DAY, range.end), range) - left };
}

/** Bar geometry in basis points of the plot height, exact: the zero rule's place and a scale shared by
 *  uptake and emission (the larger side fills 94% of its half). Values are bigint thousandths of a tonne. */
function barLayout(days: TimelineDay[]) {
  const values = days.map((d) => toUnits(d.net_tco2e, 3));
  const up = max(0n, ...values);
  const down = max(0n, ...values.map((v) => -v));
  const rule = up + down === 0n ? 5000n : min(8800n, max(1200n, divHalfEven(up * 10000n, up + down)));
  // The binding side: room (basis points) per value unit, as the fraction room / extent.
  const sides: [bigint, bigint][] = [];
  if (up > 0n) sides.push([rule, up]);
  if (down > 0n) sides.push([10000n - rule, down]);
  const [room, extent] = sides.length ? sides.reduce((a, b) => (a[0] * b[1] <= b[0] * a[1] ? a : b)) : [0n, 1n];
  const span = (v: bigint) => divHalfEven(abs(v) * room * 94n, extent * 100n);
  return { rule, span, values };
}

/** Value-axis marks: the zero rule and the largest uptake and emission days, as the server wrote them. */
function axisMarks(days: TimelineDay[], values: bigint[], rule: bigint, span: (v: bigint) => bigint) {
  const marks = [{ label: "0", at: rule }];
  if (!values.length) return marks;
  const low = values.indexOf(min(...values));
  const high = values.indexOf(max(...values));
  if (values[low]! < 0n) marks.push({ label: signed(days[low]!.net_tco2e), at: rule + span(values[low]!) });
  if (values[high]! > 0n) marks.push({ label: signed(days[high]!.net_tco2e), at: rule - span(values[high]!) });
  return marks;
}

function DayBars({ days, range }: { days: TimelineDay[]; range: Range }) {
  const { rule, span, values } = barLayout(days);
  const tickEvery = Math.max(1, Math.ceil(days.length / 7));
  return (
    <div className="chart">
      <div className="plot">
        <ol aria-label="Daily net CO2e" className="bars">
          {days.map((d, i) => {
            const v = values[i]!;
            const height = span(v);
            const { left, width } = daySpan(d.date, range);
            const shape = v > 0n ? "emission" : v < 0n ? "uptake" : "flat";
            const style = shape === "flat"
              ? { left: `${left + width * 0.15}%`, width: `${width * 0.7}%`, top: `calc(${bpPercent(rule)} - 1px)`, height: "2px" }
              : {
                left: `${left + width * 0.15}%`, width: `${width * 0.7}%`,
                top: bpPercent(shape === "uptake" ? rule : rule - height),
                height: `max(1px, ${bpPercent(height)})`,
              };
            return <li key={d.date} aria-label={`${d.date} ${signed(d.net_tco2e)} tCO2e`} className={`bar bar-${shape}`} style={style} />;
          })}
        </ol>
        <div role="separator" aria-label="Zero rule" aria-orientation="horizontal" className="zero-rule" style={{ top: bpPercent(rule) }} />
        <div className="value-axis" aria-hidden="true">
          {axisMarks(days, values, rule, span).map((m) => (
            <span key={m.label} className="value-tick num" style={{ top: bpPercent(m.at) }}>{m.label}</span>
          ))}
        </div>
      </div>
      <div className="day-axis" aria-hidden="true">
        {days.map((d, i) => i % tickEvery === 0 && (
          <span key={d.date} className={`day-tick num ${(i / tickEvery) % 2 === 1 ? "is-alternate" : ""}`} style={{ left: `${daySpan(d.date, range).left + daySpan(d.date, range).width / 2}%` }}>
            {d.date.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}

const PARTS: { part: BrushPart; name: string }[] = [
  { part: "start", name: "Interval start" },
  { part: "body", name: "Interval position" },
  { part: "end", name: "Interval end" },
];

function Brush({ brush, range, onBrush }: { brush: Range; range: Range; onBrush: (b: Range) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ part: BrushPart; x: number; from: Range; pointer: number } | null>(null);

  const down = (part: BrushPart) => (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    drag.current = { part, x: event.clientX, from: brush, pointer: event.pointerId };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const width = track.current!.clientWidth;
    const seconds = ((event.clientX - d.x) / width) * (range.end - range.start);
    const next = moveBrush(d.from, d.part, wholeHalfHours(seconds), range);
    if (next.start !== brush.start || next.end !== brush.end) onBrush(next);
  };
  const up = () => {
    drag.current = null;
  };
  const key = (part: BrushPart) => (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = keyDelta(event.key, part, brush, range);
    if (delta === null) return;
    event.preventDefault();
    const next = moveBrush(brush, part, delta, range);
    if (next.start !== brush.start || next.end !== brush.end) onBrush(next);
  };

  const left = percent(brush.start, range);
  const right = percent(brush.end, range);
  const value = { start: minuteDisplay(brush.start), end: minuteDisplay(brush.end) };
  const text = { start: value.start, end: value.end, body: `${value.start} to ${value.end}` };
  const style = {
    start: { left: `${left}%` },
    end: { left: `${right}%` },
    body: { left: `${left}%`, width: `${right - left}%` },
  };

  return (
    <div className="brush">
      <div className="brush-track" ref={track}>
      <div className="brush-rail" aria-hidden="true" />
      {PARTS.map(({ part, name }) => (
        <div
          key={part}
          role="slider"
          tabIndex={0}
          aria-label={name}
          aria-orientation="horizontal"
          aria-valuemin={range.start}
          aria-valuemax={range.end}
          aria-valuenow={part === "end" ? brush.end : brush.start}
          aria-valuetext={text[part]}
          className={`brush-${part === "body" ? "body" : `handle brush-${part}`}`}
          style={style[part]}
          onPointerDown={down(part)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key(part)}
        >
          {part !== "body" && <span className="grip" aria-hidden="true" />}
        </div>
      ))}
      </div>
    </div>
  );
}

function spanText(seconds: number): string {
  const hours = seconds / 3600;
  const d = Math.floor(hours / 24), h = hours % 24;
  return d ? `${d} d ${h} h` : `${h} h`;
}

export function Timeline({ days, range, brush, from, to, recordDays, windowError, viewerNote, noReadings, onBrush, onApply }: TimelineProps) {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const shown = draft ?? { from: from === null ? "" : dayOf(from), to: to === null ? "" : dayOf(to) };

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = parseDay(shown.from), t = parseDay(shown.to);
    if (f === null || t === null || !recordDays) return;
    const clampDay = (day: number) => Math.min(Math.max(day, recordDays.first), recordDays.last);
    if (onApply(clampDay(f), clampDay(t))) setDraft(null);
  };

  const shift = (direction: -1 | 1) => brush && range && onBrush(moveBrush(brush, "body", direction * (brush.end - brush.start), range));

  return (
    <section role="group" aria-label="Flux timeline" className="pane timeline-pane">
      <h2 className="pane-title">Flux timeline <span className="pane-unit">net tCO2e per UTC day</span></h2>
      <form className="date-window" onSubmit={apply}>
        <label className="field">
          <span>From</span>
          <input type="date" value={shown.from} min={recordDays ? dayOf(recordDays.first) : undefined}
            max={recordDays ? dayOf(recordDays.last) : undefined} onChange={(e) => setDraft({ ...shown, from: e.target.value })} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={shown.to} min={recordDays ? dayOf(recordDays.first) : undefined}
            max={recordDays ? dayOf(recordDays.last) : undefined} onChange={(e) => setDraft({ ...shown, to: e.target.value })} />
        </label>
        <button type="submit" className="btn" disabled={!recordDays}>Apply dates</button>
      </form>
      {windowError && <p role="alert" className="alert">{COPY.toBeforeFrom}</p>}
      {viewerNote && <p className="role-note" id="viewer-note">{COPY.roleViewer}</p>}
      {!range || !brush ? (
        <div className="timeline-empty">
          <svg viewBox="0 0 240 90" aria-hidden="true" className="empty-axis">
            <path d="M20 45 H230" stroke="currentColor" strokeWidth="1" />
            <path d="M20 10 V80" stroke="currentColor" strokeWidth="1" />
            {[50, 80, 110, 140, 170, 200].map((x) => <path key={x} d={`M${x} 42 V48`} stroke="currentColor" strokeWidth="1" />)}
          </svg>
          {noReadings && <p>{COPY.noReadings}</p>}
        </div>
      ) : (
        <>
          <div className="timeline-body">
            {days && <DayBars days={days} range={range} />}
            <div className="shade-frame" aria-hidden="true">
              <div className="brush-shade"
                style={{ left: `${percent(brush.start, range)}%`, width: `${percent(brush.end, range) - percent(brush.start, range)}%` }} />
            </div>
          </div>
          <Brush brush={brush} range={range} onBrush={onBrush} />
          <div className="step-row">
            <button type="button" className="btn" onClick={() => shift(-1)}>
              <ChevronLeft size={16} aria-hidden="true" /> Previous interval
            </button>
            <p className="brush-readout num" aria-hidden="true">
              {minuteDisplay(brush.start)} – {minuteDisplay(brush.end)} <span className="muted-note">({spanText(brush.end - brush.start)})</span>
            </p>
            <button type="button" className="btn" onClick={() => shift(1)}>
              Next interval <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
