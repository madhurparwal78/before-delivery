import type { JSX } from "preact";
import { useRef } from "preact/hooks";

interface Props {
  readonly value: number;
  readonly max: number;
  readonly text: string;
  readonly onChange: (value: number) => void;
}

const STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };

/** The Replay position slider: whole seconds from 0 to the run's length, moved by keys, pointer or touch. */
export function ReplaySlider({ value, max, text, onChange }: Props): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const clamp = (n: number): number => Math.min(max, Math.max(0, n));
  const fromPointer = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    return box && box.width > 0 ? clamp(Math.round(((clientX - box.left) / box.width) * max)) : value;
  };
  return (
    <div
      ref={track}
      class="slider"
      role="slider"
      tabIndex={0}
      aria-label="Replay position"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      onKeyDown={(event) => {
        const step = STEPS[event.key];
        const next = event.key === "Home" ? 0 : event.key === "End" ? max : step === undefined ? null : clamp(value + step);
        if (next === null) return;
        event.preventDefault();
        if (next !== value) onChange(next);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(fromPointer(event.clientX));
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(fromPointer(event.clientX));
      }}
    >
      <div class="slider-rail" />
      <div class="slider-fill" style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }} />
      <div class="slider-thumb" style={{ left: `${max === 0 ? 0 : (value / max) * 100}%` }} />
    </div>
  );
}
