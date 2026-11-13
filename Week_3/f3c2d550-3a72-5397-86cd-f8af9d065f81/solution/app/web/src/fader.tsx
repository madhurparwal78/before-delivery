import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface FaderConfig {
  count: number;
  value: number;
  valueText: string;
  select: (index: number) => void;
  step: (delta: 1 | -1) => void;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function Fader({ config }: { config: FaderConfig }) {
  const { count, value, valueText, select, step } = config;
  const track = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(value);
  const dragging = useRef(false);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const restFraction = count > 1 ? value / (count - 1) : 0.5;
  const fraction = dragFraction ?? restFraction;

  const measure = (clientX: number) => {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return { fraction: restFraction, index: value };
    const along = clamp((clientX - bounds.left) / bounds.width);
    return { fraction: along, index: count > 1 ? Math.round(along * (count - 1)) : 0 };
  };

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const reading = measure(event.clientX);
    setDragFraction(reading.fraction);
    if (reading.index !== lastIndex.current) {
      lastIndex.current = reading.index;
      select(reading.index);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    lastIndex.current = value;
    follow(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) follow(event);
  };

  const release = () => {
    dragging.current = false;
    setDragFraction(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowUp: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowDown: () => step(-1),
      Home: () => select(0),
      End: () => select(count - 1),
    };
    const move = moves[event.key];
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    move();
  };

  return (
    <div
      className="fader"
      role="slider"
      tabIndex={0}
      aria-label="Reel position"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="fader-track" ref={track}>
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className="detent"
            style={{ left: `${(count > 1 ? index / (count - 1) : 0.5) * 100}%` }}
          >
            {index + 1}
          </span>
        ))}
        <span className={`knob${dragFraction === null ? "" : " dragging"}`} style={{ left: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
