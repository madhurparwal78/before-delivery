import type { HostCommand, RoomState } from "./schemas.js";

// The room state machine: the only legal commands and where they lead.
const transitions: Record<HostCommand, { from: readonly RoomState[]; to: RoomState }> = {
  open_question: { from: ["lobby", "leaderboard"], to: "question_open" },
  lock: { from: ["question_open"], to: "locked" },
  reveal: { from: ["locked"], to: "reveal" },
  show_leaderboard: { from: ["reveal"], to: "leaderboard" },
  show_podium: { from: ["leaderboard"], to: "podium" },
  end: { from: ["podium"], to: "ended" },
};

export type Verdict = { ok: true; to: RoomState } | { ok: false; refusal: "illegal_transition" | "no_more_questions" };

export function resolveCommand(state: RoomState, command: HostCommand, questionIndex: number | null, questionCount: number): Verdict {
  const step = transitions[command];
  if (!step.from.includes(state)) return { ok: false, refusal: "illegal_transition" };
  if (command === "open_question" && state === "leaderboard" && questionIndex === questionCount) {
    return { ok: false, refusal: "no_more_questions" };
  }
  return { ok: true, to: step.to };
}

// The server's own transition: a room with no one connected ends from any state.
export function resolveIdleEnd(state: RoomState): Verdict {
  return state === "ended" ? { ok: false, refusal: "illegal_transition" } : { ok: true, to: "ended" };
}

// Which states put a question, or its reveal, in front of players.
export const acceptsAnswers = (state: RoomState): boolean => state === "question_open" || state === "locked";
export const showsQuestion = (state: RoomState): boolean => acceptsAnswers(state) || state === "reveal";
export const showsReveal = (state: RoomState): boolean => state === "reveal" || state === "leaderboard";
