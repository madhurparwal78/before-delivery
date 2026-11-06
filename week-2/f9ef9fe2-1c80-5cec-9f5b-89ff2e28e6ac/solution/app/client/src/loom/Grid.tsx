import { type KeyboardEvent, memo, type PointerEvent, type RefObject } from "react";
import type { Station } from "../types";
import { COLUMNS, type CellView, type Pos, runsOf } from "./model";

// The station loom: one row per station, 80 quarter-hour columns, labels pinned at the left.
// The grid is a single Tab stop; the focus cell carries tabindex 0.

export const cellId = (row: number, col: number): string => `loom-cell-${row}-${col}`;

interface RowProps {
  station: Station;
  row: number;
  views: CellView[];
  focusCol: number;
  /** The row's cell kinds and run labels; the row re-renders only when it changes. */
  signature: string;
}

const Row = memo(function Row({ station, row, views, focusCol }: RowProps) {
  const runs = runsOf(views);
  return (
    <div role="row" className="loom-row" aria-rowindex={row + 2}>
      <div role="rowheader" className="rowhead" data-row={row}>
        {station.name}
      </div>
      {views.map((v, col) => {
        const length = runs.get(col);
        return (
          <div
            key={COLUMNS[col]}
            id={cellId(row, col)}
            role="gridcell"
            aria-label={`${station.name}, ${COLUMNS[col]}, ${v.label}`}
            className={`cell k-${v.kind}`}
            data-row={row}
            data-col={col}
            tabIndex={col === focusCol ? 0 : -1}
          >
            {length !== undefined && (
              <span className="run" aria-hidden="true" style={{ width: `calc(${length} * var(--cell-w) - 6px)` }}>
                {v.run}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}, (a: RowProps, b: RowProps) => a.signature === b.signature && a.focusCol === b.focusCol && a.station === b.station && a.row === b.row);

export function Grid({
  stations,
  views,
  focus,
  gridRef,
  onKeyDown,
  onPointerDown,
  onPointerUp,
}: {
  stations: Station[];
  views: CellView[][];
  focus: Pos;
  gridRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const hover = (event: PointerEvent<HTMLDivElement>, on: boolean): void => {
    if (event.pointerType !== "mouse" || !(event.target instanceof HTMLElement)) return;
    const cell = event.target.closest<HTMLElement>(".cell");
    if (!cell || !gridRef.current) return;
    const head = gridRef.current.querySelector(`[data-head="${cell.dataset.col ?? ""}"]`);
    const rowHead = gridRef.current.querySelector(`.rowhead[data-row="${cell.dataset.row ?? ""}"]`);
    head?.classList.toggle("hovered", on);
    rowHead?.classList.toggle("hovered", on);
  };
  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Station loom"
      aria-rowcount={stations.length + 1}
      aria-colcount={COLUMNS.length + 1}
      className="loom-grid"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerOver={(e) => hover(e, true)}
      onPointerOut={(e) => hover(e, false)}
    >
      <div role="row" className="loom-row loom-columns" aria-rowindex={1}>
        <div role="columnheader" className="corner">
          Station
        </div>
        {COLUMNS.map((start, col) => (
          <div key={start} role="columnheader" aria-label={start} className="colhead" data-head={col}>
            {col % 4 === 0 ? start : ""}
          </div>
        ))}
      </div>
      {stations.map((station, row) => {
        const rowViews = views[row] ?? [];
        return (
          <Row
            key={station.id}
            station={station}
            row={row}
            views={rowViews}
            focusCol={focus.row === row ? focus.col : -1}
            signature={rowViews.map((v) => `${v.kind}:${v.run}`).join("|")}
          />
        );
      })}
    </div>
  );
}
