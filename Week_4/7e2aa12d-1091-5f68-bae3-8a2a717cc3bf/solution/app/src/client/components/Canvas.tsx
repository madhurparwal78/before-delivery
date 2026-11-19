import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { containsCell, sameRect } from '../../shared/grid.js';
import { rangeOf, sizeUnit, stepSize } from '../../shared/sizes.js';
import type { Axis, Grid, Rect, Scope } from '../../shared/types.js';
import { play } from '../lib/motion.js';
import type { Outcome } from '../lib/workspace.js';
import { CommitField } from './CommitField.js';
import { CloseIcon, GripIcon } from './Icons.js';

interface Cell {
  row: number;
  column: number;
}

interface Selection {
  cursor: Cell;
  anchor: Cell;
}

const DRAG_STEP_PX = 20;

export const rectOfSelection = ({ cursor, anchor }: Selection): Rect => ({
  row_start: Math.min(cursor.row, anchor.row),
  column_start: Math.min(cursor.column, anchor.column),
  row_end: Math.max(cursor.row, anchor.row) + 1,
  column_end: Math.max(cursor.column, anchor.column) + 1,
});

const clampCell = (cell: Cell, rows: number, columns: number): Cell => ({ row: Math.min(rows, Math.max(1, cell.row)), column: Math.min(columns, Math.max(1, cell.column)) });

/** The cursor cell and the anchor cell, kept inside the grid. */
export function useSelection(rows: number, columns: number) {
  const [raw, setRaw] = useState<Selection>({ cursor: { row: 1, column: 1 }, anchor: { row: 1, column: 1 } });
  const selection: Selection = { cursor: clampCell(raw.cursor, rows, columns), anchor: clampCell(raw.anchor, rows, columns) };
  return { selection, set: setRaw };
}

/** The size after up to `steps` separator steps, stopping at the edge of its range. */
function sizeAfter(size: string, steps: number): string {
  let next = size;
  for (let i = 0; i < Math.abs(steps); i++) {
    const moved = stepSize(next, steps > 0 ? 1 : -1);
    if (!moved) break;
    next = moved;
  }
  return next;
}

interface SeparatorProps {
  axis: Axis;
  index: number;
  size: string;
  /** The size while dragging, shown instead of the stored one. */
  drag: string | null;
  onDrag: (size: string | null) => void;
  onStep: (direction: 1 | -1) => void;
  onResize: (size: string) => void;
}

function Separator({ axis, index, size, drag, onDrag, onStep, onResize }: SeparatorProps) {
  const range = rangeOf(size);
  const start = useRef<{ from: number; size: string; latest: string } | null>(null);
  const shown = drag ?? size;
  const travel = (event: PointerEvent): number => (axis === 'column' ? event.clientX : event.clientY);

  const finish = (event: PointerEvent<HTMLDivElement>, apply: boolean): void => {
    const current = start.current;
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onDrag(null);
    if (apply && current && current.latest !== current.size) onResize(current.latest);
  };

  const aria = range
    ? { tabIndex: 0, 'aria-valuenow': Number.parseFloat(shown), 'aria-valuemin': range[0], 'aria-valuemax': range[1] }
    : { tabIndex: -1, 'aria-disabled': true as const, 'aria-valuenow': 0, 'aria-valuemin': 0, 'aria-valuemax': 0 };

  return (
    <div
      role="separator"
      aria-label={`Resize ${axis} ${index}`}
      aria-orientation={axis === 'column' ? 'vertical' : 'horizontal'}
      aria-valuetext={shown}
      className={`separator ${axis}`}
      {...aria}
      onKeyDown={(event: KeyboardEvent) => {
        if (!range) return;
        const grow = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        const shrink = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        if (!grow && !shrink) return;
        event.preventDefault();
        onStep(grow ? 1 : -1);
      }}
      onPointerDown={(event) => {
        if (!range || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { from: travel(event), size, latest: size };
      }}
      onPointerMove={(event) => {
        const current = start.current;
        if (!current) return;
        current.latest = sizeAfter(current.size, Math.trunc((travel(event) - current.from) / DRAG_STEP_PX));
        onDrag(current.latest);
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
    >
      <GripIcon vertical={axis === 'row'} />
    </div>
  );
}

export interface TrackActions {
  setSize: (axis: Axis, index: number, text: string) => Promise<Outcome>;
  step: (axis: Axis, index: number, direction: 1 | -1) => void;
  remove: (axis: Axis, index: number) => void;
}

/** What only the editor can do on the grid; the view page passes none of it and the grid reads only. */
interface Editing {
  tracks: TrackActions;
  onName: () => void;
  onClear: () => void;
  onTrackKey: (key: 'c' | 'C' | 'r' | 'R') => void;
}

interface CanvasProps {
  grid: Grid;
  scope: Scope;
  /** The resolved width of each column, whole pixels. */
  resolved: number[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  editing?: Editing;
}

const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

function cellOf(node: EventTarget | Element | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[role=gridcell]') : null;
}

const cellAddress = (cell: HTMLElement): Cell => ({ row: Number(cell.dataset.row), column: Number(cell.dataset.column) });

/** The editable (or read-only) grid: ruler headers along the top and left, cells, and the area blocks drawn over them. */
export function Canvas({ grid, scope, resolved, selection, onSelect, editing }: CanvasProps) {
  const readOnly = editing === undefined;
  const sheet = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ axis: Axis; index: number; size: string } | null>(null);
  const pointer = useRef<{ id: number; moved: boolean } | null>(null);
  const wantFocus = useRef(false);
  const hadFocus = useRef(false);
  const blocks = useRef(new Map<string, HTMLElement>());
  const before = useRef<{ scope: Scope; rects: Map<string, { x: number; y: number; w: number; h: number }> } | null>(null);
  const { cursor, anchor } = selection;
  const rows = grid.rows.length;
  const columns = grid.columns.length;
  const selected = rectOfSelection(selection);

  const focusCursor = (): void => sheet.current?.querySelector<HTMLElement>(`[role=gridcell][data-row="${cursor.row}"][data-column="${cursor.column}"]`)?.focus();

  useEffect(() => {
    if (wantFocus.current) {
      wantFocus.current = false;
      focusCursor();
    }
  });

  useEffect(() => {
    if (hadFocus.current && !sheet.current?.contains(document.activeElement)) focusCursor();
  }, [rows, columns]);

  /** The Breakpoint Fold: a block present in the old and the new scope glides from its old cells to its new cells. */
  useLayoutEffect(() => {
    const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const [name, element] of blocks.current) rects.set(name, { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight });
    const earlier = before.current;
    if (earlier && earlier.scope !== scope) {
      for (const [name, now] of rects) {
        const was = earlier.rects.get(name);
        const element = blocks.current.get(name);
        if (!was || !element || (was.x === now.x && was.y === now.y && was.w === now.w && was.h === now.h)) continue;
        const from = `translate(${was.x - now.x}px, ${was.y - now.y}px) scale(${was.w / now.w}, ${was.h / now.h})`;
        play(element, 'fold', [
          { transformOrigin: '0 0', transform: from },
          { transformOrigin: '0 0', transform: 'none' },
        ]);
      }
    }
    before.current = { scope, rects };
  });

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!cellOf(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const delta = MOVES[event.key];
    if (delta) {
      event.preventDefault();
      const next = clampCell({ row: cursor.row + delta[0], column: cursor.column + delta[1] }, rows, columns);
      wantFocus.current = true;
      onSelect({ cursor: next, anchor: event.shiftKey ? anchor : next });
      return;
    }
    if (!editing) return;
    if (event.key === 'Enter') editing.onName();
    else if (event.key === 'Delete' || event.key === 'Backspace') editing.onClear();
    else if (event.key === 'c' || event.key === 'C' || event.key === 'r' || event.key === 'R') editing.onTrackKey(event.key);
    else return;
    event.preventDefault();
  };

  const press = (event: PointerEvent<HTMLDivElement>): void => {
    const cell = cellOf(event.target);
    if (!cell || event.button !== 0) return;
    const at = cellAddress(cell);
    cell.focus();
    onSelect({ cursor: at, anchor: at });
    if (!editing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, moved: false };
  };

  const drive = (event: PointerEvent<HTMLDivElement>): void => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const hit = cellOf(document.elementFromPoint(event.clientX, event.clientY));
    if (!hit) return;
    const at = cellAddress(hit);
    if (at.row !== cursor.row || at.column !== cursor.column) {
      current.moved = true;
      onSelect({ cursor: at, anchor });
    }
  };

  const release = (event: PointerEvent<HTMLDivElement>, open: boolean): void => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (open && current.moved && !sameRect(selected, rectOfSelection({ cursor: anchor, anchor }))) editing?.onName();
  };

  const columnTrack = (index: number) => {
    const size = grid.columns[index - 1];
    return { size, unit: sizeUnit(size) };
  };

  return (
    <div className="canvas-scroll">
      <div
        role="grid"
        aria-label="Layout grid"
        className="sheet"
        ref={sheet}
        data-readonly={readOnly || undefined}
        style={{ minWidth: `calc(var(--row-head) + ${columns} * var(--col-min))`, gridTemplateColumns: `var(--row-head) repeat(${columns}, minmax(var(--col-min), 1fr))`, gridTemplateRows: `auto repeat(${rows}, minmax(var(--row-min), auto))` }}
        onKeyDown={move}
        onPointerDown={press}
        onPointerMove={drive}
        onPointerUp={(event) => release(event, true)}
        onPointerCancel={(event) => release(event, false)}
        onFocus={() => (hadFocus.current = true)}
        onBlur={(event) => {
          if (event.relatedTarget && !sheet.current?.contains(event.relatedTarget as Node)) hadFocus.current = false;
        }}
      >
        <div role="row" className="row-contents">
          <div className="corner" aria-hidden="true" />
          {grid.columns.map((_, i) => {
            const index = i + 1;
            const { size, unit } = columnTrack(index);
            const dragging = drag?.axis === 'column' && drag.index === index ? drag.size : null;
            return (
              <div
                key={index}
                role="columnheader"
                aria-label={`Column ${index}`}
                className="track-head column-head"
                data-track-index={index}
                data-track-size={size}
                data-track-unit={unit}
                data-resolved-px={resolved[i]}
              >
                {editing ? (
                  <div className="head-line">
                    <CommitField label={`Column ${index} size`} value={size} shown={dragging ?? undefined} onCommit={(text) => editing.tracks.setSize('column', index, text)} />
                    <button type="button" className="icon-button" aria-label={`Remove column ${index}`} onClick={() => editing.tracks.remove('column', index)}>
                      <CloseIcon />
                    </button>
                  </div>
                ) : (
                  <span className="track-size mono">{size}</span>
                )}
                <div className="ruler">
                  {editing && (
                    <Separator
                      axis="column"
                      index={index}
                      size={size}
                      drag={dragging}
                      onDrag={(next) => setDrag(next === null ? null : { axis: 'column', index, size: next })}
                      onStep={(direction) => editing.tracks.step('column', index, direction)}
                      onResize={(next) => void editing.tracks.setSize('column', index, next)}
                    />
                  )}
                  <span className="readout mono">{resolved[i] === undefined ? '' : `${resolved[i]}px`}</span>
                </div>
              </div>
            );
          })}
        </div>
        {grid.rows.map((_, r) => {
          const row = r + 1;
          const size = grid.rows[r];
          const dragging = drag?.axis === 'row' && drag.index === row ? drag.size : null;
          return (
            <div key={row} role="row" className="row-contents">
              <div role="rowheader" aria-label={`Row ${row}`} className="track-head row-head" data-track-index={row} data-track-size={size} data-track-unit={sizeUnit(size)}>
                {editing ? (
                  <>
                    <Separator
                      axis="row"
                      index={row}
                      size={size}
                      drag={dragging}
                      onDrag={(next) => setDrag(next === null ? null : { axis: 'row', index: row, size: next })}
                      onStep={(direction) => editing.tracks.step('row', row, direction)}
                      onResize={(next) => void editing.tracks.setSize('row', row, next)}
                    />
                    <CommitField label={`Row ${row} size`} value={size} shown={dragging ?? undefined} onCommit={(text) => editing.tracks.setSize('row', row, text)} />
                    <button type="button" className="icon-button" aria-label={`Remove row ${row}`} onClick={() => editing.tracks.remove('row', row)}>
                      <CloseIcon />
                    </button>
                  </>
                ) : (
                  <span className="track-size mono">{size}</span>
                )}
              </div>
              {grid.columns.map((__, c) => {
                const column = c + 1;
                const owner = grid.areas.find((area) => containsCell(area, row, column));
                const isCursor = cursor.row === row && cursor.column === column;
                const inside = containsCell(selected, row, column);
                return (
                  <div
                    key={column}
                    role="gridcell"
                    aria-label={`Row ${row}, column ${column}, ${owner ? owner.name : 'empty'}`}
                    aria-selected={readOnly ? undefined : inside}
                    tabIndex={isCursor ? 0 : -1}
                    className="cell"
                    data-row={row}
                    data-column={column}
                    data-area={owner ? owner.name : ''}
                    data-cursor={isCursor || undefined}
                    data-selected={(!readOnly && inside) || undefined}
                    style={{ gridRow: row + 1, gridColumn: column + 1 }}
                    onFocus={() => {
                      if (!isCursor) onSelect({ cursor: { row, column }, anchor: { row, column } });
                    }}
                  />
                );
              })}
            </div>
          );
        })}
        {grid.areas.map((area) => (
          <div
            key={area.name}
            aria-hidden="true"
            className="block"
            data-area-name={area.name}
            data-row-start={area.row_start}
            data-column-start={area.column_start}
            data-row-end={area.row_end}
            data-column-end={area.column_end}
            ref={(element) => {
              if (element) blocks.current.set(area.name, element);
              else blocks.current.delete(area.name);
            }}
            style={{ gridRow: `${area.row_start + 1} / ${area.row_end + 1}`, gridColumn: `${area.column_start + 1} / ${area.column_end + 1}` }}
          >
            <span className="mono">{area.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
