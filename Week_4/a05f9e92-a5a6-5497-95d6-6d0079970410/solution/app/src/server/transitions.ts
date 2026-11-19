import { fieldsOf, stateLabel, TYPE_NAMES } from "../shared/fields.js";
import type { Role, Table } from "../shared/types.js";
import { fail } from "./errors.js";

type Mover = Role | "system" | "caller";
type Guard = "freeze_and_overlap" | "fix_done" | "no_open_incidents" | "reopen_window";

interface Transition {
  from: string[];
  to: string;
  movers: Mover[];
  required: string[];
  models?: string[];
  guards?: Guard[];
}

const desk: Mover[] = ["operator", "technician"];
const OPEN_INCIDENT = ["new", "assigned", "in_progress", "on_hold"];
const NORMAL_DRAFT = ["configuration_item", "planned_start", "planned_end", "implementation_plan", "backout_plan"];
const BEFORE_IMPLEMENTING = ["draft", "assessed", "peer_review", "board_vote", "approved", "rejected"];

/** The one place the five lifecycle tables are decided. */
const TRANSITIONS: Record<Table, Transition[]> = {
  incident: [
    { from: ["new"], to: "assigned", movers: desk, required: ["assigned_to"] },
    { from: ["new", "assigned"], to: "in_progress", movers: desk, required: ["assigned_to"] },
    { from: ["in_progress"], to: "on_hold", movers: desk, required: ["hold_reason"] },
    { from: ["on_hold"], to: "in_progress", movers: desk, required: [] },
    { from: ["in_progress"], to: "resolved", movers: desk, required: ["resolution_code", "resolution_note"] },
    { from: ["resolved"], to: "in_progress", movers: [...desk, "caller"], required: ["reopen_reason"], guards: ["reopen_window"] },
    { from: ["resolved"], to: "closed", movers: ["operator"], required: [] },
    { from: OPEN_INCIDENT, to: "cancelled", movers: ["operator"], required: ["cancel_reason"] },
  ],
  problem: [
    { from: ["new"], to: "assessing", movers: desk, required: [] },
    { from: ["assessing"], to: "known_error", movers: desk, required: ["workaround"] },
    { from: ["assessing", "known_error"], to: "fix_in_progress", movers: ["operator"], required: ["fix_change"] },
    { from: ["fix_in_progress"], to: "resolved", movers: ["operator", "system"], required: [], guards: ["fix_done"] },
    { from: ["resolved"], to: "closed", movers: ["operator"], required: [], guards: ["no_open_incidents"] },
    { from: ["new", "assessing", "known_error", "fix_in_progress"], to: "cancelled", movers: ["operator"], required: ["cancel_reason"] },
  ],
  change: [
    { from: ["draft"], to: "assessed", movers: ["operator"], required: NORMAL_DRAFT, models: ["normal"], guards: ["freeze_and_overlap"] },
    { from: ["assessed"], to: "peer_review", movers: ["operator"], required: [], models: ["normal"], guards: ["freeze_and_overlap"] },
    { from: ["peer_review"], to: "board_vote", movers: ["system"], required: [], models: ["normal"] },
    { from: ["peer_review"], to: "approved", movers: ["system"], required: [], models: ["normal"] },
    { from: ["board_vote"], to: "approved", movers: ["system"], required: [], models: ["normal", "emergency"] },
    { from: ["peer_review", "board_vote"], to: "rejected", movers: ["system"], required: [], models: ["normal", "emergency"] },
    { from: ["rejected"], to: "assessed", movers: ["operator"], required: [], models: ["normal"] },
    { from: ["draft"], to: "board_vote", movers: ["operator"], required: NORMAL_DRAFT, models: ["emergency"], guards: ["freeze_and_overlap"] },
    {
      from: ["draft"],
      to: "approved",
      movers: ["operator"],
      required: ["standard_template", "configuration_item", "planned_start", "planned_end"],
      models: ["standard"],
      guards: ["freeze_and_overlap"],
    },
    { from: ["approved"], to: "implementing", movers: ["operator"], required: [] },
    { from: ["implementing"], to: "done", movers: ["operator"], required: ["outcome", "close_note"] },
    { from: BEFORE_IMPLEMENTING, to: "cancelled", movers: ["operator"], required: ["cancel_reason"] },
  ],
  request_item: [
    { from: ["submitted"], to: "awaiting_approval", movers: ["system"], required: [] },
    { from: ["submitted", "approved"], to: "fulfilling", movers: ["system"], required: [] },
    { from: ["awaiting_approval"], to: "approved", movers: ["system"], required: [] },
    { from: ["awaiting_approval"], to: "rejected", movers: ["system"], required: [] },
    { from: ["fulfilling"], to: "delivered", movers: ["system"], required: [] },
    { from: ["delivered"], to: "closed", movers: ["operator"], required: [] },
    { from: ["submitted", "awaiting_approval"], to: "cancelled", movers: ["operator", "requester"], required: ["cancel_reason"] },
  ],
  task: [
    { from: ["open"], to: "in_progress", movers: desk, required: [] },
    { from: ["in_progress"], to: "done", movers: desk, required: ["close_note"] },
    { from: ["open", "in_progress"], to: "cancelled", movers: ["operator"], required: ["cancel_reason"] },
  ],
};

export function findTransition(table: Table, model: string | null, from: string, to: string): Transition | undefined {
  return TRANSITIONS[table].find((t) => t.from.includes(from) && t.to === to && (!t.models || (model !== null && t.models.includes(model))));
}

interface MoverIdentity {
  roles: readonly string[];
  isCaller: boolean;
}

export function mayMove(transition: Transition, who: MoverIdentity | "system"): boolean {
  if (who === "system") return true;
  return transition.movers.some((m) => (m === "caller" ? who.isCaller : m !== "system" && who.roles.includes(m)));
}

/** Moves a person may make from a state, for the buttons on the form. */
export function availableMoves(table: Table, model: string | null, from: string, who: MoverIdentity): { to: string; label: string }[] {
  const seen = new Set<string>();
  const out: { to: string; label: string }[] = [];
  for (const t of TRANSITIONS[table]) {
    if (!t.from.includes(from) || (t.models && (model === null || !t.models.includes(model)))) continue;
    if (!mayMove(t, who) || seen.has(t.to)) continue;
    seen.add(t.to);
    out.push({ to: t.to, label: stateLabel(table, t.to) });
  }
  return out;
}

export function illegalTransition(table: Table, from: string, to: string): never {
  return fail(422, "illegal_transition", `Cannot move ${TYPE_NAMES[table]} from ${stateLabel(table, from)} to ${stateLabel(table, to)}.`);
}

export function roleNotAllowed(table: Table, to: string): never {
  return fail(422, "role_not_allowed", `Your role cannot move this ${TYPE_NAMES[table]} to ${stateLabel(table, to)}.`);
}

/** The first required field, in table order, that is empty. */
export function firstMissing(table: Table, required: string[], valueOf: (field: string) => unknown): string | undefined {
  const empty = (v: unknown): boolean => v === null || v === undefined || v === "";
  return fieldsOf(table)
    .map((f) => f.name)
    .find((name) => required.includes(name) && empty(valueOf(name)));
}
