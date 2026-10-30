import { memo, useEffect, useRef, type ReactNode } from 'react';
import type { Station } from '../../shared/types';
import { Check, Clock, FileWarning, Lock, Paintbrush, X } from '../ui/icons';
import { COLUMNS, cellName, columnStart, type CellInfo, type CellState } from './model';

function stateIcon(state: CellState): ReactNode {
  switch (state) {
    case 'selected':
      return <Paintbrush size={14} aria-hidden="true" />;
    case 'held':
      return <Clock size={14} aria-hidden="true" />;
    case 'booked':
      return <Check size={14} aria-hidden="true" />;
    case 'taken':
      return <Lock size={14} aria-hidden="true" />;
    case 'conflict':
      return <X size={14} aria-hidden="true" />;
    case 'papers':
      return <FileWarning size={14} aria-hidden="true" />;
    case 'free':
      return null;
  }
}

export interface GridCallbacks {
  onPointerDownCell: (row: number, col: number) => void;
  onPointerEnterCell: (row: number, col: number) => void;
  onTapCell: (row: number, col: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onHover: (row: number, col: number) => void;
  onHoverOut: () => void;
}

const Row = memo(function Row({
  station,
  rowIndex,
  cells,
  focusRow,
  focusCol,
  hoverCol,
  holdFraction,
  touch,
  callbacks,
}: {
  station: Station;
  rowIndex: number;
  cells: CellInfo[];
  focusRow: number;
  focusCol: number;
  hoverCol: number | null;
  holdFraction: number;
  touch: boolean;
  callbacks: GridCallbacks;
}): ReactNode {
  return (
    <div role="row" className="grid-row">
      <div role="rowheader" className={`rowhead${hoverCol !== null ? ' hot' : ''}`}>
        {station.name}
      </div>
      {cells.map((info, col) => {
        const focused = focusRow === rowIndex && focusCol === col;
        return (
          <div
            key={col}
            role="gridcell"
            className={`cell ${info.state}${info.settling ? ' settling' : ''}${hoverCol === col ? ' hover' : ''}`}
            data-row={rowIndex}
            data-col={col}
            aria-label={cellName(station, col, info)}
            aria-selected={info.state === 'selected' ? true : undefined}
            tabIndex={focused ? 0 : -1}
            onPointerDown={() => {
              if (!touch) callbacks.onPointerDownCell(rowIndex, col);
            }}
            onPointerEnter={() => {
              callbacks.onHover(rowIndex, col);
              if (!touch) callbacks.onPointerEnterCell(rowIndex, col);
            }}
            onClick={() => {
              if (touch) callbacks.onTapCell(rowIndex, col);
            }}
          >
            {stateIcon(info.state)}
            {info.runLabel !== undefined && <span className="run-label">{info.runLabel}</span>}
            {info.state === 'held' && info.runStart && (
              <span
                className="hold-bar"
                style={{ width: `calc(${(info.runLength ?? 1) * holdFraction * 100}% )` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});

export function LoomGrid({
  stations,
  rows,
  focusRow,
  focusCol,
  hover,
  holdFraction,
  touch,
  callbacks,
}: {
  stations: Station[];
  rows: CellInfo[][];
  focusRow: number;
  focusCol: number;
  hover: { row: number; col: number } | null;
  holdFraction: number;
  touch: boolean;
  callbacks: GridCallbacks;
}): ReactNode {
  const frame = useRef<HTMLDivElement | null>(null);
  const hadFocus = useRef(false);

  useEffect(() => {
    const container = frame.current;
    if (!container) return;
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && container.contains(active);
    if (!inside && !hadFocus.current) return;
    const target = container.querySelector<HTMLElement>(
      `[data-row="${focusRow}"][data-col="${focusCol}"]`,
    );
    if (target && inside) target.focus({ preventScroll: false });
  }, [focusRow, focusCol]);

  return (
    <div
      className="loom-frame"
      ref={frame}
      onKeyDown={callbacks.onKeyDown}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onPointerLeave={callbacks.onHoverOut}
    >
      <div role="grid" aria-label="Station loom" className="grid" aria-rowcount={stations.length}>
        <div role="row" className="grid-row head">
          <div role="columnheader" className="rowhead" aria-label="Station">
            Station
          </div>
          {Array.from({ length: COLUMNS }, (_unused, col) => (
            <div
              key={col}
              role="columnheader"
              className={`colhead${hover && hover.col === col ? ' hot' : ''}`}
              aria-label={columnStart(col)}
            >
              {col % 4 === 0 ? columnStart(col) : ''}
            </div>
          ))}
        </div>
        {stations.map((station, rowIndex) => (
          <Row
            key={station.id}
            station={station}
            rowIndex={rowIndex}
            cells={rows[rowIndex] ?? []}
            focusRow={focusRow}
            focusCol={focusCol}
            hoverCol={hover !== null && hover.row === rowIndex ? hover.col : null}
            holdFraction={holdFraction}
            touch={touch}
            callbacks={callbacks}
          />
        ))}
      </div>
    </div>
  );
}
