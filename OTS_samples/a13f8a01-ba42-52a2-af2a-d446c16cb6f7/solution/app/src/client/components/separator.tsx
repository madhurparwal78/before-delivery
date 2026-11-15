import { useRef, type KeyboardEvent, type PointerEvent } from "react";

const SEPARATOR_MIN = 15;
const SEPARATOR_MAX = 85;
const STEP = 5;

interface Props {
  name: string;
  orientation: "vertical" | "horizontal";
  value: number;
  onChange: (value: number) => void;
  /** Turns a pointer position into the share this separator should read, from the pair it divides. */
  measure: (x: number, y: number) => number;
}

const clamp = (value: number): number => Math.min(SEPARATOR_MAX, Math.max(SEPARATOR_MIN, Math.round(value)));

export function Separator({ name, orientation, value, onChange, measure }: Props): React.JSX.Element {
  const dragging = useRef(false);

  const press = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next: Record<string, number> = {
      ArrowLeft: value - STEP,
      ArrowUp: value - STEP,
      ArrowRight: value + STEP,
      ArrowDown: value + STEP,
      Home: SEPARATOR_MIN,
      End: SEPARATOR_MAX,
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onChange(clamp(target));
  };

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current) onChange(clamp(measure(event.clientX, event.clientY)));
  };

  return (
    <div
      role="separator"
      aria-label={name}
      aria-orientation={orientation}
      aria-valuemin={SEPARATOR_MIN}
      aria-valuemax={SEPARATOR_MAX}
      aria-valuenow={value}
      tabIndex={0}
      className="separator"
      data-orientation={orientation}
      onKeyDown={press}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    />
  );
}
