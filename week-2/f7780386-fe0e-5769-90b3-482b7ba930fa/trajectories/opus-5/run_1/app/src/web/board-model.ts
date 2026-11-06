import type { BoardStation, Segment, StationInfo } from '../shared/api.js';
import { FIRST_CELL, LAST_CELL, computeCost } from '../shared/domain.js';
import { formatDuration, formatHours, formatMoney } from '../shared/format.js';
import { MINUTES_PER_CELL, formatClock, parseClock } from '../shared/time.js';

export function cellToMinutes(cell: number): number {
  return cell * MINUTES_PER_CELL;
}

export function minutesToCell(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_CELL);
}

export function cellClock(cell: number): string {
  return formatClock(cellToMinutes(cell));
}

/** What occupies each cell of one station row, from the viewer's board. */
export interface StationOccupancy {
  /** Cells covered by anything at all, including cleaning tails. */
  blocked: Set<number>;
  ownHoldCells: Map<number, string>;
  ownBookingCells: Map<number, string>;
  tailCells: Set<number>;
}

function spanCells(start: string, end: string): number[] {
  const from = minutesToCell(parseClock(start) ?? 0);
  const to = minutesToCell(parseClock(end) ?? 0);
  const cells: number[] = [];
  for (let cell = from; cell < to; cell += 1) cells.push(cell);
  return cells;
}

export function occupancyOf(station: BoardStation): StationOccupancy {
  const blocked = new Set<number>();
  const ownHoldCells = new Map<number, string>();
  const ownBookingCells = new Map<number, string>();
  const tailCells = new Set<number>();

  for (const segment of station.segments) {
    if (segment.kind === 'occupied') {
      for (const cell of spanCells(segment.start, segment.end)) blocked.add(cell);
      continue;
    }
    for (const cell of spanCells(segment.start, segment.tail_end)) blocked.add(cell);
    for (const cell of spanCells(segment.end, segment.tail_end)) tailCells.add(cell);
    for (const cell of spanCells(segment.start, segment.end)) {
      if (segment.kind === 'hold') ownHoldCells.set(cell, segment.id);
      else ownBookingCells.set(cell, segment.id);
    }
  }
  return { blocked, ownHoldCells, ownBookingCells, tailCells };
}

export interface Band {
  stationId: string;
  anchorCell: number;
  pointerCell: number;
}

export interface BandShape {
  startCell: number;
  /** Exclusive. */
  endCell: number;
  tailEndCell: number;
  conflicts: Map<number, 'Taken' | 'Cleaning clash'>;
  bookedMinutes: number;
}

/**
 * Clamps a band to the last cell that fits, and names the cells it would have
 * hit. The same rule drives the pointer band and the keyboard selection.
 */
export function shapeBand(
  band: Band,
  occupancy: StationOccupancy,
  tailCellCount: number,
  earliestCell: number,
): BandShape {
  const low = Math.min(band.anchorCell, band.pointerCell);
  const high = Math.max(band.anchorCell, band.pointerCell);
  const conflicts = new Map<number, 'Taken' | 'Cleaning clash'>();

  const fits = (start: number, endInclusive: number): boolean => {
    if (start < earliestCell || start < FIRST_CELL) return false;
    if (endInclusive + tailCellCount + 1 > LAST_CELL) return false;
    for (let cell = start; cell <= endInclusive + tailCellCount; cell += 1) {
      if (occupancy.blocked.has(cell)) return false;
    }
    return true;
  };

  let startCell = band.anchorCell;
  let endInclusive = band.anchorCell;
  if (low === band.anchorCell) {
    for (let candidate = band.anchorCell; candidate <= high; candidate += 1) {
      if (!fits(band.anchorCell, candidate)) break;
      endInclusive = candidate;
    }
  } else {
    // Dragging left of the anchor: the anchor is the band's right edge.
    for (let candidate = band.anchorCell; candidate >= low; candidate -= 1) {
      if (!fits(candidate, band.anchorCell)) break;
      startCell = candidate;
    }
    endInclusive = band.anchorCell;
  }

  const tailEndCell = endInclusive + 1 + tailCellCount;

  // Cells the pointer has reached beyond what fits read as conflicts.
  for (let cell = low; cell <= high; cell += 1) {
    if (cell >= startCell && cell <= endInclusive) continue;
    conflicts.set(cell, occupancy.blocked.has(cell) ? 'Taken' : 'Cleaning clash');
  }
  for (let cell = high + 1; cell <= high + tailCellCount; cell += 1) {
    if (cell >= tailEndCell && occupancy.blocked.has(cell)) {
      conflicts.set(cell, 'Cleaning clash');
    }
  }

  return {
    startCell,
    endCell: endInclusive + 1,
    tailEndCell,
    conflicts,
    bookedMinutes: (endInclusive + 1 - startCell) * MINUTES_PER_CELL,
  };
}

/** The tag that follows the band's end, using the same split the server applies. */
export function costTagText(
  bookedMinutes: number,
  balanceMinutes: number,
  station: StationInfo,
): string {
  const rateCents = Math.round(Number(station.hourly_rate) * 100);
  const cost = computeCost(bookedMinutes, balanceMinutes, rateCents);
  return (
    `${formatDuration(cost.booked_minutes)} · ${formatHours(cost.prepaid_minutes)} h prepaid ` +
    `+ $${formatMoney(cost.overage_cents)}`
  );
}

export type CellState =
  | 'free'
  | 'past'
  | 'occupied'
  | 'your hold'
  | 'your booking'
  | 'painting'
  | 'cleaning tail'
  | 'conflict';

export interface CellStateInput {
  cell: number;
  occupancy: StationOccupancy;
  shape: BandShape | null;
  earliestCell: number;
}

export function cellStateOf(input: CellStateInput): CellState {
  const { cell, occupancy, shape } = input;
  if (shape !== null) {
    if (shape.conflicts.has(cell)) return 'conflict';
    if (cell >= shape.startCell && cell < shape.endCell) return 'painting';
    if (cell >= shape.endCell && cell < shape.tailEndCell) return 'cleaning tail';
  }
  if (occupancy.ownHoldCells.has(cell)) return 'your hold';
  if (occupancy.ownBookingCells.has(cell)) return 'your booking';
  if (occupancy.tailCells.has(cell)) return 'cleaning tail';
  if (occupancy.blocked.has(cell)) return 'occupied';
  if (cell < input.earliestCell) return 'past';
  return 'free';
}

export interface DrawnSpan {
  key: string;
  startCell: number;
  endCell: number;
  className: string;
  label: string;
  segment: Segment | null;
}

/** Spans drawn over the cells: own bookings, own holds, cleaning and occupancy. */
export function spansFor(station: BoardStation, showNames: boolean): DrawnSpan[] {
  const spans: DrawnSpan[] = [];
  for (const segment of station.segments) {
    if (segment.kind === 'occupied') {
      spans.push({
        key: `occ-${segment.start}-${segment.end}`,
        startCell: minutesToCell(parseClock(segment.start) ?? 0),
        endCell: minutesToCell(parseClock(segment.end) ?? 0),
        className: 'occupied',
        label: 'Occupied',
        segment,
      });
      continue;
    }
    const bodyStart = minutesToCell(parseClock(segment.start) ?? 0);
    const bodyEnd = minutesToCell(parseClock(segment.end) ?? 0);
    const tailEnd = minutesToCell(parseClock(segment.tail_end) ?? 0);
    const name = showNames && 'business_name' in segment ? (segment.business_name ?? '') : '';
    spans.push({
      key: `seg-${segment.id}`,
      startCell: bodyStart,
      endCell: bodyEnd,
      className: segment.kind === 'hold' ? 'hold' : 'booking',
      label:
        segment.kind === 'hold'
          ? `Hold ${name}`.trim()
          : `${name || 'Booked'}${
              segment.kind === 'booking' && segment.payment === 'payment_pending'
                ? ' · Payment pending'
                : ''
            }`,
      segment,
    });
    if (tailEnd > bodyEnd) {
      spans.push({
        key: `tail-${segment.id}`,
        startCell: bodyEnd,
        endCell: tailEnd,
        className: 'tail',
        label: 'Cleaning',
        segment: null,
      });
    }
  }
  return spans;
}
