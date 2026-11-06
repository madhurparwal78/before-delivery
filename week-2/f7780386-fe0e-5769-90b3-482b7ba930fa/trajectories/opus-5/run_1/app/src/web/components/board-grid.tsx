import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import type { BoardResponse, Segment, StationInfo } from '../../shared/api.js';
import { FIRST_CELL, LAST_CELL } from '../../shared/domain.js';
import { MINUTES_PER_CELL, formatClock, parseClock } from '../../shared/time.js';
import { RollingText } from './rolling-text.js';
import {
  cellClock,
  cellStateOf,
  cellToMinutes,
  costTagText,
  minutesToCell,
  occupancyOf,
  shapeBand,
  spansFor,
  type Band,
  type BandShape,
  type StationOccupancy,
} from '../board-model.js';

const TOUCH_HOLD_MS = 500;
const FLIGHT_MS = 330;
const LOSS_SHAKE_MS = 330;
const LOSS_STATIC_MS = 2000;

export type PlaceOutcome = 'placed' | 'lost' | 'refused';

export interface BoardGridProps {
  board: BoardResponse;
  stations: StationInfo[];
  canPaint: boolean;
  showNames: boolean;
  balanceMinutes: number;
  isToday: boolean;
  nowMinutes: number;
  reducedMotion: boolean;
  onPlaceHold: (stationId: string, startMinutes: number, endMinutes: number) => Promise<PlaceOutcome>;
  onResizeHold: (holdId: string, endMinutes: number) => Promise<void>;
  onReleaseHold: (holdId: string) => Promise<void>;
  onOpenSegment: (segment: Segment, restoreFocus: () => void) => void;
  /** Holds whose server expiry has just passed, shown fading out. */
  expiringHoldIds: ReadonlySet<string>;
}

interface Cursor {
  row: number;
  cell: number;
}

function flyToRail(from: DOMRect): void {
  const rail = document.querySelector('.rail-list');
  if (rail === null) return;
  const target = rail.getBoundingClientRect();
  const flight = document.createElement('div');
  flight.className = 'flight';
  flight.style.left = `${from.left}px`;
  flight.style.top = `${from.top}px`;
  flight.style.width = `${from.width}px`;
  flight.style.height = `${from.height}px`;
  flight.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.2,0.7,0.3,1), opacity ${FLIGHT_MS}ms linear`;
  document.body.append(flight);
  requestAnimationFrame(() => {
    const dx = target.left + target.width - 90 - from.left;
    const dy = target.top + 8 - from.top;
    flight.style.transform = `translate(${dx}px, ${dy}px) scale(0.9)`;
    flight.style.opacity = '0.2';
  });
  window.setTimeout(() => flight.remove(), FLIGHT_MS + 60);
}

export function BoardGrid(props: BoardGridProps): ReactNode {
  const { board, stations, canPaint, reducedMotion } = props;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [placing, setPlacing] = useState(false);
  const [loss, setLoss] = useState<{ stationId: string; start: number; end: number } | null>(null);
  const [cursor, setCursor] = useState<Cursor>({ row: 0, cell: FIRST_CELL });
  const [selection, setSelection] = useState<Band | null>(null);
  const touchTimer = useRef<number | null>(null);

  const stationInfo = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations],
  );

  const occupancy = useMemo(() => {
    const map = new Map<string, StationOccupancy>();
    for (const station of board.stations) map.set(station.id, occupancyOf(station));
    return map;
  }, [board]);

  const earliestCell = props.isToday
    ? Math.max(FIRST_CELL, minutesToCell(props.nowMinutes))
    : FIRST_CELL;

  const tailCellsFor = useCallback(
    (stationId: string): number => (stationInfo.get(stationId)?.cleaning_minutes ?? 0) / 15,
    [stationInfo],
  );

  const activeBand = band ?? selection;

  const shapeFor = useCallback(
    (stationId: string): BandShape | null => {
      if (activeBand === null || activeBand.stationId !== stationId) return null;
      const occ = occupancy.get(stationId);
      if (occ === undefined) return null;
      return shapeBand(activeBand, occ, tailCellsFor(stationId), earliestCell);
    },
    [activeBand, occupancy, tailCellsFor, earliestCell],
  );

  // On the kitchen's today the board opens at the hour containing now.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const cellWidth = frame.querySelector('.cell')?.getBoundingClientRect().width ?? 20;
    const hourCell = props.isToday
      ? Math.floor(minutesToCell(props.nowMinutes) / 4) * 4
      : FIRST_CELL;
    frame.scrollLeft = Math.max(0, (hourCell - FIRST_CELL) * cellWidth);
    // Only when the shown date changes, not on every poll.
  }, [board.date, props.isToday]);

  const clearBand = useCallback(() => {
    setBand(null);
    setPlacing(false);
  }, []);

  const showLoss = useCallback(
    (stationId: string, shape: BandShape) => {
      setLoss({ stationId, start: shape.startCell, end: shape.endCell });
      window.setTimeout(
        () => setLoss(null),
        reducedMotion ? LOSS_STATIC_MS : LOSS_SHAKE_MS,
      );
    },
    [reducedMotion],
  );

  const commit = useCallback(
    async (current: Band) => {
      const shape = shapeFor(current.stationId);
      if (shape === null || shape.endCell <= shape.startCell) {
        clearBand();
        setSelection(null);
        return;
      }
      const rect = gridRef.current
        ?.querySelector(`[data-band-station="${current.stationId}"]`)
        ?.getBoundingClientRect();
      setPlacing(true);
      const outcome = await props.onPlaceHold(
        current.stationId,
        cellToMinutes(shape.startCell),
        cellToMinutes(shape.endCell),
      );
      setPlacing(false);
      if (outcome === 'placed') {
        if (!reducedMotion && rect !== undefined) flyToRail(rect);
      } else if (outcome === 'lost') {
        showLoss(current.stationId, shape);
      }
      setBand(null);
      setSelection(null);
    },
    [shapeFor, clearBand, props, reducedMotion, showLoss],
  );

  const cellFromPoint = (x: number, y: number): { stationId: string; cell: number } | null => {
    const element = document.elementFromPoint(x, y);
    const holder = element?.closest('[data-cell]');
    if (holder === null || holder === undefined) return null;
    const stationId = holder.getAttribute('data-station');
    const cell = Number(holder.getAttribute('data-cell'));
    if (stationId === null || Number.isNaN(cell)) return null;
    return { stationId, cell };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = (event.target as HTMLElement).closest('[data-cell]');
    if (target === null) return;
    const stationId = target.getAttribute('data-station');
    const cell = Number(target.getAttribute('data-cell'));
    if (stationId === null) return;

    const occ = occupancy.get(stationId);
    if (occ === undefined) return;

    const holdId = occ.ownHoldCells.get(cell);
    const bookingId = occ.ownBookingCells.get(cell);
    if (holdId !== undefined || bookingId !== undefined) {
      const station = board.stations.find((candidate) => candidate.id === stationId);
      const segment = station?.segments.find(
        (candidate) => candidate.kind !== 'occupied' && candidate.id === (holdId ?? bookingId),
      );
      if (segment !== undefined) {
        props.onOpenSegment(segment, () => gridRef.current?.focus());
      }
      return;
    }

    if (!canPaint) return;
    const state = cellStateOf({ cell, occupancy: occ, shape: null, earliestCell });
    if (state !== 'free') return;

    const start = (): void => {
      setSelection(null);
      setBand({ stationId, anchorCell: cell, pointerCell: cell });
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };

    if (event.pointerType === 'touch') {
      // A plain swipe still scrolls the board frame.
      touchTimer.current = window.setTimeout(start, TOUCH_HOLD_MS);
    } else {
      event.preventDefault();
      start();
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (touchTimer.current !== null && band === null) {
      window.clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
    if (band === null) return;
    event.preventDefault();
    const found = cellFromPoint(event.clientX, event.clientY);
    if (found === null || found.stationId !== band.stationId) return;
    if (found.cell !== band.pointerCell) {
      setBand({ ...band, pointerCell: found.cell });
    }
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (touchTimer.current !== null) {
      window.clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
    if (band === null) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    void commit(band);
  };

  const openAt = (row: number, cell: number, focusField: 'confirm' | 'cancel'): void => {
    const station = board.stations[row];
    if (station === undefined) return;
    const occ = occupancy.get(station.id);
    const id =
      focusField === 'confirm' ? occ?.ownHoldCells.get(cell) : occ?.ownBookingCells.get(cell);
    const segment = station.segments.find(
      (candidate) => candidate.kind !== 'occupied' && candidate.id === id,
    );
    if (segment !== undefined) props.onOpenSegment(segment, () => gridRef.current?.focus());
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const station = board.stations[cursor.row];
    if (station === undefined) return;
    const occ = occupancy.get(station.id);
    if (occ === undefined) return;
    const ownHoldId = occ.ownHoldCells.get(cursor.cell);
    const ownBookingId = occ.ownBookingCells.get(cursor.cell);

    const move = (rowDelta: number, cellDelta: number): void => {
      event.preventDefault();
      setSelection(null);
      setCursor((current) => ({
        row: Math.min(Math.max(0, current.row + rowDelta), board.stations.length - 1),
        cell: Math.min(Math.max(FIRST_CELL, current.cell + cellDelta), LAST_CELL - 1),
      }));
    };

    const extend = (delta: number): void => {
      event.preventDefault();
      if (ownHoldId !== undefined) {
        const segment = station.segments.find(
          (candidate) => candidate.kind === 'hold' && candidate.id === ownHoldId,
        );
        if (segment === undefined || segment.kind !== 'hold') return;
        const currentEnd = parseClock(segment.end) ?? 0;
        void props.onResizeHold(ownHoldId, currentEnd + MINUTES_PER_CELL * delta);
        return;
      }
      if (!canPaint) return;
      setSelection((current) => {
        if (current === null || current.stationId !== station.id) {
          return { stationId: station.id, anchorCell: cursor.cell, pointerCell: cursor.cell };
        }
        return { ...current, pointerCell: current.pointerCell + delta };
      });
    };

    switch (event.key) {
      case 'ArrowUp':
        move(-1, 0);
        return;
      case 'ArrowDown':
        move(1, 0);
        return;
      case 'ArrowLeft':
        if (event.shiftKey) extend(-1);
        else move(0, -1);
        return;
      case 'ArrowRight':
        if (event.shiftKey) extend(1);
        else move(0, 1);
        return;
      case 'Enter':
        event.preventDefault();
        if (selection !== null) {
          void commit(selection);
          return;
        }
        if (ownHoldId !== undefined) openAt(cursor.row, cursor.cell, 'confirm');
        else if (ownBookingId !== undefined) openAt(cursor.row, cursor.cell, 'cancel');
        return;
      case 'Escape':
        event.preventDefault();
        if (selection !== null) {
          setSelection(null);
          return;
        }
        if (ownHoldId !== undefined) void props.onReleaseHold(ownHoldId);
        return;
      default:
    }
  };

  // Focus lands on the first free cell at or after now, on the first row.
  useEffect(() => {
    setCursor({ row: 0, cell: earliestCell });
  }, [board.date, earliestCell]);

  const hourLabels: ReactNode[] = [];
  for (let cell = FIRST_CELL; cell < LAST_CELL; cell += 4) {
    hourLabels.push(
      <span key={cell} className="hour-label">
        {cellClock(cell)}
      </span>,
    );
  }

  const activeCellId = `cell-${board.stations[cursor.row]?.id ?? ''}-${cursor.cell}`;
  const nowCell = props.nowMinutes / 15;

  return (
    <div className="board-frame" ref={frameRef}>
      <div
        className="board-grid"
        role="grid"
        aria-label="Line board"
        tabIndex={0}
        ref={gridRef}
        aria-activedescendant={activeCellId}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <div className="board-row head" role="row">
          <span className="rowheader" role="columnheader">
            Station
          </span>
          <div className="row-cells">{hourLabels}</div>
        </div>

        {board.stations.map((station, rowIndex) => {
          const occ = occupancy.get(station.id);
          if (occ === undefined) return null;
          const shape = shapeFor(station.id);
          const info = stationInfo.get(station.id);
          const cells: ReactNode[] = [];
          for (let cell = FIRST_CELL; cell < LAST_CELL; cell += 1) {
            const state = cellStateOf({ cell, occupancy: occ, shape, earliestCell });
            cells.push(
              <div
                key={cell}
                id={`cell-${station.id}-${cell}`}
                role="gridcell"
                data-cell={cell}
                data-station={station.id}
                aria-label={`${station.name}, ${cellClock(cell)}, ${state}`}
                className={[
                  'cell',
                  cell % 4 === 0 ? 'hour-start' : '',
                  state === 'past' ? 'past' : '',
                  state === 'conflict' ? 'conflict' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />,
            );
          }

          return (
            <div className="board-row" role="row" key={station.id}>
              <span className="rowheader" role="rowheader">
                {station.name}
              </span>
              <div className="row-cells">
                {cells}
                {spansFor(station, props.showNames).map((span) => (
                  <div
                    key={span.key}
                    className={[
                      'span',
                      span.className,
                      span.segment !== null &&
                      span.segment.kind !== 'occupied' &&
                      props.expiringHoldIds.has(span.segment.id)
                        ? 'expiring'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: `calc((${span.startCell} - ${FIRST_CELL}) * var(--cell-w))`,
                      width: `calc(${span.endCell - span.startCell} * var(--cell-w))`,
                    }}
                    onPointerDown={(event) => {
                      if (span.segment !== null && span.segment.kind !== 'occupied') {
                        event.stopPropagation();
                        props.onOpenSegment(span.segment, () => gridRef.current?.focus());
                      }
                    }}
                  >
                    {span.label}
                  </div>
                ))}

                {shape === null ? null : (
                  <>
                    <div
                      className={`span band${placing ? ' pending' : ''}`}
                      data-band-station={station.id}
                      style={{
                        left: `calc((${shape.startCell} - ${FIRST_CELL}) * var(--cell-w))`,
                        width: `calc(${shape.endCell - shape.startCell} * var(--cell-w))`,
                      }}
                    />
                    {shape.tailEndCell > shape.endCell ? (
                      <div
                        className="span tail band-tail"
                        style={{
                          left: `calc((${shape.endCell} - ${FIRST_CELL}) * var(--cell-w))`,
                          width: `calc(${shape.tailEndCell - shape.endCell} * var(--cell-w))`,
                        }}
                      />
                    ) : null}
                    {info === undefined ? null : (
                      <div
                        role="status"
                        aria-label="Paint cost"
                        className="cost-tag"
                        style={{
                          left: `calc((${shape.tailEndCell} - ${FIRST_CELL}) * var(--cell-w) + 4px)`,
                          top: '2px',
                        }}
                      >
                        <RollingText
                          text={costTagText(shape.bookedMinutes, props.balanceMinutes, info)}
                        />
                      </div>
                    )}
                  </>
                )}

                {shape === null
                  ? null
                  : conflictRuns(shape).map((run) => (
                      <div
                        key={`clash-${run.start}`}
                        className="span conflict-label"
                        style={{
                          left: `calc((${run.start} - ${FIRST_CELL}) * var(--cell-w))`,
                          width: `calc(${run.end - run.start} * var(--cell-w))`,
                        }}
                      >
                        {run.label}
                      </div>
                    ))}

                {loss !== null && loss.stationId === station.id ? (
                  <div
                    className="span loss"
                    style={{
                      left: `calc((${loss.start} - ${FIRST_CELL}) * var(--cell-w))`,
                      width: `calc(${loss.end - loss.start} * var(--cell-w))`,
                    }}
                  />
                ) : null}

                {rowIndex === cursor.row ? (
                  <div
                    className="cell-cursor"
                    style={{
                      left: `calc((${cursor.cell} - ${FIRST_CELL}) * var(--cell-w))`,
                      width: 'var(--cell-w)',
                    }}
                  />
                ) : null}

                {props.isToday && nowCell >= FIRST_CELL && nowCell <= LAST_CELL ? (
                  <div
                    className="now-line"
                    style={{ left: `calc((${nowCell} - ${FIRST_CELL}) * var(--cell-w))` }}
                  >
                    {rowIndex === 0 ? <span>Now {formatClock(Math.floor(props.nowMinutes))}</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ConflictRun {
  start: number;
  end: number;
  label: string;
}

/** Groups neighbouring conflict cells so the label is readable over the run. */
function conflictRuns(shape: BandShape): ConflictRun[] {
  const cells = [...shape.conflicts.entries()].sort(([a], [b]) => a - b);
  const runs: ConflictRun[] = [];
  for (const [cell, label] of cells) {
    const last = runs.at(-1);
    if (last !== undefined && last.end === cell && last.label === label) {
      last.end = cell + 1;
    } else {
      runs.push({ start: cell, end: cell + 1, label });
    }
  }
  return runs;
}
