import { Unit } from '../shared/units';
import { Piece } from './types';

export interface Chip extends Piece {
  rotated: boolean;
  unknown: Array<[string, unknown]>;
}

export const MAX_HISTORY_STEPS = 50;

/** Snap mark k counted from the board's left end, computed from k and never accumulated. */
export function markAt(k: number, unit: Unit): number {
  return unit === 'mm' ? k * 10 : Math.floor((k * 127 + 5) / 10);
}

function approximateIndex(position: number, unit: Unit): number {
  return Math.floor(position / (unit === 'mm' ? 10 : 12.7));
}

export function nextMark(start: number, unit: Unit): number {
  let k = Math.max(0, approximateIndex(start, unit) - 2);
  while (markAt(k, unit) <= start) k += 1;
  return markAt(k, unit);
}

export function previousMark(start: number, unit: Unit): number {
  let k = approximateIndex(start, unit) + 2;
  while (k > 0 && markAt(k, unit) >= start) k -= 1;
  const candidate = markAt(Math.max(k, 0), unit);
  return candidate < start ? candidate : 0;
}

/** The mark nearest a dragged position; exactly halfway goes to the larger mark. */
export function nearestMark(position: number, unit: Unit): number {
  const around = approximateIndex(position, unit);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let k = Math.max(0, around - 2); k <= around + 2; k += 1) {
    const mark = markAt(k, unit);
    const distance = Math.abs(mark - position);
    if (distance < bestDistance || (distance === bestDistance && mark > best)) {
      best = mark;
      bestDistance = distance;
    }
  }
  return best;
}

export function cloneChips(chips: Chip[]): Chip[] {
  return chips.map((chip) => ({ ...chip, unknown: chip.unknown.map(([key, value]): [string, unknown] => [key, value]) }));
}

export function signatureOf(chips: Chip[]): string {
  return JSON.stringify(
    chips.map((chip) => [chip.label, chip.length_mm, chip.width_mm, chip.start_mm, chip.rotated])
  );
}

/** The layout editor's undo and redo history: one entry per step, up to 50 undoable steps. */
export class LayoutHistory {
  private states: Chip[][];
  private index = 0;
  private pending: Chip[] | null = null;

  public constructor(initial: Chip[]) {
    this.states = [cloneChips(initial)];
  }

  public get canUndo(): boolean {
    return this.index > 0;
  }

  public get canRedo(): boolean {
    return this.index < this.states.length - 1;
  }

  public reset(chips: Chip[]): void {
    this.states = [cloneChips(chips)];
    this.index = 0;
    this.pending = null;
  }

  public begin(chips: Chip[]): void {
    if (this.pending === null) this.pending = cloneChips(chips);
  }

  public get hasPending(): boolean {
    return this.pending !== null;
  }

  public commit(chips: Chip[]): void {
    const before = this.pending ?? this.states[this.index] ?? [];
    this.pending = null;
    if (signatureOf(before) === signatureOf(chips)) return;
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(cloneChips(chips));
    while (this.states.length > MAX_HISTORY_STEPS + 1) this.states.shift();
    this.index = this.states.length - 1;
  }

  public undo(): Chip[] | null {
    if (!this.canUndo) return null;
    this.index -= 1;
    return cloneChips(this.states[this.index] ?? []);
  }

  public redo(): Chip[] | null {
    if (!this.canRedo) return null;
    this.index += 1;
    return cloneChips(this.states[this.index] ?? []);
  }
}
