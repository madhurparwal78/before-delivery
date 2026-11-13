// The build tape (DP-43, DP-44): a slider over one operation per source line, moved by keys or a captured drag.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TapeJson } from "../shared/api";
import { MINUS, NNBSP, display } from "../shared/numbers";

const PAD = 14;
const TICK = 24;

function tapeReadout(tape: TapeJson, k: number): string {
  const op = tape.operations[k];
  if (!op) return "";
  const head = `Operation ${k} of ${tape.n} · `;
  if (op.kind === "start") return `${head}empty`;
  if (op.kind === "params") return `${head}${op.op}`;
  const change = op.delta / 1000;
  const sign = op.delta > 0 ? "+" : op.delta < 0 ? MINUS : "±";
  return `${head}${op.op} · ${sign}${display(Math.abs(change), 2)}${NNBSP}cm³`;
}

function tapeValueText(tape: TapeJson, k: number): string {
  const op = tape.operations[k];
  return op ? `Operation ${k} of ${tape.n} · ${op.kind} · ${op.op}` : "";
}

function isGeometry(tape: TapeJson, k: number): boolean {
  const kind = tape.operations[k]?.kind;
  return kind === "body" || kind === "cut" || kind === "join";
}

interface Props {
  tape: TapeJson;
  k: number;
  disabled: boolean;
  onChange: (k: number) => void;
  onFork?: () => void;
}

export function BuildTape({ tape, k, disabled, onChange, onFork }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; id: number } | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const n = tape.n;

  const tickAt = (clientX: number): { exact: number; tick: number } => {
    const box = (track.current as HTMLDivElement).getBoundingClientRect();
    const exact = n === 0 ? 0 : Math.max(0, Math.min(n, ((clientX - box.left - PAD) / Math.max(1, box.width - 2 * PAD)) * n));
    return { exact, tick: Math.round(exact) };
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || disabled) return;
    let next = k;
    if (event.key === "ArrowRight" && !event.shiftKey) next = Math.min(n, k + 1);
    else if (event.key === "ArrowLeft" && !event.shiftKey) next = Math.max(0, k - 1);
    else if (event.key === "ArrowRight" && event.shiftKey) next = [...Array(n + 1).keys()].find((i) => i > k && isGeometry(tape, i)) ?? k;
    else if (event.key === "ArrowLeft" && event.shiftKey) next = [...Array(n + 1).keys()].reverse().find((i) => i < k && isGeometry(tape, i)) ?? k;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n;
    else if (event.key === "Enter" && onFork) {
      event.preventDefault();
      onFork();
      return;
    } else return;
    event.preventDefault();
    if (next !== k) onChange(next);
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || (event.button !== 0 && event.pointerType === "mouse")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: k, id: event.pointerId };
    const { exact, tick } = tickAt(event.clientX);
    setFraction(exact);
    if (tick !== k) onChange(tick);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    const { exact, tick } = tickAt(event.clientX);
    setFraction(exact);
    if (tick !== k) onChange(tick);
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    const start = drag.current.start;
    drag.current = null;
    setFraction(null);
    if (event.type === "pointercancel" && start !== k) onChange(start);
  };

  const place = (position: number) => `calc(${PAD}px + (100% - ${2 * PAD}px) * ${n === 0 ? 0 : position / n})`;
  return (
    <div className="tape">
      <div className="tape-scroll">
        <div
          ref={track}
          className={disabled ? "tape-track tape-disabled" : "tape-track"}
          role="slider"
          tabIndex={0}
          aria-label="Build tape"
          aria-valuemin={0}
          aria-valuemax={n}
          aria-valuenow={k}
          aria-valuetext={tapeValueText(tape, k)}
          aria-disabled={disabled ? true : undefined}
          style={{ minWidth: n * TICK + 2 * PAD }}
          onKeyDown={onKey}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <span className="tape-rail" />
          {tape.operations.map((op) => (
            <span key={op.index} className={`tick tick-${op.kind}${op.index <= k ? " tick-done" : ""}`} style={{ left: place(op.index) }} />
          ))}
          <span className={fraction === null ? "playhead settle" : "playhead"} style={{ left: place(fraction ?? k) }} />
        </div>
      </div>
      <p className="tape-readout" data-ui="tape-readout">
        {tapeReadout(tape, k)}
      </p>
      {onFork ? (
        <button type="button" className="button" onClick={onFork}>
          Fork from operation {k}
        </button>
      ) : null}
    </div>
  );
}
