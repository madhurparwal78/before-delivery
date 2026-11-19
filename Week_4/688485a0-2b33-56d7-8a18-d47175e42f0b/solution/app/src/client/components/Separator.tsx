import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

/** A resizable pane separator: arrow keys move 5 percent, Home and End jump to 20 and 80, a pointer drag sets the value. */

const PANE_MIN = 20;
const PANE_MAX = 80;
const STEP = 5;

const clamp = (value: number): number => Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(value)));

interface Props {
  name: string;
  value: number;
  onChange: (value: number) => void;
  /** The element whose size the value is a share of. */
  container: RefObject<HTMLElement | null>;
  orientation: "horizontal" | "vertical";
}

export function Separator({ name, value, onChange, container, orientation }: Props): ReactNode {
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight" ? value + STEP
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? value - STEP
      : event.key === "Home" ? PANE_MIN
      : event.key === "End" ? PANE_MAX
      : null;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next));
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    const share = orientation === "horizontal" ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width;
    onChange(clamp(share * 100));
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={name}
      aria-orientation={orientation}
      aria-valuemin={PANE_MIN}
      aria-valuemax={PANE_MAX}
      aria-valuenow={value}
      className={`separator separator-${orientation}`}
      onKeyDown={onKey}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onPointer(event);
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
    />
  );
}
