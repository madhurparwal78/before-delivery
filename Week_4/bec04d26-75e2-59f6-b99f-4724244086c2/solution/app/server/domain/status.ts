import type { ReturnAction, Status } from "../../shared/types";

export type Action = ReturnAction | "packet_ready";

/** The one status move table: where each action may start and where it leads (`null`: the status stays). */
const MOVES: Record<Action, { from: Status[]; to: Status | null }> = {
  prepare: { from: ["not_started"], to: "prepared" },
  save_amounts: { from: ["not_started", "prepared"], to: null },
  approve: { from: ["prepared"], to: "client_approved" },
  send_back: { from: ["prepared", "client_approved"], to: "prepared" },
  file: { from: ["client_approved"], to: "filed" },
  extend: { from: ["not_started", "prepared", "client_approved"], to: null },
  amend: { from: ["filed", "packeted"], to: "amended" },
  packet_ready: { from: ["filed", "amended"], to: "packeted" },
};

interface Standing {
  awaitingApproval: boolean;
  extended: boolean;
}

/** The status after the action, or `undefined` when the move is illegal from here. */
export function moveStatus(action: Action, status: Status, standing: Standing = { awaitingApproval: false, extended: false }):
  Status | undefined {
  const move = MOVES[action];
  if (!move.from.includes(status)) return undefined;
  if (status === "prepared" && !standing.awaitingApproval && (action === "approve" || action === "send_back")) return undefined;
  if (action === "extend" && standing.extended) return undefined;
  return move.to ?? status;
}

/** The actions a person can take now; the system's `packet_ready` is not one of them. */
export function allowedActions(status: Status, standing: Standing): ReturnAction[] {
  return (Object.keys(MOVES) as Action[]).filter((a): a is ReturnAction => a !== "packet_ready" && moveStatus(a, status, standing) !== undefined);
}

/** Statuses that wait for a packet PDF. */
export const PACKET_WAITING: readonly Status[] = MOVES.packet_ready.from;

/** Returns that still owe the practice a filing. */
export const UNFILED: readonly Status[] = ["not_started", "prepared", "client_approved"];
