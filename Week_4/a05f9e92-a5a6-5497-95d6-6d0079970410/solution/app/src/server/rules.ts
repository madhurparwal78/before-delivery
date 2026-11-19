import type { Value } from "../shared/expression.js";
import { evaluate } from "../shared/expression.js";
import { pathExists } from "../shared/fields.js";
import type { Table } from "../shared/types.js";
import { settings } from "./config.js";
import { assertExpression, compile, conditionHolds } from "./conditions.js";
import { query, type Tx } from "./db.js";
import { fail, validation } from "./errors.js";
import { configList } from "./store.js";
import { recordScope, type Actor, type Fields, type World } from "./world.js";

export type RuleAction =
  | { set: Record<string, string> }
  | { abort: string }
  | { work_note: string }
  | { inbox: { to: { users?: string[]; roles?: string[] }; text: string } }
  | { update_record: { path: string; fields: Record<string, string> } };

export interface BusinessRule {
  name: string;
  table: Table;
  when: "before" | "after" | "background";
  order: number;
  operations: Array<"insert" | "update">;
  condition: string;
  actions: RuleAction[];
  active: boolean;
}

function byOrderThenName<T extends { order: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function loadBusinessRules(tx: Tx): Promise<BusinessRule[]> {
  const rules = (await configList<BusinessRule>("business_rule", "live", tx)).map((r) => r.content).filter((r) => r.active);
  return byOrderThenName(rules);
}

/** Refuses a rule whose expressions do not parse or whose actions are not allowed for its timing. */
export function validateBusinessRule(rule: BusinessRule): void {
  assertExpression(rule.condition, { table: rule.table });
  for (const action of rule.actions) {
    if ("abort" in action) {
      if (rule.when !== "before") validation("Only before rules can abort.");
    } else if ("set" in action) {
      for (const [field, expression] of Object.entries(action.set)) {
        if (!pathExists(rule.table, [field])) validation(`Unknown field "${field}".`);
        assertExpression(expression, { table: rule.table });
      }
    } else if ("update_record" in action) {
      assertExpression(action.update_record.path, { table: rule.table });
      for (const expression of Object.values(action.update_record.fields)) assertExpression(expression, { table: rule.table });
    }
  }
}

interface RuleRun {
  world: World;
  actor: Actor;
  table: Table;
  number: string | null;
  fields: Fields;
  previous: Fields | null;
  operation: "insert" | "update";
  rules: BusinessRule[];
  depth: number;
}

interface RuleEffects {
  note(text: string): void;
  inbox(recipients: string[], text: string): void;
  /** Runs a nested save of the record at a reference path; returns nothing, throws when it fails. */
  update(path: string, values: Record<string, Value>, ruleName: string): Promise<void>;
}

/** Runs the matching rules of one timing in order; `set` writes into `run.fields`. */
export async function runRules(timing: BusinessRule["when"], run: RuleRun, effects: RuleEffects): Promise<void> {
  for (const rule of run.rules) {
    if (rule.when !== timing || rule.table !== run.table || !rule.operations.includes(run.operation)) continue;
    const scope = (): ReturnType<typeof recordScope> =>
      recordScope(run.world, { table: run.table, number: run.number, fields: run.fields }, run.actor, {
        previous: run.previous,
        inserting: run.operation === "insert",
      });
    if (!conditionHolds(rule.condition, scope())) continue;
    for (const action of rule.actions) {
      if ("abort" in action) fail(422, "aborted", action.abort);
      else if ("set" in action) {
        for (const [field, expression] of Object.entries(action.set)) run.fields[field] = evaluate(compile(expression), scope());
      } else if ("work_note" in action) effects.note(action.work_note);
      else if ("inbox" in action) {
        const rows = action.inbox.to.roles?.length ? await query("SELECT username FROM users WHERE roles && $1", [action.inbox.to.roles]) : [];
        effects.inbox([...(action.inbox.to.users ?? []), ...rows.map((r) => r.username as string)], action.inbox.text);
      } else {
        const values: Record<string, Value> = {};
        for (const [field, expression] of Object.entries(action.update_record.fields)) values[field] = evaluate(compile(expression), scope());
        await effects.update(action.update_record.path, values, rule.name);
      }
    }
  }
}

export interface FormPolicy {
  name: string;
  table: Table | null;
  catalog_item: string | null;
  order: number;
  condition: string;
  actions: Array<{ field: string; mandatory?: boolean | null; visible?: boolean | null; read_only?: boolean | null }>;
}

export interface FieldState {
  mandatory?: boolean;
  visible?: boolean;
  read_only?: boolean;
}

export async function loadFormPolicies(tx?: Tx): Promise<FormPolicy[]> {
  return byOrderThenName((await configList<FormPolicy>("form_policy", "live", tx)).map((p) => p.content));
}

export function validateFormPolicy(policy: FormPolicy): void {
  assertExpression(policy.condition, { table: policy.table, extraRoots: policy.table ? [] : [] });
}

/** What the published policies say about each field: a later policy wins per property. */
export function applyPolicies(policies: FormPolicy[], scope: ReturnType<typeof recordScope>, table: Table | null, catalogItem: string | null): Record<string, FieldState> {
  const states: Record<string, FieldState> = {};
  for (const policy of policies) {
    const matches = catalogItem !== null ? policy.catalog_item === catalogItem : policy.table === table && policy.catalog_item === null;
    if (!matches || !conditionHolds(policy.condition, scope)) continue;
    for (const action of policy.actions) {
      const state = (states[action.field] ??= {});
      if (action.mandatory !== null && action.mandatory !== undefined) state.mandatory = action.mandatory;
      if (action.visible !== null && action.visible !== undefined) state.visible = action.visible;
      if (action.read_only !== null && action.read_only !== undefined) state.read_only = action.read_only;
    }
  }
  return states;
}

export interface AssignmentRule {
  name: string;
  order: number;
  table: Table;
  condition: string;
  group: string;
  active: boolean;
}

export async function loadAssignmentRules(tx: Tx): Promise<AssignmentRule[]> {
  return byOrderThenName((await configList<AssignmentRule>("assignment_rule", "live", tx)).map((r) => r.content).filter((r) => r.active));
}

interface Assignment {
  rule: string;
  group: string;
  assignee: string | null;
}

const CLOSED_STATES = ["resolved", "closed", "cancelled", "done"];

/** First matching rule, then round robin among members under capacity and not out of office; otherwise Triage. */
export async function assign(tx: Tx, world: World, rules: AssignmentRule[], run: { table: Table; number: string | null; fields: Fields; actor: Actor }): Promise<Assignment | null> {
  const rule = rules.find((r) => r.table === run.table && conditionHolds(r.condition, recordScope(world, run, run.actor)));
  if (!rule) return null;
  const rows = await tx.query("SELECT members, rr_pointer FROM groups WHERE name = $1 FOR UPDATE", [rule.group]);
  const group = rows[0];
  const members = (group?.members as string[] | undefined) ?? [];
  const pointer = (group?.rr_pointer as string | null | undefined) ?? null;
  const loads = await tx.query("SELECT fields->>'assigned_to' AS who, count(*)::int AS n FROM records WHERE fields->>'assigned_to' = ANY($1) AND NOT (fields->>'state' = ANY($2)) GROUP BY 1", [members, CLOSED_STATES]);
  const open = new Map(loads.map((l) => [l.who as string, l.n as number]));
  const start = pointer === null ? 0 : (members.indexOf(pointer) + 1) % Math.max(members.length, 1);
  for (let step = 0; step < members.length; step++) {
    const username = members[(start + step) % members.length]!;
    const person = world.people.get(username);
    if (!person || !person.active || person.out_of_office) continue;
    if ((open.get(username) ?? 0) >= (person.capacity ?? settings.ASSIGNMENT_CAPACITY)) continue;
    await tx.query("UPDATE groups SET rr_pointer = $2 WHERE name = $1", [rule.group, username]);
    return { rule: rule.name, group: rule.group, assignee: username };
  }
  return { rule: rule.name, group: rule.group, assignee: null };
}
