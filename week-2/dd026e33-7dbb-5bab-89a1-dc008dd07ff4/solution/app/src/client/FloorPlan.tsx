// The floor plan (brief: Screens and layout › Floor plan; Interactions › Floor plan): bays drawn by
// row and column to their relative length and width, one Tab stop, arrow keys by row and column.
import { useRef, useState, type KeyboardEvent } from "react";
import type { Bay } from "../shared/api.js";
import { BAY_CLASS_LABEL } from "../shared/domain.js";

const REASON_STATE = { occupied: "", too_small: "too small", class_change: "other class" } as const;

/** The bay's single state, in the reason order the server publishes. */
function bayState(bay: Bay): string {
  if (bay.car) return `occupied by ${bay.car.name}`;
  if (bay.reason && bay.reason !== "occupied") return REASON_STATE[bay.reason];
  return "free";
}

function bayName(bay: Bay): string {
  return `Bay ${bay.code}, ${BAY_CLASS_LABEL[bay.class]}, ${bayState(bay)}`;
}

const PX_PER_MM = 0.026;

export function FloorPlan({
  bays,
  selected,
  onActivate,
  caption,
}: {
  bays: Bay[];
  selected?: string | null;
  onActivate: (bay: Bay) => void;
  caption?: string;
}): JSX.Element {
  const [focusId, setFocusId] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const rows = [...new Set(bays.map((bay) => bay.row))].sort((a, b) => a - b).map((row) =>
    bays.filter((bay) => bay.row === row).sort((a, b) => a.column - b.column),
  );
  const widest = Math.max(1, ...rows.map((row) => row.reduce((sum, bay) => sum + bay.width_mm, 0)));
  const stop = bays.find((bay) => bay.id === focusId)?.id ?? bays.find((bay) => bay.id === selected)?.id ?? bays[0]?.id;

  const move = (from: Bay, event: KeyboardEvent<HTMLButtonElement>): void => {
    const rowIndex = rows.findIndex((row) => row.includes(from));
    const row = rows[rowIndex] ?? [];
    const at = row.indexOf(from);
    let target: Bay | undefined;
    if (event.key === "ArrowRight") target = row[at + 1];
    else if (event.key === "ArrowLeft") target = row[at - 1];
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = rows[rowIndex + (event.key === "ArrowDown" ? 1 : -1)];
      target = next ? [...next].sort((a, b) => Math.abs(a.column - from.column) - Math.abs(b.column - from.column))[0] : undefined;
    } else return;
    event.preventDefault();
    if (!target) return;
    setFocusId(target.id);
    buttons.current.get(target.id)?.focus();
  };

  return (
    <div role="group" aria-label="Floor plan" className="floor-plan">
      {caption ? <p className="floor-caption">{caption}</p> : null}
      {rows.map((row) => (
        <div className="floor-row" key={row[0]?.row}>
          {row.map((bay) => {
            const unavailable = bay.eligible === false;
            return (
              <button
                key={bay.id}
                ref={(element) => {
                  if (element) buttons.current.set(bay.id, element);
                  else buttons.current.delete(bay.id);
                }}
                type="button"
                className={`bay${bay.car ? " bay-occupied" : ""}${unavailable ? " bay-unavailable" : ""}${selected === bay.id ? " bay-selected" : ""}`}
                style={{ flex: `0 1 ${(bay.width_mm / widest) * 100}%`, height: `${Math.max(44, bay.length_mm * PX_PER_MM)}px` }}
                tabIndex={bay.id === stop ? 0 : -1}
                aria-label={bayName(bay)}
                aria-pressed={selected === undefined ? undefined : selected === bay.id}
                onFocus={() => setFocusId(bay.id)}
                onKeyDown={(event) => move(bay, event)}
                onClick={() => onActivate(bay)}
              >
                {/* The visible words run in the accessible name's order, space-separated (WCAG 2.5.3). */}
                <span className="bay-code">{bay.code}</span>{" "}
                <span className="bay-class">{BAY_CLASS_LABEL[bay.class]}</span>{" "}
                {bay.car ? (
                  <span className="bay-occupant">
                    <span className="bay-occupied-by">occupied by</span> {bay.car.name}
                  </span>
                ) : (
                  <span className="bay-occupant">Free</span>
                )}
                {unavailable && !bay.car ? (
                  <>
                    {" "}
                    <span className="bay-reason">{bayState(bay)}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
