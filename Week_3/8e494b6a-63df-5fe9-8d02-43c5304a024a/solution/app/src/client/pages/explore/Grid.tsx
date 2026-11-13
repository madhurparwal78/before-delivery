// grid "Events": a virtual grid that keeps at most 60 rows in the page, with a roving cell and the published keys.
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useShown } from "../../lib/format";
import { Skeleton } from "../../lib/ui";
import { cellText, columnWidth, type ApiEvent } from "./model";

const ROW_H = 44;
const BODY_ROWS = 12;
const OVERSCAN = 10;
const PAGE_KEYS = 20;
const MIN_WIDTH = 60;
const STEP = 16;

export interface GridHandle {
  focusRow: (row: number) => void;
  focusCurrent: () => void;
}

interface Props {
  events: ApiEvent[];
  total: number;
  columns: string[];
  widths: Record<string, number>;
  sort: string | null;
  state: "loading" | "done" | "error";
  selected: number | null;
  loadThrough: (index: number) => Promise<void>;
  onWidth: (column: string, width: number) => void;
  onSort: (column: string) => void;
  onOpen: (index: number) => void;
}

export function marked(text: string, ranges: Array<[number, number]> | undefined): ReactNode {
  if (!ranges || ranges.length === 0) return text;
  const chars = Array.from(text);
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    if (start > at) pieces.push(chars.slice(at, start).join(""));
    pieces.push(<mark key={start}>{chars.slice(start, end).join("")}</mark>);
    at = end;
  }
  if (at < chars.length) pieces.push(chars.slice(at).join(""));
  return pieces;
}

export const Grid = forwardRef<GridHandle, Props>(function Grid({ events, total, columns, widths, sort, state, selected, loadThrough, onWidth, onSort, onOpen }, handle) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const shown = useShown();
  const [scrollTop, setScrollTop] = useState(0);
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [wanted, setWanted] = useState(0);
  const widthOf = (column: string): number => widths[column] ?? columnWidth(column);
  const totalWidth = columns.reduce((sum, column) => sum + widthOf(column), 0);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(total, first + BODY_ROWS + OVERSCAN * 2);
  const rows = Array.from({ length: Math.max(0, last - first) }, (_, k) => first + k);
  const focusInWindow = focus.row >= first && focus.row < last;

  useLayoutEffect(() => {
    if (last > events.length) void loadThrough(last - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, events.length]);

  useLayoutEffect(() => {
    if (wanted === 0) return;
    const element = body.current;
    if (!element || !root.current) return;
    const top = focus.row * ROW_H;
    if (focus.row >= 0 && top < element.scrollTop) {
      element.scrollTop = top;
      setScrollTop(top);
    } else if (focus.row >= 0 && top + ROW_H > element.scrollTop + element.clientHeight) {
      const next = top + ROW_H - element.clientHeight;
      element.scrollTop = next;
      setScrollTop(next);
    }
    root.current.querySelector<HTMLElement>(`[data-row="${focus.row}"][data-col="${focus.col}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, scrollTop, events.length]);

  const moveTo = async (row: number, col: number): Promise<void> => {
    const target = Math.max(-1, Math.min(total - 1, row));
    if (target >= 0) await loadThrough(target);
    setFocus({ row: target, col: Math.max(0, Math.min(columns.length - 1, col)) });
    setWanted((n) => n + 1);
  };

  useImperativeHandle(handle, () => ({
    focusRow: (row) => void moveTo(row, focus.col),
    focusCurrent: () => void moveTo(focus.row, focus.col),
  }));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const { row, col } = focus;
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const column = columns[col] as string;
      onWidth(column, Math.max(MIN_WIDTH, widthOf(column) + (event.key === "ArrowRight" ? STEP : -STEP)));
      return;
    }
    const target =
      event.key === "ArrowDown" ? [row + 1, col] : event.key === "ArrowUp" ? [row - 1, col] : event.key === "ArrowRight" ? [row, col + 1]
      : event.key === "ArrowLeft" ? [row, col - 1] : event.key === "Home" ? [0, col] : event.key === "End" ? [total - 1, col]
      : event.key === "PageDown" ? [row + PAGE_KEYS, col] : event.key === "PageUp" ? [Math.max(0, row - PAGE_KEYS), col] : null;
    if (target) {
      event.preventDefault();
      void moveTo(target[0] as number, target[1] as number);
    } else if (event.key === "Enter" || (event.key === " " && row === -1)) {
      event.preventDefault();
      if (row === -1) onSort(columns[col] as string);
      else onOpen(row);
    }
  };

  const startResize = (event: React.PointerEvent, column: string): void => {
    event.preventDefault();
    const origin = event.clientX;
    const base = widthOf(column);
    const move = (next: PointerEvent): void => onWidth(column, Math.max(MIN_WIDTH, Math.round(base + next.clientX - origin)));
    const stop = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  };

  const cell = (event: ApiEvent, column: string): ReactNode => {
    if (column === "@timestamp") return <span className="mono stamp">{shown(event["@timestamp"])}</span>;
    const text = cellText(event.fields[column]);
    return <span className={column === "message" ? "mono message" : "mono"}>{marked(text, event.highlights[column])}</span>;
  };

  return (
    <div className="grid-scroll">
      <div ref={root} role="grid" aria-label="Events" aria-rowcount={total + 1} aria-colcount={columns.length} data-search-state={state} className="events-grid" onKeyDown={onKeyDown}>
        <div className="grid-inner" style={{ width: totalWidth }}>
        <div role="row" aria-rowindex={1} className="grid-row grid-head">
          {columns.map((column) => (
            <div
              key={column} role="columnheader" data-width={widthOf(column)} data-row={-1} data-col={columns.indexOf(column)} className="grid-cell head-cell" style={{ width: widthOf(column) }}
              tabIndex={focus.row === -1 && focus.col === columns.indexOf(column) ? 0 : -1} onFocus={() => setFocus({ row: -1, col: columns.indexOf(column) })}
            >
              <button type="button" tabIndex={-1} className="sort-button" aria-label={`Sort by ${column}`} onClick={() => onSort(column)}>
                <span className="mono">{column}</span>
                {sort?.startsWith(`${column}:`) ? <span aria-hidden="true" className={`sort-arrow ${sort.endsWith("desc") ? "desc" : "asc"}`} /> : null}
              </button>
              <div role="separator" aria-orientation="vertical" aria-label={`Resize ${column}`} className="resize-handle" onPointerDown={(event) => startResize(event, column)} />
            </div>
          ))}
        </div>
        <div ref={body} className="grid-body" style={{ height: Math.min(Math.max(total, 1), BODY_ROWS) * ROW_H }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          <div className="grid-spacer" style={{ height: total * ROW_H }}>
            {state === "loading" && events.length === 0 ? <Skeleton rows={6} /> : null}
            {rows.map((index) => {
              const event = events[index];
              if (!event) return <div key={index} role="row" aria-rowindex={index + 2} aria-busy="true" className="grid-row grid-skeleton" style={{ top: index * ROW_H }} />;
              const label = `Event ${index + 1} of ${total}, ${shown(event["@timestamp"])}, ${cellText(event.fields.host) || "none"}, ${cellText(event.fields.level) || "none"}`;
              return (
                <div
                  key={event._id}
                  role="row"
                  aria-rowindex={index + 2}
                  aria-label={label}
                  aria-selected={selected === index}
                  data-source={event._phase === "archive" ? "archive" : undefined}
                  className={`grid-row${selected === index ? " row-selected" : ""}`}
                  style={{ top: index * ROW_H }}
                  onClick={() => { setFocus({ row: index, col: focus.col }); onOpen(index); }}
                >
                  {columns.map((column, col) => (
                    <div
                      key={column}
                      role="gridcell"
                      data-row={index}
                      data-col={col}
                      tabIndex={(focus.row === index && focus.col === col) || (!focusInWindow && index === first && col === 0) ? 0 : -1}
                      className="grid-cell"
                      style={{ width: widthOf(column) }}
                      onFocus={() => setFocus({ row: index, col })}
                    >
                      {cell(event, column)}
                      {col === columns.length - 1 && event._phase === "archive" ? <span className="badge badge-info archive-badge">From archive</span> : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
});
