// The coverage chart as an ARIA grid: one row per row of cells from north to south, operated by keyboard.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Coverage, Holiday, Position } from "../api";

const WINDOW = 30;

interface Props {
  coverage: Coverage;
  holidays: Holiday[];
  onCell: (centre: Position, holiday: Holiday | null) => void;
  onEnter: (holiday: Holiday | null) => void;
}

export function CoverageGrid({ coverage, holidays, onCell, onEnter }: Props) {
  const { rows, cols, origin, overlap } = coverage;
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const grid = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  const holidayAt = useMemo(() => {
    const map = new Map<string, Holiday>();
    for (const h of holidays) for (const [c, r] of h.cells) map.set(`${c},${r}`, h);
    return map;
  }, [holidays]);

  // Grid row 0 is the northmost row of cells.
  const cellOf = (row: number, col: number) => ({ c: col, r: rows - 1 - row });
  const centreOf = (row: number, col: number): Position => {
    const { c, r } = cellOf(row, col);
    return { easting: origin.easting + 5 * c + 2.5, northing: origin.northing + 5 * r + 2.5 };
  };
  const holidayOf = (row: number, col: number) => {
    const { c, r } = cellOf(row, col);
    return holidayAt.get(`${c},${r}`) ?? null;
  };

  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-cell="${focus[0]},${focus[1]}"]`)?.focus();
  }, [focus]);

  const move = (row: number, col: number) => {
    const next: [number, number] = [Math.max(0, Math.min(rows - 1, row)), Math.max(0, Math.min(cols - 1, col))];
    wantFocus.current = true;
    setFocus(next);
    onCell(centreOf(...next), holidayOf(...next));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const [row, col] = focus;
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(row - 1, col),
      ArrowDown: () => move(row + 1, col),
      ArrowLeft: () => move(row, col - 1),
      ArrowRight: () => move(row, col + 1),
      Home: () => (e.ctrlKey ? move(0, 0) : move(row, 0)),
      End: () => (e.ctrlKey ? move(rows - 1, cols - 1) : move(row, cols - 1)),
      PageUp: () => move(row - 10, col),
      PageDown: () => move(row + 10, col),
      Enter: () => onEnter(holidayOf(row, col)),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const first = Math.max(0, Math.min(focus[0] - WINDOW / 2, rows - WINDOW));
  const shownRows = Array.from({ length: Math.min(WINDOW, rows) }, (_, i) => first + i);
  return (
    <div
      ref={grid}
      className="coverage-grid"
      role="grid"
      aria-label="Coverage table"
      aria-rowcount={rows}
      aria-colcount={cols}
      onKeyDown={onKeyDown}
    >
      {shownRows.map((row) => (
        <div key={row} role="row" aria-rowindex={row + 1}>
          {Array.from({ length: cols }, (_, col) => {
            const { c, r } = cellOf(row, col);
            const o = overlap[r][c];
            const holiday = holidayOf(row, col);
            const count = o >= 3 ? "3+" : String(o);
            const text = o < 0 ? "outside" : holiday ? `${holiday.label} ${count}` : count;
            const isFocus = focus[0] === row && focus[1] === col;
            return (
              <div
                key={col}
                role="gridcell"
                aria-rowindex={row + 1}
                aria-colindex={col + 1}
                tabIndex={isFocus ? 0 : -1}
                data-cell={`${row},${col}`}
                data-o={o > 0 ? Math.min(3, o) : undefined}
                data-h={holiday ? "" : undefined}
                data-out={o < 0 ? "" : undefined}
                onFocus={() => {
                  if (!isFocus) setFocus([row, col]);
                  onCell(centreOf(row, col), holiday);
                }}
              >
                {text}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
