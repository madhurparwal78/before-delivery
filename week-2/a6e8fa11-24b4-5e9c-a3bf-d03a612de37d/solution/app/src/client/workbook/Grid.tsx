// The grid: columns A–Z, rows 1–500, one Tab stop with focus on the active cell.
import { type ClipboardEvent, type KeyboardEvent, type MouseEvent, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { type WorkbookEngine } from "../../shared/engine.js";
import { LIMITS } from "../../shared/limits.js";
import { cellName, columnLetter, qualifiedCell } from "../../shared/refs.js";
import { type Furrow } from "./furrow.js";

const ROW_H = 24;
const HEAD_H = 24;
const ROWHEAD_W = 48;
const COL_W = 96;
const COLS = Array.from({ length: LIMITS.maxColumns }, (_v, i) => i + 1);

interface Point {
  row: number;
  col: number;
}

export interface Selection {
  anchor: Point;
  active: Point;
}

export interface Editing {
  draft: string;
}

interface GridProps {
  engine: WorkbookEngine;
  sheetId: string;
  sheetName: string;
  furrow: Furrow | null;
  selection: Selection;
  editing: Editing | null;
  pending: Set<string>;
  rollbacks: Set<string>;
  readOnly: boolean;
  onSelect(sel: Selection): void;
  onEditStart(draft: string): void;
  onDraft(draft: string): void;
  /** Commits the editor and moves by (dRow, dCol). */
  onCommit(dRow: number, dCol: number): void;
  onCancel(): void;
  onClear(): void;
  onSheetStep(step: 1 | -1): void;
  onBold(): void;
  onPaste(text: string): void;
  onReadOnlyType(): void;
  focusToken: number;
}

const clampRow = (r: number): number => Math.min(LIMITS.maxRows, Math.max(1, r));
const clampCol = (c: number): number => Math.min(LIMITS.maxColumns, Math.max(1, c));

interface CellProps {
  cellKey: string;
  row: number;
  col: number;
  display: string;
  numeric: boolean;
  bold: boolean;
  error: boolean;
  selected: boolean;
  active: boolean;
  pending: boolean;
  rollback: boolean;
  furrow: Furrow | null;
}

const noOverlay = { display: null, outlined: false, fading: false };
const noSubscribe = (): (() => void) => () => undefined;

const Cell = memo(function Cell(p: CellProps): JSX.Element {
  const furrow = p.furrow;
  const subscribe = useCallback((l: () => void) => (furrow ? furrow.subscribeCell(p.cellKey, l) : noSubscribe()), [furrow, p.cellKey]);
  const overlay = useSyncExternalStore(subscribe, () => (furrow ? furrow.cell(p.cellKey) : noOverlay));
  const described = [p.pending ? "desc-pending" : "", overlay.outlined ? "desc-recalc" : ""].filter(Boolean).join(" ");
  const classes = ["cell"];
  if (p.numeric) classes.push("num");
  if (p.error) classes.push("err");
  if (p.bold) classes.push("bold");
  if (p.selected) classes.push("sel");
  if (p.active) classes.push("active");
  if (p.pending) classes.push("pending");
  if (p.rollback) classes.push("rollback");
  if (overlay.outlined) classes.push("recalc");
  if (overlay.fading) classes.push("fading");
  return (
    <div
      role="gridcell"
      aria-colindex={p.col}
      aria-selected={p.selected}
      aria-describedby={described || undefined}
      tabIndex={p.active ? 0 : -1}
      className={classes.join(" ")}
      data-row={p.row}
      data-col={p.col}
    >
      {overlay.display ?? p.display}
    </div>
  );
});

export function Grid(props: GridProps): JSX.Element {
  const { engine, sheetId, selection, editing } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const dragging = useRef(false);
  const committing = useRef(false);
  const lastFocusToken = useRef(props.focusToken);

  const top = Math.min(selection.anchor.row, selection.active.row);
  const bottom = Math.max(selection.anchor.row, selection.active.row);
  const left = Math.min(selection.anchor.col, selection.active.col);
  const right = Math.max(selection.anchor.col, selection.active.col);
  const pageRows = Math.max(1, Math.floor((view.height - HEAD_H) / ROW_H) - 1);

  useLayoutEffect(() => {
    const el = scroller.current as HTMLDivElement;
    const update = (): void => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(1, Math.floor(view.top / ROW_H) - 12);
  const last = Math.min(LIMITS.maxRows, first + Math.ceil(view.height / ROW_H) + 36);

  // Keep the active cell in view and focused when the grid owns focus.
  useLayoutEffect(() => {
    const el = scroller.current as HTMLDivElement;
    const { row, col } = selection.active;
    const cellTop = HEAD_H + (row - 1) * ROW_H;
    const cellLeft = ROWHEAD_W + (col - 1) * COL_W;
    if (cellTop - HEAD_H < el.scrollTop) el.scrollTop = cellTop - HEAD_H;
    else if (cellTop + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = cellTop + ROW_H - el.clientHeight;
    const frozen = getComputedStyle(el).getPropertyValue("--frozen-width").trim();
    const frozenWidth = frozen ? Number.parseFloat(frozen) : ROWHEAD_W;
    if (cellLeft - frozenWidth < el.scrollLeft && col > 1) el.scrollLeft = cellLeft - frozenWidth;
    else if (cellLeft + COL_W > el.scrollLeft + el.clientWidth) el.scrollLeft = cellLeft + COL_W - el.clientWidth;
    if (col === 1) el.scrollLeft = 0;
    setView((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }));
  }, [selection.active]);

  useLayoutEffect(() => {
    if (editing) {
      const input = editor.current;
      if (input && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    const root = scroller.current as HTMLDivElement;
    const wanted = props.focusToken !== lastFocusToken.current || root.contains(document.activeElement);
    lastFocusToken.current = props.focusToken;
    if (!wanted) return;
    const target = root.querySelector<HTMLElement>(`[data-row="${selection.active.row}"][data-col="${selection.active.col}"]`);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [selection.active, editing, props.focusToken, first, last, sheetId]);

  const move = (dRow: number, dCol: number, extend: boolean): void => {
    const active = { row: clampRow(selection.active.row + dRow), col: clampCol(selection.active.col + dCol) };
    props.onSelect({ anchor: extend ? selection.anchor : active, active });
  };
  const jump = (active: Point, extend = false): void => props.onSelect({ anchor: extend ? selection.anchor : active, active });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (editing || e.target === editor.current) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const handled = (): void => e.preventDefault();
    if (ctrl && e.key === "PageDown") return void (handled(), props.onSheetStep(1));
    if (ctrl && e.key === "PageUp") return void (handled(), props.onSheetStep(-1));
    if (ctrl && e.key === "Home") return void (handled(), jump({ row: 1, col: 1 }, e.shiftKey));
    if (ctrl && (e.key === "b" || e.key === "B")) return void (handled(), props.onBold());
    switch (e.key) {
      case "ArrowUp":
        return void (handled(), move(-1, 0, e.shiftKey));
      case "ArrowDown":
        return void (handled(), move(1, 0, e.shiftKey));
      case "ArrowLeft":
        return void (handled(), move(0, -1, e.shiftKey));
      case "ArrowRight":
        return void (handled(), move(0, 1, e.shiftKey));
      case "Home":
        return void (handled(), jump({ row: selection.active.row, col: 1 }, e.shiftKey));
      case "End":
        return void (handled(), jump({ row: selection.active.row, col: LIMITS.maxColumns }, e.shiftKey));
      case "PageDown":
        return void (handled(), move(pageRows, 0, e.shiftKey));
      case "PageUp":
        return void (handled(), move(-pageRows, 0, e.shiftKey));
      case "Enter":
      case "F2":
        handled();
        if (props.readOnly) props.onReadOnlyType();
        else props.onEditStart(engine.input(sheetId, cellName(selection.active.row, selection.active.col)));
        return;
      case "Delete":
      case "Backspace":
        handled();
        if (props.readOnly) props.onReadOnlyType();
        else props.onClear();
        return;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) {
          handled();
          if (props.readOnly) props.onReadOnlyType();
          else props.onEditStart(e.key);
        }
    }
  };

  const pointOf = (target: EventTarget): Point | null => {
    const el = (target as HTMLElement).closest<HTMLElement>("[data-row]");
    return el ? { row: Number(el.dataset.row), col: Number(el.dataset.col) } : null;
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const p = pointOf(e.target);
    if (!p) return;
    if (editing) props.onCommit(0, 0);
    dragging.current = true;
    jump(p, e.shiftKey);
  };

  const onMouseOver = (e: MouseEvent<HTMLDivElement>): void => {
    if (!dragging.current || (e.buttons & 1) === 0) {
      dragging.current = false;
      return;
    }
    const p = pointOf(e.target);
    if (p && (p.row !== selection.active.row || p.col !== selection.active.col)) props.onSelect({ anchor: selection.anchor, active: p });
  };

  useEffect(() => {
    const up = (): void => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    const p = pointOf(e.target);
    if (!p) return;
    if (props.readOnly) props.onReadOnlyType();
    else props.onEditStart(engine.input(sheetId, cellName(p.row, p.col)));
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>): void => {
    if (editing) return;
    e.preventDefault();
    if (props.readOnly) props.onReadOnlyType();
    else props.onPaste(e.clipboardData.getData("text/plain"));
  };

  const editorKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    const commit = (dRow: number, dCol: number): void => {
      e.preventDefault();
      committing.current = true;
      props.onCommit(dRow, dCol);
      committing.current = false;
    };
    if (e.key === "Enter") commit(1, 0);
    else if (e.key === "Tab") commit(0, e.shiftKey ? -1 : 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    }
  };

  const rows: JSX.Element[] = [];
  for (let row = first; row <= last; row++) {
    const cells = COLS.map((col) => {
      const name = cellName(row, col);
      const key = `${sheetId}!${name}`;
      const stored = engine.stored(sheetId, name);
      const { value, display } = stored ? engine.result(sheetId, name) : { value: null, display: "" };
      return (
        <Cell
          key={col}
          cellKey={key}
          row={row}
          col={col}
          display={display}
          numeric={typeof value === "number"}
          error={typeof value === "object" && value !== null}
          bold={stored?.format.bold ?? false}
          selected={row >= top && row <= bottom && col >= left && col <= right}
          active={row === selection.active.row && col === selection.active.col}
          pending={props.pending.has(key)}
          rollback={props.rollbacks.has(key)}
          furrow={props.furrow}
        />
      );
    });
    rows.push(
      <div role="row" aria-rowindex={row} className="grid-row" key={row}>
        <div role="rowheader" className={`rowhead${row >= top && row <= bottom ? " on" : ""}`}>
          {row}
        </div>
        {cells}
      </div>,
    );
  }

  const ref = cellName(selection.active.row, selection.active.col);
  return (
    <div
      className="grid"
      role="grid"
      aria-label={`Sheet ${props.sheetName}`}
      aria-rowcount={LIMITS.maxRows}
      aria-colcount={LIMITS.maxColumns}
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      <div
        className="grid-scroll"
        ref={scroller}
        onScroll={(e) => {
          const t = e.currentTarget.scrollTop;
          setView((v) => (Math.abs(v.top - t) < ROW_H * 4 ? v : { ...v, top: t }));
        }}
        onMouseDown={onMouseDown}
        onMouseOver={onMouseOver}
        onDoubleClick={onDoubleClick}
      >
        <div className="grid-sheet graph-ground" style={{ height: HEAD_H + LIMITS.maxRows * ROW_H }}>
          <div role="row" className="grid-head">
            <div className="corner" aria-hidden="true" />
            {COLS.map((col) => (
              <div role="columnheader" className={`colhead${col >= left && col <= right ? " on" : ""}`} key={col}>
                {columnLetter(col)}
              </div>
            ))}
          </div>
          <div className="grid-spacer" style={{ height: (first - 1) * ROW_H }} aria-hidden="true" />
          {rows}
          {editing && (
            <input
              ref={editor}
              className="cell-editor"
              aria-label={`Edit ${qualifiedCell(props.sheetName, ref)}`}
              style={{ top: HEAD_H + (selection.active.row - 1) * ROW_H, left: ROWHEAD_W + (selection.active.col - 1) * COL_W }}
              value={editing.draft}
              onChange={(e) => props.onDraft(e.target.value)}
              onKeyDown={editorKey}
              onBlur={() => {
                if (!committing.current) props.onCommit(0, 0);
              }}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </div>
      </div>
      <span id="desc-pending" hidden>
        Pending sync
      </span>
      <span id="desc-recalc" hidden>
        Recalculated
      </span>
    </div>
  );
}
