// The restatement rules, decided once for the server and the browser: which role may take which
// action, the two-person rule, the version check and the close-wins rule for a withdraw.

import type { RestatementState, Role } from "./domain.ts";

export type Action = "create" | "edit" | "upload" | "submit" | "return" | "clear" | "release" | "withdraw";

type RefusalCode =
  | "forbidden"
  | "not_preparer"
  | "preparer_cannot_clear"
  | "preparer_cannot_release"
  | "clearer_cannot_release"
  | "invalid_transition"
  | "version_conflict";

export const OPEN_STATES: readonly RestatementState[] = ["draft", "in_review", "returned", "cleared", "queued"];

export interface Actor {
  id: string;
  roles: readonly Role[];
}

export interface Facts {
  state: RestatementState;
  version: number;
  preparedBy: string;
  clearedBy: string | null;
  releaseAt: number | null;
}

interface Circumstance {
  actor: Actor;
  marketNow: number;
  /** The version a save, clear or withdraw carried, when it carried a valid one. */
  claimedVersion?: number;
}

const REQUIRED_ROLE: Record<Action, Role> = {
  create: "treasury_analyst",
  edit: "treasury_analyst",
  upload: "treasury_analyst",
  submit: "treasury_analyst",
  return: "disclosure_counsel",
  clear: "disclosure_counsel",
  release: "disclosure_officer",
  withdraw: "disclosure_officer",
};

const ALLOWED_FROM: Record<Exclude<Action, "create">, readonly RestatementState[]> = {
  edit: ["draft", "returned"],
  upload: ["draft", "returned"],
  submit: ["draft", "returned"],
  return: ["in_review"],
  clear: ["in_review"],
  release: ["cleared"],
  withdraw: ["queued"],
};

const VERSIONED: readonly Action[] = ["edit", "clear", "withdraw"];

type Verdict = { allowed: true } | { allowed: false; code: RefusalCode };

function refuse(code: RefusalCode): Verdict {
  return { allowed: false, code };
}

export function mayCreate(actor: Actor): boolean {
  return actor.roles.includes(REQUIRED_ROLE.create);
}

function personalRefusal(action: Exclude<Action, "create">, facts: Facts, actor: Actor): RefusalCode | null {
  if (action === "edit" || action === "upload" || action === "submit") {
    return facts.preparedBy === actor.id ? null : "not_preparer";
  }
  if (action === "return" || action === "clear") {
    return facts.preparedBy === actor.id ? "preparer_cannot_clear" : null;
  }
  if (facts.preparedBy === actor.id) return "preparer_cannot_release";
  if (action === "release" && facts.clearedBy === actor.id) return "clearer_cannot_release";
  return null;
}

/** The close wins: from the release instant on, a queued release belongs to the session close. */
function closeHasWon(releaseAt: number | null, instant: number): boolean {
  return releaseAt === null || instant >= releaseAt;
}

/** 403 role, 403 preparer, 403 clearer, then 409 state, then 409 version, then the close-wins rule. */
export function decide(action: Exclude<Action, "create">, facts: Facts, circumstance: Circumstance): Verdict {
  const { actor } = circumstance;
  if (!actor.roles.includes(REQUIRED_ROLE[action])) return refuse("forbidden");
  const personal = personalRefusal(action, facts, actor);
  if (personal) return refuse(personal);
  if (!ALLOWED_FROM[action].includes(facts.state)) return refuse("invalid_transition");
  if (action === "withdraw" && closeHasWon(facts.releaseAt, circumstance.marketNow)) return refuse("invalid_transition");
  if (VERSIONED.includes(action) && circumstance.claimedVersion !== undefined && circumstance.claimedVersion !== facts.version) {
    return refuse("version_conflict");
  }
  return { allowed: true };
}

/**
 * Whether a screen offers the control for an action: the role holds and the state allows it. The
 * people the two-person rule excludes are still offered release and withdraw, so the server's
 * refusal reaches them in words; every other action is offered only to those who may take it.
 */
export function offered(action: Exclude<Action, "create">, facts: Facts, actor: Actor): boolean {
  if (!actor.roles.includes(REQUIRED_ROLE[action]) || !ALLOWED_FROM[action].includes(facts.state)) return false;
  return action === "release" || action === "withdraw" ? true : personalRefusal(action, facts, actor) === null;
}
