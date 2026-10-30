import type { Role } from "../auth.js";

// The stage gate catalog (brief: Stage gates).

export const STAGES = [
  { key: "groundwork", name: "Groundwork", feeKey: "groundwork" },
  { key: "scheme", name: "Scheme", feeKey: "scheme" },
  { key: "detailing", name: "Detailing", feeKey: "detailing" },
  { key: "tender_award", name: "Tender & Award", feeKey: "tenderAward" },
  { key: "build", name: "Build", feeKey: "build" },
  { key: "handover", name: "Handover", feeKey: "handover" },
  { key: "aftercare", name: "Aftercare", feeKey: null },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

/** A project's current stage: the first fee-bearing stage not signed off, or Aftercare. */
export function currentStage(states: { key: string; state: string }[]): StageKey {
  const open = STAGES.find((stage) => stage.feeKey && states.find((s) => s.key === stage.key)?.state !== "signed_off");
  return open?.key ?? "aftercare";
}

export type StageAction = "request" | "sign_off" | "return";

/** Why a stage action is refused, or null when it is allowed (brief: Stage gates). */
type StageRefusal =
  | { kind: "illegal_transition"; from: string }
  | { kind: "previous_stage_open"; stage: StageKey }
  | { kind: "already_signed_off" };

interface StageState {
  key: string;
  state: string;
}

export function stageRefusal(states: StageState[], stage: StageState, action: StageAction): StageRefusal | null {
  const index = STAGES.findIndex((entry) => entry.key === stage.key);
  const from = stage.state;
  if (action === "request") {
    if (!STAGES[index].feeKey || (from !== "not_started" && from !== "returned")) return { kind: "illegal_transition", from };
    const open = STAGES.slice(0, index).find((earlier) => earlier.feeKey && states.find((s) => s.key === earlier.key)?.state !== "signed_off");
    return open ? { kind: "previous_stage_open", stage: open.key } : null;
  }
  if (from === "requested") return null;
  if (action === "sign_off" && from === "signed_off") return { kind: "already_signed_off" };
  return { kind: "illegal_transition", from };
}

// Who may take each stage action (brief: Who can do what); brand scope is checked by project visibility.
const ACTORS: Record<StageAction | "note", Role[]> = {
  request: ["director", "project_lead"],
  note: ["director", "project_lead"],
  sign_off: ["client_approver"],
  return: ["client_approver"],
};

export const mayActOnStages = (role: Role, action: StageAction | "note"): boolean => ACTORS[action].includes(role);

/** The actions a member can take on one stage now, from the same rules that refuse them. */
export function stageActions(states: StageState[], stage: StageState, role: Role): string[] {
  const actions: string[] = (["request", "sign_off", "return"] as const)
    .filter((action) => mayActOnStages(role, action) && stageRefusal(states, stage, action) === null);
  if (mayActOnStages(role, "note")) actions.push("note");
  return actions;
}

/** A stage's display name. */
export const stageName = (key: string): string => STAGES.find((stage) => stage.key === key)?.name ?? key;
