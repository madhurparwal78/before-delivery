import type { Table } from "./types.js";

export type FieldKind = "text" | "long" | "integer" | "boolean" | "instant" | "enum" | "reference" | "object";
export type ReferenceTarget = "user" | "ci" | "group" | "record" | "request" | "catalog_item";

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  reference?: ReferenceTarget;
  values?: string[];
  /** Not editable through PATCH: derived, or changed only by an action. */
  readOnly?: boolean;
}

const sentence = (name: string): string => {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function field(name: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec {
  return { name, label: extra.label ?? sentence(name), kind, ...extra };
}

const text = (name: string, extra?: Partial<FieldSpec>): FieldSpec => field(name, "text", extra);
const long = (name: string, extra?: Partial<FieldSpec>): FieldSpec => field(name, "long", extra);
const integer = (name: string, extra?: Partial<FieldSpec>): FieldSpec => field(name, "integer", extra);
const bool = (name: string, extra?: Partial<FieldSpec>): FieldSpec => field(name, "boolean", extra);
const instant = (name: string, extra?: Partial<FieldSpec>): FieldSpec => field(name, "instant", extra);
const enumeration = (name: string, values: string[], extra?: Partial<FieldSpec>): FieldSpec => field(name, "enum", { values, ...extra });
const reference = (name: string, target: ReferenceTarget, extra?: Partial<FieldSpec>): FieldSpec =>
  field(name, "reference", { reference: target, ...extra });

const HOLD_REASONS = ["awaiting_requester", "awaiting_supplier", "awaiting_change"];
export const RESOLUTION_CODES = ["fixed", "workaround_given", "no_fault_found", "duplicate"];
const CHANGE_MODELS = ["normal", "standard", "emergency"];
const CHANGE_OUTCOMES = ["successful", "failed", "backed_out"];

const number = text("number", { readOnly: true });
const state = enumeration("state", [], { readOnly: true });
const created = instant("created_at", { label: "Created", readOnly: true });
const resolved = instant("resolved_at", { label: "Resolved", readOnly: true });
const scale = ["1", "2", "3"];

export const TABLE_FIELDS: Record<Table, FieldSpec[]> = {
  incident: [
    number,
    text("short_description"),
    long("description"),
    reference("caller", "user"),
    reference("affected_person", "user"),
    reference("configuration_item", "ci", { label: "Service or item" }),
    integer("impact", { values: scale }),
    integer("urgency", { values: scale }),
    integer("priority", { readOnly: true }),
    reference("assignment_group", "group"),
    reference("assigned_to", "user"),
    enumeration("hold_reason", HOLD_REASONS),
    enumeration("resolution_code", RESOLUTION_CODES),
    long("resolution_note"),
    text("reopen_reason"),
    text("cancel_reason"),
    bool("confidential"),
    bool("is_major", { label: "Major incident" }),
    reference("parent", "record"),
    reference("problem", "record"),
    bool("sla_breached", { label: "SLA breached", readOnly: true }),
    state,
    created,
    resolved,
  ],
  problem: [
    number,
    text("short_description"),
    long("description"),
    reference("configuration_item", "ci", { label: "Service or item" }),
    integer("impact", { values: scale }),
    integer("urgency", { values: scale }),
    integer("priority", { readOnly: true }),
    reference("assignment_group", "group"),
    reference("assigned_to", "user"),
    long("workaround"),
    reference("fix_change", "record"),
    text("cancel_reason"),
    state,
    created,
    resolved,
  ],
  change: [
    number,
    text("title"),
    enumeration("model", CHANGE_MODELS),
    reference("configuration_item", "ci", { label: "Service or item" }),
    instant("planned_start"),
    instant("planned_end"),
    long("implementation_plan"),
    long("backout_plan"),
    bool("backout_tested"),
    text("standard_template"),
    text("freeze_override_reason"),
    enumeration("outcome", CHANGE_OUTCOMES),
    long("close_note"),
    text("cancel_reason"),
    integer("priority", { readOnly: true }),
    state,
    created,
  ],
  request_item: [
    number,
    text("short_description", { readOnly: true }),
    reference("request", "request", { readOnly: true }),
    reference("item", "catalog_item", { label: "Catalog item", readOnly: true }),
    integer("quantity"),
    field("variables", "object"),
    reference("requested_for", "user"),
    integer("impact", { values: scale }),
    integer("urgency", { values: scale }),
    integer("priority", { readOnly: true }),
    reference("assignment_group", "group"),
    reference("assigned_to", "user"),
    text("cancel_reason"),
    state,
    created,
  ],
  task: [
    number,
    text("short_description"),
    long("description"),
    reference("parent", "record"),
    reference("assignment_group", "group"),
    reference("assigned_to", "user"),
    long("close_note"),
    text("cancel_reason"),
    integer("priority", { readOnly: true }),
    state,
    created,
  ],
};

export function fieldsOf(table: Table): FieldSpec[] {
  return TABLE_FIELDS[table];
}

export function fieldSpec(table: Table, name: string): FieldSpec | undefined {
  return TABLE_FIELDS[table].find((f) => f.name === name);
}

export function labelOf(table: Table, name: string): string {
  return fieldSpec(table, name)?.label ?? sentence(name);
}

/** What a reference field leads to: the paths below it. */
const USER_PATHS = ["username", "display_name", "department", "roles", "time_zone", "out_of_office", "capacity", "active"];
const CI_PATHS = ["name", "class", "criticality", "business_critical", "owner_department", "status"];
const GROUP_PATHS = ["name"];
const CATALOG_PATHS = ["id", "name"];

export function referencePaths(target: ReferenceTarget): string[] {
  switch (target) {
    case "user":
      return USER_PATHS;
    case "ci":
      return CI_PATHS;
    case "group":
      return GROUP_PATHS;
    case "catalog_item":
      return CATALOG_PATHS;
    case "record":
      return ["number", "state", "short_description", "description", "priority", "title"];
    case "request":
      return ["number", "state", "requester", "requested_for"];
  }
}

const OPEN_NAMESPACES = ["variables", "answers", "inputs", "steps"];

/** True when a dotted path names a field of the table, following references. */
export function pathExists(table: Table, parts: string[], allowedNames?: ReadonlySet<string>): boolean {
  const [head, ...rest] = parts;
  if (head === undefined) return false;
  if (OPEN_NAMESPACES.includes(head)) return rest.length > 0;
  if (head === "previous") return rest.length > 0 && pathExists(table, rest, allowedNames);
  const spec = fieldSpec(table, head);
  if (!spec || (allowedNames && !allowedNames.has(head))) return false;
  if (rest.length === 0) return true;
  if (spec.kind !== "reference" || !spec.reference) return false;
  const [next, ...deeper] = rest;
  if (!referencePaths(spec.reference).includes(next!)) return false;
  if (deeper.length === 0) return true;
  return next === "department" && deeper.length === 1 && deeper[0] === "name";
}

const STATE_LABELS: Record<Table, Record<string, string>> = {
  incident: {
    new: "New",
    assigned: "Assigned",
    in_progress: "In progress",
    on_hold: "On hold",
    resolved: "Resolved",
    closed: "Closed",
    cancelled: "Cancelled",
  },
  problem: {
    new: "New",
    assessing: "Assessing",
    known_error: "Known error",
    fix_in_progress: "Fix in progress",
    resolved: "Resolved",
    closed: "Closed",
    cancelled: "Cancelled",
  },
  change: {
    draft: "Draft",
    assessed: "Assessed",
    peer_review: "Peer review",
    board_vote: "Board vote",
    approved: "Approved",
    rejected: "Rejected",
    implementing: "Implementing",
    done: "Done",
    cancelled: "Cancelled",
  },
  request_item: {
    submitted: "Submitted",
    awaiting_approval: "Awaiting approval",
    approved: "Approved",
    rejected: "Rejected",
    fulfilling: "Fulfilling",
    delivered: "Delivered",
    closed: "Closed",
    cancelled: "Cancelled",
  },
  task: { open: "Open", in_progress: "In progress", done: "Done", cancelled: "Cancelled" },
};

export const INITIAL_STATE: Record<Table, string> = {
  incident: "new",
  problem: "new",
  change: "draft",
  request_item: "submitted",
  task: "open",
};

export const TYPE_NAMES: Record<Table, string> = {
  incident: "incident",
  problem: "problem",
  change: "change",
  request_item: "request item",
  task: "task",
};

export const PRIORITY_LABELS: Record<number, string> = { 1: "Critical", 2: "High", 3: "Moderate", 4: "Low", 5: "Planning" };
export const SCALE_LABELS: Record<number, string> = { 1: "High", 2: "Medium", 3: "Low" };
export const NUMBER_PREFIX: Record<Table, string> = { incident: "BRK-", problem: "ROOT-", change: "ALT-", request_item: "ITM-", task: "JOB-" };

export function tableOfNumber(number: string): Table | null {
  const found = (Object.entries(NUMBER_PREFIX) as [Table, string][]).find(([, prefix]) => number.startsWith(prefix));
  return found ? found[0] : null;
}

export function stateLabel(table: Table, state: string): string {
  return STATE_LABELS[table][state] ?? state;
}
