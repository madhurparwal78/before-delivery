export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type CellName = `r${number}c${number}`;

export const CELL_COUNT = 81;
export const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const CELL_PATTERN = /^r([1-9])c([1-9])$/;

export function cellName(index: number): CellName {
  return `r${Math.floor(index / 9) + 1}c${(index % 9) + 1}`;
}

/** The value as a cell name, or null when it is not `r<1-9>c<1-9>`. */
export function toCellName(value: unknown): CellName | null {
  return typeof value === "string" && CELL_PATTERN.test(value) ? (value as CellName) : null;
}

/** Index 0 to 80 of a well-formed cell name. */
export function cellIndex(name: CellName): number {
  return (Number(name[1]) - 1) * 9 + (Number(name[3]) - 1);
}

export function isDigit(value: unknown): value is Digit {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9;
}

export const rowOf = (index: number): number => Math.floor(index / 9);
export const columnOf = (index: number): number => index % 9;
export const boxOf = (index: number): number => Math.floor(rowOf(index) / 3) * 3 + Math.floor(columnOf(index) / 3);

/** The 20 other cells in each cell's row, column and box. */
export const PEERS: readonly (readonly number[])[] = Array.from({ length: CELL_COUNT }, (_, index) =>
  Array.from({ length: CELL_COUNT }, (_, other) => other).filter(
    (other) =>
      other !== index &&
      (rowOf(other) === rowOf(index) || columnOf(other) === columnOf(index) || boxOf(other) === boxOf(index)),
  ),
);

/** Digits of a notes bitmask (bit d set for digit d), ascending. */
export function notesDigits(mask: number): Digit[] {
  return DIGITS.filter((digit) => mask & (1 << digit));
}
