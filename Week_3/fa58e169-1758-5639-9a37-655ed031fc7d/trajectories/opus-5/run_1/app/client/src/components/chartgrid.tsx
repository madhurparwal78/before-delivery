import { useEffect, useRef } from 'react';
import { NO_STITCH } from '../../../src/domain/symbols';
import type { Cell, RowAnalysis } from '../../../src/domain/types';
import { cellKey, cellLabel, type ChartShape } from '../chartstate';
import { Glyph } from './glyphs';

export interface GridRowState {
  row: number;
  side: string;
  used: number;
  made: number;
  state: string;
  notes?: number;
  follow?: 'current' | 'done' | 'todo';
}

export interface Selection {
  fromRow: number;
  toRow: number;
  fromCol: number;
  toCol: number;
}

export interface Peer {
  row: number;
  col: number;
  name: string;
}

interface ChartGridProps {
  name: string;
  shape: ChartShape;
  cells: Map<string, Cell>;
  rows: GridRowState[];
  analysisRows?: RowAnalysis[];
  cursor: { row: number; col: number };
  selection?: Selection | null;
  peers?: Peer[];
  lifted?: Set<string>;
  pinned?: Set<string>;
  flashes?: Map<string, 'flash' | 'static'>;
  diff?: Map<string, string>;
  motion?: 'row' | null;
  editable?: boolean;
  onCursor?: (row: number, col: number) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onDragStart?: (row: number, col: number) => void;
  onDragMove?: (row: number, col: number) => void;
  onDragEnd?: () => void;
  onCellHover?: (cell: { row: number; col: number } | null) => void;
  onCellFocus?: (cell: { row: number; col: number } | null) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
}

function walk(from: { row: number; col: number }, to: { row: number; col: number }): { row: number; col: number }[] {
  const steps: { row: number; col: number }[] = [];
  const spanRow = to.row - from.row;
  const spanCol = to.col - from.col;
  const length = Math.max(Math.abs(spanRow), Math.abs(spanCol));
  for (let step = 1; step <= length; step += 1) {
    steps.push({
      row: from.row + Math.round((spanRow * step) / length),
      col: from.col + Math.round((spanCol * step) / length),
    });
  }
  return steps;
}

export function ChartGrid(props: ChartGridProps): JSX.Element {
  const {
    name,
    shape,
    cells,
    rows,
    cursor,
    selection,
    peers,
    lifted,
    pinned,
    flashes,
    diff,
    motion,
    editable,
    onCursor,
    onKeyDown,
    onDragStart,
    onDragMove,
    onDragEnd,
    onCellHover,
    onCellFocus,
    scrollRef,
  } = props;
  const dragging = useRef<{ row: number; col: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const cursorCell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stop = (): void => {
      if (!dragging.current) return;
      dragging.current = null;
      onDragEnd?.();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [onDragEnd]);

  useEffect(() => {
    const active = document.activeElement;
    if (active && container.current?.contains(active) && active !== cursorCell.current) {
      cursorCell.current?.focus();
    }
  }, [cursor.row, cursor.col]);

  const cellAt = (clientX: number, clientY: number): { row: number; col: number } | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const found = element?.closest<HTMLElement>('[data-col]');
    if (!found || !container.current?.contains(found)) return null;
    return { row: Number(found.dataset.row), col: Number(found.dataset.col) };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const place = cellAt(event.clientX, event.clientY);
    if (!place) return;
    if (place.row === dragging.current.row && place.col === dragging.current.col) return;
    for (const step of walk(dragging.current, place)) onDragMove?.(step.row, step.col);
    dragging.current = place;
  };

  const rowNumbers: number[] = [];
  for (let row = shape.height; row >= 1; row -= 1) rowNumbers.push(row);

  return (
    <div className="chart-scroll" ref={scrollRef}>
      <div
        role="grid"
        aria-label={name}
        aria-rowcount={shape.height}
        aria-colcount={shape.width}
        className="chart-grid"
        data-motion={motion ?? undefined}
        ref={container}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => onCellHover?.(null)}
      >
        {rowNumbers.map((rowNumber) => {
          const state = rows.find((entry) => entry.row === rowNumber);
          const columns: number[] = [];
          for (let col = 1; col <= shape.width; col += 1) columns.push(col);
          return (
            <div
              role="row"
              key={rowNumber}
              className="chart-row"
              data-row={rowNumber}
              data-side={state?.side ?? 'RS'}
              data-used={state?.used ?? 0}
              data-made={state?.made ?? 0}
              data-count-state={state?.state ?? 'empty'}
              data-notes={state?.notes ? String(state.notes) : undefined}
              data-follow={state?.follow}
            >
              <span role="rowheader" className="row-header">
                {shape.mode === 'round' ? `Rnd ${rowNumber}` : `Row ${rowNumber}`}
              </span>
              {columns.map((col) => {
                const key = cellKey(rowNumber, col);
                const cell =
                  cells.get(key) ?? { row: rowNumber, col, stitch: NO_STITCH, colour: 'A', repeat: null, rev: 0 };
                const selected =
                  selection &&
                  rowNumber >= selection.fromRow &&
                  rowNumber <= selection.toRow &&
                  col >= selection.fromCol &&
                  col <= selection.toCol;
                const peer = peers?.find((entry) => entry.row === rowNumber && entry.col === col);
                const isCursor = cursor.row === rowNumber && cursor.col === col;
                const colour = shape.colours.find((entry) => entry.letter === cell.colour);
                const flash = flashes?.get(key);
                return (
                  <div
                    role="gridcell"
                    key={col}
                    ref={isCursor ? cursorCell : undefined}
                    className="chart-cell"
                    data-row={rowNumber}
                    data-col={col}
                    data-stitch={cell.stitch}
                    data-colour={cell.colour}
                    data-repeat={cell.repeat ?? ''}
                    data-rev={cell.rev}
                    data-diff={diff?.get(key)}
                    data-cursor={isCursor ? 'true' : undefined}
                    data-peer={peer ? peer.name : undefined}
                    data-lift={lifted?.has(key) ? 'twin' : undefined}
                    data-motion={flash === 'flash' ? 'flash' : undefined}
                    data-outline={flash === 'static' ? 'static' : undefined}
                    aria-current={pinned?.has(key) ? 'true' : undefined}
                    aria-selected={selected ? 'true' : undefined}
                    aria-label={cellLabel(shape.craft, cell)}
                    tabIndex={isCursor ? 0 : -1}
                    style={
                      cell.stitch === NO_STITCH
                        ? undefined
                        : { backgroundColor: colour?.hex ?? '#ffffff' }
                    }
                    onPointerDown={(event) => {
                      if (!editable) return;
                      event.preventDefault();
                      (event.target as HTMLElement).closest<HTMLElement>('[data-col]')?.focus();
                      dragging.current = { row: rowNumber, col };
                      onDragStart?.(rowNumber, col);
                    }}
                    onFocus={() => {
                      onCursor?.(rowNumber, col);
                      onCellFocus?.({ row: rowNumber, col });
                    }}
                    onBlur={() => onCellFocus?.(null)}
                    onPointerEnter={() => onCellHover?.({ row: rowNumber, col })}
                  >
                    <Glyph stitch={cell.stitch} craft={shape.craft} />
                  </div>
                );
              })}
              <div role="gridcell" className="row-count" data-count="">
                {state?.made ?? 0}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
