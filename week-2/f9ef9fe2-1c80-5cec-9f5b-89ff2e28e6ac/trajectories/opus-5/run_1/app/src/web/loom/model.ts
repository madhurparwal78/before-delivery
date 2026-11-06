import type { Station } from '../../shared/types';
import { LOOM_COLUMNS, LOOM_START_MINUTE } from '../../shared/types';
import { minutesToHHMM } from '../../shared/format';

export type CellState =
  | 'free'
  | 'selected'
  | 'held'
  | 'booked'
  | 'taken'
  | 'conflict'
  | 'papers';

/** The run label each state prints in small mono caps. */
export const RUN_LABEL: Record<CellState, string> = {
  free: '',
  selected: 'SELECTED',
  held: 'HELD',
  booked: 'BOOKED',
  taken: 'TAKEN',
  conflict: 'CONFLICT',
  papers: 'PAPERS',
};

/** The label each state carries in a cell's accessible name. */
export const STATE_LABEL: Record<CellState, string> = {
  free: 'free',
  selected: 'selected',
  held: 'held',
  booked: 'booked',
  taken: 'taken',
  conflict: 'taken conflicts with your brush',
  papers: 'papers',
};

export const LEGEND: { state: CellState; title: string }[] = [
  { state: 'selected', title: 'Selected' },
  { state: 'held', title: 'Held' },
  { state: 'booked', title: 'Booked' },
  { state: 'taken', title: 'Taken' },
  { state: 'conflict', title: 'Conflict' },
  { state: 'papers', title: 'Papers' },
];

export interface CellInfo {
  state: CellState;
  business?: string;
  holdId?: string;
  expiresAt?: string;
  runLabel?: string;
  runStart?: boolean;
  runLength?: number;
  settling?: boolean;
}

export interface Brush {
  anchorRow: number;
  anchorCol: number;
  row: number;
  col: number;
}

export function brushBox(brush: Brush): { top: number; bottom: number; left: number; right: number } {
  return {
    top: Math.min(brush.anchorRow, brush.row),
    bottom: Math.max(brush.anchorRow, brush.row),
    left: Math.min(brush.anchorCol, brush.col),
    right: Math.max(brush.anchorCol, brush.col),
  };
}

export function columnStart(column: number): string {
  return minutesToHHMM(LOOM_START_MINUTE + column * 15);
}

export function columnOfStart(start: string): number {
  const [hours, minutes] = start.split(':').map(Number);
  return (hours * 60 + minutes - LOOM_START_MINUTE) / 15;
}

export function cellName(station: Station, column: number, info: CellInfo): string {
  const time = columnStart(column);
  if (info.business !== undefined && (info.state === 'booked' || info.state === 'held')) {
    return `${station.name}, ${time}, ${info.state} by ${info.business}`;
  }
  return `${station.name}, ${time}, ${STATE_LABEL[info.state]}`;
}

/** Marks the start and length of every run of two or more equal cells in a row. */
export function markRuns(row: CellInfo[], operator: boolean): void {
  let index = 0;
  while (index < row.length) {
    const info = row[index];
    if (info.state === 'free') {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (
      end < row.length &&
      row[end].state === info.state &&
      row[end].business === info.business
    ) {
      end += 1;
    }
    const length = end - index;
    info.runStart = true;
    info.runLength = length;
    if (length >= 2) {
      info.runLabel =
        operator && info.business !== undefined && (info.state === 'booked' || info.state === 'held')
          ? info.business
          : RUN_LABEL[info.state];
    }
    index = end;
  }
}

export const COLUMNS = LOOM_COLUMNS;
