// The shadow board: where parts hang, what each tool's status is, and the board counts.

export const COLUMNS = 10;

export interface Placement {
  col: number;
  row: number;
  width: number;
  height: number;
}

/** First position, row by row from the top and column by column from the left, where each rectangle fits. */
export function placeParts(existing: readonly Placement[], sizes: ReadonlyArray<{ width: number; height: number }>): Placement[] {
  const taken = new Set<string>();
  const occupy = (p: Placement) => {
    for (let dx = 0; dx < p.width; dx++) for (let dy = 0; dy < p.height; dy++) taken.add(`${p.col + dx},${p.row + dy}`);
  };
  existing.forEach(occupy);
  const fits = (col: number, row: number, width: number, height: number) => {
    for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) if (taken.has(`${col + dx},${row + dy}`)) return false;
    return true;
  };
  return sizes.map(({ width, height }) => {
    for (let row = 0; ; row++) {
      for (let col = 0; col + width <= COLUMNS; col++) {
        if (fits(col, row, width, height)) {
          const spot = { col, row, width, height };
          occupy(spot);
          return spot;
        }
      }
    }
  });
}

export type PartState = "hung" | "out" | "missing";
export type ItemStatus = "on-wall" | "reserved" | "out" | "pending-photo" | "incomplete" | "held";
export type LoanStatus = "reserved" | "out" | "pending-photo" | "returned-partial" | "returned-complete";

/** A tool's status from its current loan, its parts and its ready hold. */
export function itemStatus(currentLoanStatus: LoanStatus | null, partStates: readonly PartState[], hasReadyHold: boolean): ItemStatus {
  if (currentLoanStatus === "reserved" || currentLoanStatus === "out" || currentLoanStatus === "pending-photo") return currentLoanStatus;
  if (partStates.includes("missing")) return "incomplete";
  return hasReadyHold ? "held" : "on-wall";
}

export interface Counts {
  on_wall: number;
  out: number;
  missing: number;
}

export function boardCounts(partStates: readonly PartState[]): Counts {
  const counts: Counts = { on_wall: 0, out: 0, missing: 0 };
  for (const state of partStates) {
    if (state === "hung") counts.on_wall += 1;
    else if (state === "out") counts.out += 1;
    else counts.missing += 1;
  }
  return counts;
}
