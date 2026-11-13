import type { CheckScope, Direction, SquareState } from "../shared/types.js";

/** The one place where every API error is produced. */
export type ErrorCode =
  | "too_large"
  | "no_player"
  | "rate_limited"
  | "not_found"
  | "link_off"
  | "link_replaced"
  | "not_host"
  | "watching"
  | "game_full"
  | "game_solved"
  | "square_locked"
  | "link_already_off"
  | "op_id_reused"
  | "race_started"
  | "race_not_started"
  | "invalid"
  | "invalid_puzzle"
  | "storage_unavailable";

export interface ApiError extends Error {
  status: number;
  code: ErrorCode;
  fields?: Record<string, string>;
  lines?: string[];
}

const MESSAGES: Record<ErrorCode, string> = {
  too_large: "This file is too large.",
  no_player: "No player.",
  rate_limited: "Slow down a little.",
  not_found: "This game does not exist or is not shared with you.",
  link_off: "This game link was turned off.",
  link_replaced: "This game link was replaced. Ask the host for the new one.",
  not_host: "Only the host can do that.",
  watching: "Watchers cannot write.",
  game_full: "Game is full.",
  game_solved: "This puzzle is already solved.",
  square_locked: "That square is locked.",
  link_already_off: "This link is already off.",
  op_id_reused: "This operation id was reused for a different write.",
  race_started: "The race has started.",
  race_not_started: "The race has not started.",
  invalid: "Invalid request.",
  invalid_puzzle: "This puzzle has problems.",
  storage_unavailable: "Puzzle storage is unreachable right now.",
};

export function apiError(status: number, code: ErrorCode, extra?: { fields?: Record<string, string>; lines?: string[]; message?: string }): ApiError {
  const err = new Error(extra?.message ?? MESSAGES[code]) as ApiError;
  err.status = status;
  err.code = code;
  if (extra?.fields) err.fields = extra.fields;
  if (extra?.lines) err.lines = extra.lines;
  return err;
}

export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields) body.fields = err.fields;
  if (err.lines) body.lines = err.lines;
  return body;
}

// The error precedence lives in the route handlers; this helper only classifies a write.
export interface WriteCheck {
  ok: boolean;
  error?: ApiError;
}

export const isLockableState = (state: SquareState): boolean => state === "right" || state === "revealed";
