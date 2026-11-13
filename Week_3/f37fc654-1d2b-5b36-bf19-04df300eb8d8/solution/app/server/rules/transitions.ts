// The commission state machine (brief: Business rules › Commission states and transitions).

export type CommissionState =
  | "briefed" | "previewed" | "placed" | "held" | "contracted" | "concept_approved"
  | "fabricating" | "installed" | "accepted" | "maintained" | "cancelled";

export type Actor = "client" | "producer" | "crew" | "system";

interface Move {
  from: readonly CommissionState[];
  to: CommissionState;
  by: readonly Actor[];
  /** The milestone that must be paid before the move. */
  needsPaid?: string;
}

const MOVES: readonly Move[] = [
  { from: ["briefed"], to: "previewed", by: ["system"] },
  { from: ["previewed"], to: "placed", by: ["system"] },
  { from: ["placed"], to: "held", by: ["system"] },
  { from: ["held"], to: "placed", by: ["system"] },
  { from: ["held"], to: "contracted", by: ["system"] },
  { from: ["contracted"], to: "concept_approved", by: ["client"] },
  { from: ["concept_approved"], to: "fabricating", by: ["producer"], needsPaid: "Concept approval" },
  { from: ["fabricating"], to: "installed", by: ["crew", "producer"], needsPaid: "Fabrication" },
  { from: ["installed"], to: "accepted", by: ["client"] },
  { from: ["accepted"], to: "maintained", by: ["system"], needsPaid: "Signed acceptance" },
  { from: ["briefed", "previewed", "placed", "held", "contracted", "concept_approved"], to: "cancelled", by: ["producer"] },
];

/** Who may ask the transitions endpoint for a move to `to` (empty for automatic or unknown targets). */
export function requestableBy(to: string): readonly Actor[] {
  return MOVES.find((m) => m.to === to && !m.by.includes("system"))?.by ?? [];
}

/** The move from `from` to `to`, when the table allows it. */
export function findMove(from: CommissionState, to: string): Move | null {
  return MOVES.find((m) => m.to === to && m.from.includes(from)) ?? null;
}

export function illegalTransitionMessage(from: string, to: string): string {
  return `A commission can't move from ${from} to ${to}.`;
}
