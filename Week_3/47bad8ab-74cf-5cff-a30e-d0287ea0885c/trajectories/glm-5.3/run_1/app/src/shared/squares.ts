import type { Colour, CheckScope, Direction, SquareState } from "./types.js";

export interface SquareView {
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: Colour | null;
}

/** The one place where the visible state of a square is folded together. */
export function visibleState(sq: { value: string; pencil: boolean; state?: SquareState }): SquareState {
  if (sq.state === "revealed") return "revealed";
  if (sq.state === "right") return "right";
  if (sq.state === "wrong") return "wrong";
  if (sq.value === "") return "empty";
  if (sq.pencil) return "pencil";
  return "filled";
}
