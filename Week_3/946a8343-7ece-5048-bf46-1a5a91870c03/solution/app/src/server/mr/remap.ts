// Line mapping of a thread (or a suggestion region) from the version it was made on to a newer one.
import { diffLines, mapRange, splitLines, type DiffOp } from "../../shared/diff.ts";

export interface Mapped {
  readonly start: number;
  readonly end: number;
}

export function diffTexts(before: string, after: string): DiffOp[] {
  return diffLines(splitLines(before), splitLines(after));
}

/** The region's new numbers when every line of it sits in an unchanged block; null when any line is in a changed block. */
export function mapRegion(ops: readonly DiffOp[], start: number, end: number): Mapped | null {
  return mapRange(ops, "old", start, end);
}

