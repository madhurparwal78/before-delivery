import { isDigit, toCellName } from "../shared/board";
import type { Move } from "../shared/moves";
import { config } from "./config";

function parseMove(value: unknown): Move | null {
  if (typeof value !== "object" || value === null) return null;
  const { n, t, op, cell, digit } = value as Record<string, unknown>;
  if (typeof n !== "number" || !Number.isInteger(n) || typeof t !== "number" || !Number.isFinite(t)) return null;
  const named = toCellName(cell);
  switch (op) {
    case "undo":
    case "redo":
    case "second_chance":
    case "pause":
    case "resume":
      return { n, t, op };
    case "erase":
      return named ? { n, t, op, cell: named } : null;
    case "enter":
    case "note":
    case "hint":
      return named && isDigit(digit) ? { n, t, op, cell: named, digit } : null;
    default:
      return null;
  }
}

/** The moves of a log body, unknown fields dropped; null when the log is malformed. */
export function parseMoveLog(moves: unknown): Move[] | null {
  if (!Array.isArray(moves) || moves.length > config.moveLimit) return null;
  const parsed = moves.map(parseMove);
  const valid = parsed.filter((move): move is Move => move !== null);
  return valid.length === parsed.length ? valid : null;
}

const fields = (move: Move): unknown[] => [move.n, move.t, move.op, "cell" in move ? move.cell : null, "digit" in move ? move.digit : null];

/** Two logs are the same when every move agrees on the published fields. */
export function sameLog(left: readonly Move[], right: readonly Move[]): boolean {
  return (
    left.length === right.length &&
    left.every((move, index) => {
      const other = right[index];
      return other !== undefined && JSON.stringify(fields(move)) === JSON.stringify(fields(other));
    })
  );
}
