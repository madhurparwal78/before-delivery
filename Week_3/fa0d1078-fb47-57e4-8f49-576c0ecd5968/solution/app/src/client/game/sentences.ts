import { cellIndex, columnOf, rowOf, type CellName, type Digit } from "../../shared/board";
import type { Guard } from "../../shared/moves";

const place = (cell: CellName): string => `row ${rowOf(cellIndex(cell)) + 1}, column ${columnOf(cellIndex(cell)) + 1}`;

/** M06 and M07: a correct entry, or a mistake with the count so far. */
export function entered(cell: CellName, digit: Digit, correct: boolean, mistakes: number, limit: number): string {
  const head = `${place(cell).replace(/^r/, "R")}, ${digit}`;
  return correct ? `${head}.` : `${head}, wrong. Mistakes ${mistakes} of ${limit}.`;
}

/** M08 */
export const noted = (cell: CellName, digit: Digit, added: boolean): string =>
  added ? `Note ${digit} added to ${place(cell)}.` : `Note ${digit} removed from ${place(cell)}.`;

/** M09 */
export const erased = (cell: CellName): string => `${place(cell).replace(/^r/, "R")} erased.`;

/** M16 */
export const hinted = (cell: CellName, digit: Digit, left: number): string => `Hint: ${place(cell)} is ${digit}. Hints left ${left}.`;

/** M24 */
export const secondChance = (mistakes: number, limit: number): string => `Second chance. Mistakes ${mistakes} of ${limit}.`;

/** M01, M02 and M03: a given, a hinted cell or a correct entry refuses the change; a wrong entry refuses a note silently. */
export function refusal(guard: Guard): string | null {
  switch (guard) {
    case "given":
      return "Given cells can't be changed.";
    case "hinted":
      return "Hinted cells can't be changed.";
    case "correct":
      return "Correct entries can't be changed.";
    case "wrong":
      return null;
  }
}
