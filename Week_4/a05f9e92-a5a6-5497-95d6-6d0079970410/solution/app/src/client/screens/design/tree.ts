import type { Step, StepType } from "../../../server/workflows.js";

export type { Step, StepType };

export type LaneName = "then" | "else" | "body" | "on_error";

export const TYPE_LABELS: Record<StepType, string> = {
  trigger: "Trigger",
  if: "If",
  loop: "Loop",
  approval: "Approval",
  create_task: "Create task",
  set_fields: "Set fields",
  wait: "Wait",
  subflow: "Subflow",
  notify: "Notify",
  end: "End",
};

/** The step types a person can add: every type except the trigger, which every flow already has. */
export const ADDABLE_TYPES: StepType[] = ["if", "loop", "approval", "create_task", "set_fields", "wait", "subflow", "notify", "end"];

export const LANE_LABELS: Record<LaneName, string> = {
  then: "Yes",
  else: "No",
  body: "Loop body",
  on_error: "On error",
};

/** A list of steps: the flow itself (`parent` null) or one lane of a step. */
export interface LaneRef {
  parent: string | null;
  lane: LaneName | null;
}

const ROOT: LaneRef = { parent: null, lane: null };

export const stepKey = (id: string): string => `s:${id}`;
export const laneKey = (parent: string, lane: LaneName): string => `l:${parent}:${lane}`;

/** The lanes a step shows when it is expanded. */
export function lanesOf(step: Step): LaneName[] {
  const lanes: LaneName[] = step.type === "if" ? ["then", "else"] : step.type === "loop" ? ["body"] : [];
  if (lanes.length > 0 || (step.on_error?.length ?? 0) > 0) lanes.push("on_error");
  return lanes;
}

export function laneSteps(step: Step, lane: LaneName): Step[] {
  return step[lane] ?? [];
}

export interface TreeItem {
  key: string;
  kind: "step" | "lane";
  level: number;
  parentKey: string | null;
  /** The list this item sits in: the lane of a step, or the lane's own parent step for a lane item. */
  home: LaneRef;
  index: number;
  size: number;
  step: Step | null;
  lane: LaneName | null;
  expandable: boolean;
  expanded: boolean;
  isTrigger: boolean;
}

/** The visible tree items in reading order. */
export function flatten(steps: Step[], expanded: ReadonlySet<string>): TreeItem[] {
  const out: TreeItem[] = [];
  const walk = (list: Step[], home: LaneRef, level: number, parentKey: string | null): void => {
    list.forEach((step, index) => {
      const lanes = lanesOf(step);
      const open = lanes.length > 0 && expanded.has(step.id);
      const key = stepKey(step.id);
      out.push({ key, kind: "step", level, parentKey, home, index, size: list.length, step, lane: null, expandable: lanes.length > 0, expanded: open, isTrigger: step.type === "trigger" });
      if (!open) return;
      lanes.forEach((lane, laneIndex) => {
        const inside = laneSteps(step, lane);
        const here = laneKey(step.id, lane);
        out.push({ key: here, kind: "lane", level: level + 1, parentKey: key, home: { parent: step.id, lane }, index: laneIndex, size: lanes.length, step, lane, expandable: false, expanded: false, isTrigger: false });
        walk(inside, { parent: step.id, lane }, level + 2, here);
      });
    });
  };
  walk(steps, ROOT, 1, null);
  return out;
}

function nested(step: Step, change: (list: Step[]) => Step[]): Step {
  const next: Step = { ...step };
  if (step.then) next.then = change(step.then);
  if (step.else) next.else = change(step.else);
  if (step.body) next.body = change(step.body);
  if (step.on_error) next.on_error = change(step.on_error);
  return next;
}

function withLane(step: Step, lane: LaneName, list: Step[]): Step {
  switch (lane) {
    case "then":
      return { ...step, then: list };
    case "else":
      return { ...step, else: list };
    case "body":
      return { ...step, body: list };
    case "on_error":
      return { ...step, on_error: list };
  }
}

/** Replaces the list a lane reference points at, leaving every other step untouched. */
function changeLane(steps: Step[], home: LaneRef, change: (list: Step[]) => Step[]): Step[] {
  if (home.parent === null || home.lane === null) return change(steps);
  const { parent, lane } = home;
  return steps.map((step) => (step.id === parent ? withLane(step, lane, change(laneSteps(step, lane))) : nested(step, (list) => changeLane(list, home, change))));
}

interface Found {
  step: Step;
  home: LaneRef;
  index: number;
  siblings: Step[];
}

export function findStep(steps: Step[], id: string, home: LaneRef = ROOT): Found | null {
  for (const [index, step] of steps.entries()) {
    if (step.id === id) return { step, home, index, siblings: steps };
    for (const lane of ["then", "else", "body", "on_error"] as const) {
      const inside = step[lane];
      const found = inside ? findStep(inside, id, { parent: step.id, lane }) : null;
      if (found) return found;
    }
  }
  return null;
}

export function listAt(steps: Step[], home: LaneRef): Step[] {
  if (home.parent === null || home.lane === null) return steps;
  const owner = findStep(steps, home.parent);
  return owner ? laneSteps(owner.step, home.lane) : [];
}

export function insertStep(steps: Step[], home: LaneRef, index: number, added: Step): Step[] {
  return changeLane(steps, home, (list) => [...list.slice(0, index), added, ...list.slice(index)]);
}

export function removeStep(steps: Step[], id: string): Step[] {
  const found = findStep(steps, id);
  return found ? changeLane(steps, found.home, (list) => list.filter((s) => s.id !== id)) : steps;
}

export function moveStep(steps: Step[], id: string, delta: -1 | 1): Step[] {
  const found = findStep(steps, id);
  if (!found) return steps;
  return changeLane(steps, found.home, (list) => {
    const to = found.index + delta;
    const copy = [...list];
    [copy[found.index], copy[to]] = [copy[to]!, copy[found.index]!];
    return copy;
  });
}

export function replaceStep(steps: Step[], replacement: Step): Step[] {
  return steps.map((step) => (step.id === replacement.id ? replacement : nested(step, (list) => replaceStep(list, replacement))));
}

function allIds(steps: Step[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: Step[]): void => {
    for (const step of list) {
      ids.add(step.id);
      for (const lane of ["then", "else", "body", "on_error"] as const) walk(step[lane] ?? []);
    }
  };
  walk(steps);
  return ids;
}

/** A new step of a type with the fields the published step JSON needs, under an id no step uses yet. */
export function newStep(steps: Step[], type: StepType, name: string): Step {
  const used = allIds(steps);
  let n = used.size + 1;
  while (used.has(`step-${n}`)) n++;
  const base: Step = { id: `step-${n}`, type, name, on_error: [] };
  switch (type) {
    case "if":
      return { ...base, condition: "true", then: [], else: [] };
    case "loop":
      return { ...base, over: "[]", until: null, body: [] };
    case "approval":
      return { ...base, approvers: { kind: "department_approvers", user: null }, rule: "any" };
    case "create_task":
      return { ...base, group: "", short_description: name, wait: true };
    case "set_fields":
      return { ...base, fields: {} };
    case "wait":
      return { ...base, units: 1 };
    case "subflow":
      return { ...base, flow: "", inputs: {} };
    case "notify":
      return { ...base, to: { users: [], roles: [] }, text: "" };
    default:
      return base;
  }
}

/** Label and value pairs shown in the step detail panel. */
export function detailRows(step: Step): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== "") rows.push([label, value]);
  };
  switch (step.type) {
    case "trigger":
      add("Runs when", step.on?.replace("_", " "));
      add("Table", step.table);
      add("Catalog items", step.items?.join(", "));
      add("Condition", step.condition);
      break;
    case "if":
      add("Condition", step.condition);
      break;
    case "loop":
      add("Loop over", step.over);
      add("Loop until", step.until);
      break;
    case "approval":
      add("Approvers", step.approvers?.kind === "user" ? (step.approvers.user ?? "A named person") : "Department approvers");
      add("Rule", step.rule === "all" ? "All approvers" : "Any approver");
      break;
    case "create_task":
      add("Task group", step.group);
      add("Short description", step.short_description);
      add("Waits for the task", step.wait === false ? "No" : "Yes");
      break;
    case "set_fields":
      add("Fields", JSON.stringify(step.fields ?? {}));
      break;
    case "wait":
      add("Units", String(step.units ?? 1));
      break;
    case "subflow":
      add("Flow", step.flow);
      add("Inputs", JSON.stringify(step.inputs ?? {}));
      break;
    case "notify":
      add("To", JSON.stringify(step.to ?? {}));
      add("Text", step.text);
      break;
    case "end":
      break;
  }
  return rows;
}
