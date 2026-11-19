import { equals, type Value } from "../shared/expression.js";
import {
  fieldSpec,
  fieldsOf,
  INITIAL_STATE,
  labelOf,
  NUMBER_PREFIX,
  PRIORITY_LABELS,
  SCALE_LABELS,
  stateLabel,
  type FieldSpec,
} from "../shared/fields.js";
import { TABLE_LABELS, type Table } from "../shared/types.js";
import { now } from "./clock.js";
import { settings } from "./config.js";
import { applyPolicies, assign, loadBusinessRules, runRules, type FieldState } from "./rules.js";
import { nextSequence, pad, transaction, type Tx } from "./db.js";
import { Env, SYSTEM, type Principal } from "./env.js";
import { ApiError, fail, notFound } from "./errors.js";
import { deliver } from "./inbox.js";
import { publish } from "./live.js";
import { changePriority, derivePriority, PUBLISHED_DEFAULTS } from "../shared/record-rules.js";
import { nthOpenDayAfter } from "./schedule.js";
import { publishSla, rowOf, shownSla, slaViews, syncSlas, type SlaRow, type SlaView } from "./sla.js";
import { availableMoves, findTransition, firstMissing, illegalTransition, mayMove, roleNotAllowed } from "./transitions.js";
import { formatLocal } from "../shared/tz.js";
import { recordScope, toRecord, type Fields, type RecordObj, type StateEntry } from "./world.js";
import { checkFreezeAndOverlap, changeBand, afterChangeSave, openFixtureReview } from "./changes.js";
import { checkFixDone, checkNoOpenIncidents, resolveOpenChildren, afterFixChangeDone } from "./major.js";
import { maybeStartPage } from "./oncall.js";
import { triggerWorkflows, afterWorkItemMove } from "./workflows.js";

interface SaveInput {
  table: Table;
  number: string | null;
  submitted: Record<string, { value: Value; version?: number }>;
  to?: string;
  depth?: number;
  /** Bypasses roles, field access and version checks (rules, workflows, timers). */
  system?: boolean;
  /** System moves that the lifecycle tables do not list (resolve together, approval reset). */
  force?: boolean;
  fixture?: { createdAt?: string; createdBy: string; history?: StateEntry[]; state?: string };
  /** A priority override with its reason, or null to remove the override. */
  override?: { priority: number; reason: string } | null;
}

const MAX_SHORT = 160;
const EMPTY = (v: Value | undefined): boolean => v === null || v === undefined || v === "";

async function lockRecord(tx: Tx, number: string): Promise<RecordObj | null> {
  const rows = await tx.query("SELECT * FROM records WHERE number = $1 FOR UPDATE", [number]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function findRecord(tx: Tx, number: string): Promise<RecordObj | null> {
  const rows = await tx.query("SELECT * FROM records WHERE number = $1", [number]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export function nowIso(): string {
  return new Date(now()).toISOString();
}

export async function addActivity(env: Env, number: string, kind: string, text: string, opts: { field?: string; system?: boolean } = {}): Promise<void> {
  const actor = opts.system || env.isSystem ? null : env.who.actor;
  const actingFor = opts.system || env.isSystem ? null : env.who.actingFor;
  await env.tx.query("INSERT INTO activity (record_number, at, actor, acting_for, kind, text, field) VALUES ($1, $2, $3, $4, $5, $6, $7)", [number, nowIso(), actor, actingFor, kind, text, opts.field ?? null]);
}

function coerce(env: Env, spec: FieldSpec, value: Value, errors: Record<string, string>): Value {
  if (value === null || value === "") return null;
  const bad = (message: string): Value => {
    errors[spec.name] = message;
    return null;
  };
  switch (spec.kind) {
    case "integer": {
      const n = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) return bad(`${spec.label} must be a whole number.`);
      if (spec.values && !spec.values.includes(String(n))) return bad(`${spec.label} must be one of ${spec.values.join(", ")}.`);
      return n;
    }
    case "boolean":
      return typeof value === "boolean" ? value : bad(`${spec.label} must be true or false.`);
    case "enum":
      return typeof value === "string" && (!spec.values?.length || spec.values.includes(value)) ? value : bad(`${spec.label} must be one of ${(spec.values ?? []).join(", ")}.`);
    case "instant": {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return bad(`${spec.label} must be an ISO 8601 instant.`);
      return new Date(value).toISOString();
    }
    case "reference": {
      if (typeof value !== "string") return bad(`${spec.label} must be a text reference.`);
      const missing = `${spec.label} "${value}" does not exist.`;
      if (spec.reference === "ci") return env.world.itemName(value) ?? bad(missing);
      const exists =
        spec.reference === "user"
          ? env.world.people.has(value)
          : spec.reference === "group"
            ? env.world.groups.has(value)
            : spec.reference === "catalog_item"
              ? true
              : env.world.records.has(value) || value.length > 0;
      return exists ? value : bad(missing);
    }
    case "object":
      return typeof value === "object" && !Array.isArray(value) ? value : bad(`${spec.label} must be an object.`);
    default:
      return typeof value === "string" ? value : bad(`${spec.label} must be text.`);
  }
}

async function conflictFor(env: Env, rec: RecordObj, field: string, mine: Value): Promise<{ field: string; label: string; yours: Value; theirs: Value; theirs_by: string; version: number }> {
  const rows = await env.tx.query("SELECT actor FROM audit WHERE record_number = $1 AND field = $2 ORDER BY id DESC LIMIT 1", [rec.number, field]);
  const who = (rows[0]?.actor as string | null) ?? null;
  return { field, label: labelOf(rec.table, field), yours: mine, theirs: rec.fields[field] ?? null, theirs_by: env.world.displayName(who), version: rec.versions[field] ?? 1 };
}

/** The reopen deadline of a resolved incident: the same local time on the 5th open day of Office hours. */
async function reopenDeadline(env: Env, resolvedAt: string): Promise<number | null> {
  const schedule = (await env.slaCatalog()).schedules.get("Office hours");
  return schedule ? nthOpenDayAfter(schedule, Date.parse(resolvedAt), 5) : null;
}

export interface DraftRecord {
  table: Table;
  number: string | null;
  fields: Fields;
}

/** The one save pipeline: access, versions, transition, rules, derived values, persistence, SLAs, events. */
export async function save(env: Env, input: SaveInput): Promise<RecordObj> {
  const depth = input.depth ?? 1;
  const existing = input.number ? await lockRecord(env.tx, input.number) : null;
  if (input.number && !existing) return notFound();
  const access = await env.access();
  const names = Object.keys(input.submitted);
  const transition = existing && input.to ? findTransition(input.table, (existing.fields.model as string | null) ?? null, existing.fields.state as string, input.to) : undefined;
  if (!env.isSystem && !input.system) {
    if (existing && !access.canRead(existing)) return notFound();
    const callerOwns = existing?.fields.caller === env.user.username;
    const allowedMove = transition && mayMove(transition, { roles: env.user.roles, isCaller: callerOwns });
    access.assertWrite(input.table, existing, names, input.to ? { fields: allowedMove && transition ? transition.required : [] } : null);
  }
  const previous = existing?.fields ?? {};

  if (existing && !input.system && !env.isSystem) {
    const stale = [];
    for (const name of names) {
      const submitted = input.submitted[name]!;
      const current = existing.versions[name] ?? 1;
      if (submitted.version !== undefined && submitted.version !== current && !equals(previous[name] ?? null, submitted.value)) stale.push(await conflictFor(env, existing, name, submitted.value));
    }
    if (stale.length > 0) {
      const first = stale[0]!;
      fail(409, "field_conflict", `Conflict on ${first.label}: ${first.theirs_by} saved a newer value.`, undefined, { conflicts: stale });
    }
  }

  const errors: Record<string, string> = {};
  const next: Fields = { ...previous };
  for (const name of names) {
    const spec = fieldSpec(input.table, name);
    if (!spec || name === "state") {
      errors[name] = name === "state" ? "State changes through its transition." : `Unknown field "${name}".`;
      continue;
    }
    if (spec.readOnly && !input.system && !env.isSystem) {
      errors[name] = `${spec.label} is read-only.`;
      continue;
    }
    next[name] = coerce(env, spec, input.submitted[name]!.value, errors);
  }
  if (Object.keys(errors).length > 0) problems(errors);

  const creating = existing === null;
  const createdAt = input.fixture?.createdAt ?? nowIso();
  if (creating) {
    next.state = input.fixture?.state ?? INITIAL_STATE[input.table];
    next.created_at = createdAt;
    initialDefaults(env, input.table, next);
  }

  if (input.override !== undefined) {
    if (input.override === null) delete next._override;
    else {
      next._override = { reason: input.override.reason, by: env.who.actor, at: nowIso() };
      next.priority = input.override.priority;
    }
  }

  let transitionAt: string | null = null;
  if (existing && input.to) {
    const from = existing.fields.state as string;
    if (!input.force) {
      if (!transition) illegalTransition(input.table, from, input.to);
      if (!env.isSystem && !input.system && !mayMove(transition, { roles: env.user.roles, isCaller: existing.fields.caller === env.user.username })) roleNotAllowed(input.table, input.to);
      const missing = firstMissing(input.table, transition.required, (f) => next[f]);
      if (missing) {
        const message = `${labelOf(input.table, missing)} is required to move to ${stateLabel(input.table, input.to)}.`;
        fail(422, "field_required", message, { [missing]: message });
      }
      for (const guard of transition.guards ?? []) await runGuard(env, guard, existing, next, input.to);
    }
    next.state = input.to;
    transitionAt = nowIso();
    if (input.to === "resolved" && (input.table === "incident" || input.table === "problem")) next.resolved_at = transitionAt;
    if (from === "resolved" && input.to === "in_progress") next.resolved_at = null;
  }

  const draft: DraftRecord = { table: input.table, number: input.number, fields: next };
  const effects = new Effects(env, input.number, depth);
  const fixtureMode = input.fixture !== undefined;
  if (!fixtureMode) {
    const rules = await env.businessRules();
    await runRules("before", { world: env.world, actor: env.actorRef, table: input.table, number: input.number, fields: next, previous: creating ? null : previous, operation: creating ? "insert" : "update", rules, depth }, effects);
  }

  await derive(env, draft, existing, input);
  await validateAgainstPolicies(env, draft, existing, input, names);

  const fromState = existing ? (existing.fields.state as string) : null;
  const assignmentNote: string[] = [];
  if (creating && !fixtureMode && EMPTY(next.assignment_group) && EMPTY(next.assigned_to)) {
    const outcome = await assign(env.tx, env.world, await env.assignmentRules(), { table: input.table, number: null, fields: next, actor: env.actorRef });
    if (outcome) {
      if (outcome.assignee) {
        next.assignment_group = outcome.group;
        next.assigned_to = outcome.assignee;
        assignmentNote.push(`Assigned to ${env.world.displayName(outcome.assignee)} by rule "${outcome.rule}".`);
      } else {
        next.assignment_group = "Triage";
        assignmentNote.push(`No one in ${outcome.group} could take {number}; sent to Triage.`);
      }
    }
  }

  let rec: RecordObj;
  if (creating) {
    const seq = await nextSequence(env.tx, input.table);
    const number = `${NUMBER_PREFIX[input.table]}${pad(seq)}`;
    draft.number = number;
    const versions: Record<string, number> = {};
    for (const key of Object.keys(next)) versions[key] = 1;
    const history = input.fixture?.history ?? [{ state: next.state as string, at: createdAt }];
    const creator = input.fixture ? input.fixture.createdBy : env.isSystem ? null : env.who.actor;
    const closeAt = next.state === "resolved" && input.table === "incident" && typeof next.resolved_at === "string" ? await reopenDeadline(env, next.resolved_at) : null;
    await env.tx.query(
      "INSERT INTO records (number, table_name, fields, versions, state_history, created_by, close_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [number, input.table, JSON.stringify(next), JSON.stringify(versions), JSON.stringify(history), creator, closeAt ? new Date(closeAt).toISOString() : null, createdAt],
    );
    rec = { number, table: input.table, fields: next, versions, history, createdBy: creator, closeAt: closeAt ? new Date(closeAt).toISOString() : null, createdAt };
    for (const line of assignmentNote) await addActivity(env, number, "system", line.replace("{number}", number), { system: true });
    if (typeof next.assigned_to === "string" && !fixtureMode) await deliver(env.tx, "assigned", [next.assigned_to], `${number} was assigned to you.`, number);
  } else {
    const before = existing!;
    const changed = Object.keys(next).filter((k) => !k.startsWith("_") && !equals(before.fields[k] ?? null, next[k] ?? null));
    const overrideChanged = !equals(before.fields._override ?? null, next._override ?? null);
    if (changed.length === 0 && !transitionAt && !overrideChanged) return before;
    const versions = { ...before.versions };
    const history = [...before.history];
    if (transitionAt) history.push({ state: next.state as string, at: transitionAt });
    let closeAt: string | null = before.closeAt;
    if (next.state === "resolved" && fromState !== "resolved" && input.table === "incident" && typeof next.resolved_at === "string") {
      const deadline = await reopenDeadline(env, next.resolved_at);
      closeAt = deadline ? new Date(deadline).toISOString() : null;
    } else if (next.state !== "resolved") closeAt = null;
    for (const key of changed) {
      versions[key] = (before.versions[key] ?? 1) + 1;
      await env.tx.query("INSERT INTO audit (record_number, at, actor, acting_for, field, before, after, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
        before.number,
        nowIso(),
        env.isSystem ? null : env.who.actor,
        env.isSystem ? null : env.who.actingFor,
        key,
        JSON.stringify(before.fields[key] ?? null),
        JSON.stringify(next[key] ?? null),
        key === "priority" && typeof next._override === "object" && next._override !== null ? ((next._override as { reason?: string }).reason ?? null) : null,
      ]);
    }
    await env.tx.query("UPDATE records SET fields = $2, versions = $3, state_history = $4, close_at = $5 WHERE number = $1", [before.number, JSON.stringify(next), JSON.stringify(versions), JSON.stringify(history), closeAt]);
    rec = { ...before, fields: next, versions, history, closeAt };
    if (transitionAt) await addActivity(env, before.number, "state", `Moved from ${stateLabel(input.table, fromState!)} to ${stateLabel(input.table, next.state as string)}.`);
    if (typeof next.assigned_to === "string" && next.assigned_to !== before.fields.assigned_to) await deliver(env.tx, "assigned", [next.assigned_to], `${before.number} was assigned to you.`, before.number);
  }
  env.world.records.set(rec.number, rec);
  effects.number = rec.number;

  if (!fixtureMode) {
    const rules = await env.businessRules();
    await runRules("after", { world: env.world, actor: env.actorRef, table: input.table, number: rec.number, fields: rec.fields, previous: creating ? null : previous, operation: creating ? "insert" : "update", rules, depth }, effects);
    await effects.flush(rec);
    if (input.table === "incident" && input.to === "resolved" && rec.fields.is_major === true) await resolveOpenChildren(env, rec, depth);
    await afterChangeSave(env, rec, existing, creating ? [] : Object.keys(next).filter((k) => !k.startsWith("_") && !equals(previous[k] ?? null, next[k] ?? null)));
    await afterFixChangeDone(env, rec, existing);
    await afterWorkItemMove(env, rec, existing);
  }

  if (fixtureMode && rec.table === "change" && creating && ["peer_review", "board_vote"].includes(String(rec.fields.state))) await openFixtureReview(env, rec);

  const slaChanges = await syncSlas(env.tx, env.world, rec, existing, await env.slaCatalog(), Date.parse(createdAt));
  if (!fixtureMode && rec.table === "incident" && Number(rec.fields.priority) === 1 && (!existing || Number(existing.fields.priority) !== 1)) await maybeStartPage(env, rec);

  const finalRecord = rec;
  env.tx.after.push(async () => {
    publish(`record:${finalRecord.number}`, "changed", { number: finalRecord.number });
    publish(`list:${finalRecord.table}`, "changed", { number: finalRecord.number });
    publish("dashboard:*", "changed", {});
    if (finalRecord.fields.is_major === true) publish(`major:${finalRecord.number}`, "changed", {});
    if (typeof finalRecord.fields.parent === "string") {
      publish(`major:${finalRecord.fields.parent}`, "changed", {});
      publish(`record:${finalRecord.fields.parent}`, "changed", { number: finalRecord.fields.parent });
    }
    if (typeof finalRecord.fields.problem === "string") publish(`record:${finalRecord.fields.problem}`, "changed", {});
    const views = await slaViews(null, finalRecord, env.world, await env.slaCatalog());
    publishSla(finalRecord, views, slaChanges);
    if (!fixtureMode) {
      await triggerWorkflows(finalRecord, creating ? "record_created" : "record_updated");
      void runBackgroundRules(finalRecord, creating ? null : previous, env.who);
    }
  });
  return rec;
}

/** Background rules run after the save committed, each in its own transaction; a failure becomes an activity line. */
async function runBackgroundRules(rec: RecordObj, previous: Fields | null, who: Principal): Promise<void> {
  const operation = previous === null ? "insert" : "update";
  const rules = (await transaction(async (tx) => loadBusinessRules(tx))).filter((r) => r.when === "background" && r.table === rec.table && r.operations.includes(operation));
  for (const rule of rules) {
    try {
      await transaction(async (tx) => {
        const env = await Env.create(tx, who);
        const fresh = (await findRecord(tx, rec.number)) ?? rec;
        const fields = { ...fresh.fields };
        const effects = new Effects(env, rec.number, 1);
        await runRules("background", { world: env.world, actor: env.actorRef, table: rec.table, number: rec.number, fields, previous, operation, rules: [rule], depth: 1 }, effects);
        await effects.flush(fresh);
        const changed = Object.keys(fields).filter((k) => !k.startsWith("_") && !equals(fresh.fields[k] ?? null, fields[k] ?? null));
        if (changed.length > 0) await save(env, { table: rec.table, number: rec.number, submitted: Object.fromEntries(changed.map((k) => [k, { value: fields[k] ?? null }])), system: true });
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : String(error);
      await transaction(async (tx) => addActivity(await Env.create(tx, SYSTEM), rec.number, "system", `Background rule "${rule.name}" failed: ${message.replace(/\.$/, "")}.`, { system: true }));
    }
  }
}

function problems(errors: Record<string, string>): never {
  const count = Object.keys(errors).length;
  return fail(422, "validation", `${count} problems to fix before saving.`, errors);
}

function initialDefaults(env: Env, table: Table, next: Fields): void {
  const set = (name: string, value: Value): void => {
    if (next[name] === undefined) next[name] = value;
  };
  for (const [name, value] of Object.entries(PUBLISHED_DEFAULTS[table] ?? {})) set(name, value);
  if (table === "incident" && !env.isSystem && env.user.roles.every((r) => r !== "operator" && r !== "technician") && next.caller === undefined) next.caller = env.user.username;
  for (const spec of fieldsOf(table)) set(spec.name, null);
}

async function derive(env: Env, draft: DraftRecord, existing: RecordObj | null, input: SaveInput): Promise<void> {
  const { fields } = draft;
  if (draft.table === "task") {
    if (!existing) {
      const parent = typeof fields.parent === "string" ? env.world.records.get(fields.parent) ?? (await findRecord(env.tx, fields.parent)) : null;
      fields.priority = parent ? Number(parent.fields.priority ?? 4) : 4;
    }
    return;
  }
  if (draft.table === "change") {
    const band = fields.state === "draft" && !existing ? null : await changeBand(env, draft);
    if (input.fixture && fields.priority !== undefined && fields.priority !== null && fields.priority !== 5) return;
    fields.priority = changePriority(String(fields.model ?? "normal"), band);
    return;
  }
  if (input.fixture && typeof fields.priority === "number") return;
  if (fields._override) return;
  if (fields.state === "resolved" || fields.state === "closed") {
    if (existing) fields.priority = existing.fields.priority ?? null;
    else fields.priority = derivePriority(Number(fields.impact), Number(fields.urgency), businessCritical(env, fields));
    return;
  }
  fields.priority = derivePriority(Number(fields.impact), Number(fields.urgency), businessCritical(env, fields));
}

function businessCritical(env: Env, fields: Fields): boolean {
  const item = typeof fields.configuration_item === "string" ? env.world.cis.get(fields.configuration_item) : undefined;
  return item?.business_critical === true;
}

/** Form policies the server applies to the submitted values: mandatory, read-only and hidden. */
async function validateAgainstPolicies(env: Env, draft: DraftRecord, existing: RecordObj | null, input: SaveInput, submitted: string[]): Promise<void> {
  if (input.fixture || input.system || env.isSystem) return;
  const policies = await env.formPolicies();
  const states = applyPolicies(policies, recordScope(env.world, draft, env.actorRef), draft.table, null);
  const errors: Record<string, string> = {};
  for (const [field, state] of Object.entries(states)) {
    const label = labelOf(draft.table, field);
    if (state.visible === false && submitted.includes(field)) draft.fields[field] = existing ? (existing.fields[field] ?? null) : null;
    else if (state.read_only && submitted.includes(field) && !equals(existing?.fields[field] ?? null, draft.fields[field] ?? null)) errors[field] = `${label} is read-only.`;
    else if (state.mandatory && state.visible !== false && EMPTY(draft.fields[field])) errors[field] = `${label} is required.`;
  }
  const titleField = draft.table === "change" ? "title" : "short_description";
  const title = draft.fields[titleField];
  if (EMPTY(title)) errors[titleField] = `${labelOf(draft.table, titleField)} is required.`;
  else if (draft.table !== "change" && typeof title === "string" && title.length > MAX_SHORT) errors[titleField] = `${labelOf(draft.table, titleField)} can be at most ${MAX_SHORT} characters.`;
  if (Object.keys(errors).length > 0) problems(errors);
}

async function runGuard(env: Env, guard: string, existing: RecordObj, next: Fields, to: string): Promise<void> {
  switch (guard) {
    case "freeze_and_overlap":
      return checkFreezeAndOverlap(env, { table: "change", number: existing.number, fields: next });
    case "fix_done":
      return checkFixDone(env, existing, next);
    case "no_open_incidents":
      return checkNoOpenIncidents(env, existing);
    default: {
      const deadline = existing.closeAt ? Date.parse(existing.closeAt) : null;
      if (deadline !== null && now() > deadline && to === "in_progress") {
        fail(422, "reopen_window_passed", "This incident was resolved more than 5 business days ago and cannot be reopened.");
      }
    }
  }
}

class Effects {
  private notes: string[] = [];
  private inboxes: Array<{ recipients: string[]; text: string }> = [];
  constructor(
    private readonly env: Env,
    public number: string | null,
    private readonly depth: number,
  ) {}

  note(text: string): void {
    this.notes.push(text);
  }

  inbox(recipients: string[], text: string): void {
    this.inboxes.push({ recipients, text });
  }

  async update(path: string, values: Record<string, Value>, ruleName: string): Promise<void> {
    const limit = settings.BUSINESS_RULE_DEPTH_LIMIT;
    if (this.depth + 1 > limit) fail(422, "rule_depth", `Business rules stopped after ${limit} nested updates at rule "${ruleName}".`);
    const target = await this.resolveTarget(path);
    if (!target) return;
    const submitted: SaveInput["submitted"] = {};
    for (const [field, value] of Object.entries(values)) submitted[field] = { value };
    await save(this.env, { table: target.table, number: target.number, submitted, system: true, depth: this.depth + 1 });
  }

  private async resolveTarget(path: string): Promise<RecordObj | null> {
    const parts = path.split(".");
    let current: RecordObj | null = this.number ? ((await findRecord(this.env.tx, this.number)) ?? null) : null;
    for (const part of parts) {
      const ref = current?.fields[part];
      if (typeof ref !== "string") return null;
      current = await findRecord(this.env.tx, ref);
      if (!current) return null;
    }
    return current;
  }

  async flush(rec: RecordObj): Promise<void> {
    for (const text of this.notes) await addActivity(this.env, rec.number, "work_note", text, { system: true });
    this.notes = [];
    for (const item of this.inboxes) await deliver(this.env.tx, "rule", item.recipients, item.text, rec.number);
    this.inboxes = [];
  }
}

export interface FieldJson {
  value: Value;
  display: string;
  version: number;
  label: string;
  mandatory: boolean;
  read_only: boolean;
  visible: boolean;
}

export interface RecordJson {
  number: string;
  table: Table;
  state: string;
  state_label: string;
  fields: Record<string, FieldJson>;
  priority_overridden: boolean;
  slas: SlaView[];
  links: { parent: string | null; children: string[]; problem: string | null; incidents: string[]; fix_change: string | null };
  workaround: { problem: string; text: string } | null;
  transitions: { to: string; label: string }[];
}

function displayOf(env: Env, spec: FieldSpec, value: Value): string {
  if (value === null || value === undefined) return "";
  if (spec.kind === "reference") return spec.reference === "user" ? env.world.displayName(String(value)) : String(value);
  if (spec.name === "state") return "";
  if (spec.kind === "boolean") return value ? "Yes" : "No";
  if (spec.name === "priority") return `${value} ${PRIORITY_LABELS[Number(value)] ?? ""}`.trim();
  if (spec.name === "impact" || spec.name === "urgency") return `${value} ${SCALE_LABELS[Number(value)] ?? ""}`.trim();
  if (spec.kind === "instant") return formatLocal(Date.parse(String(value)), env.user.time_zone);
  if (spec.kind === "object") return JSON.stringify(value);
  return String(value);
}

export async function recordView(env: Env, rec: RecordObj): Promise<RecordJson> {
  const access = await env.access();
  const readable = access.readable(rec);
  const policies = await env.formPolicies();
  const states: Record<string, FieldState> = applyPolicies(policies, recordScope(env.world, rec, env.actorRef), rec.table, null);
  const fields: Record<string, FieldJson> = {};
  for (const spec of fieldsOf(rec.table)) {
    if (!readable.has(spec.name)) continue;
    const value = spec.name === "state" ? (rec.fields.state as string) : (rec.fields[spec.name] ?? null);
    const state = states[spec.name] ?? {};
    fields[spec.name] = {
      value,
      display: spec.name === "state" ? stateLabel(rec.table, String(value)) : displayOf(env, spec, value),
      version: rec.versions[spec.name] ?? 1,
      label: spec.label,
      mandatory: state.mandatory === true,
      read_only: spec.readOnly === true || state.read_only === true,
      visible: state.visible !== false,
    };
  }
  const children = await relatedNumbers(env, "parent", rec.number, access);
  const incidents = await relatedNumbers(env, "problem", rec.number, access);
  const problemNumber = typeof rec.fields.problem === "string" ? rec.fields.problem : null;
  let workaround: RecordJson["workaround"] = null;
  if (problemNumber && rec.table === "incident" && !["resolved", "closed", "cancelled"].includes(String(rec.fields.state))) {
    const problem = await findRecord(env.tx, problemNumber);
    const text = problem?.fields.workaround;
    if (typeof text === "string" && text !== "") workaround = { problem: problemNumber, text };
  }
  const roles = env.user.roles;
  return {
    number: rec.number,
    table: rec.table,
    state: String(rec.fields.state),
    state_label: stateLabel(rec.table, String(rec.fields.state)),
    fields,
    priority_overridden: Boolean(rec.fields._override),
    slas: await slaViews(env.tx, rec, env.world, await env.slaCatalog()),
    links: {
      parent: typeof rec.fields.parent === "string" ? rec.fields.parent : null,
      children,
      problem: problemNumber,
      incidents,
      fix_change: typeof rec.fields.fix_change === "string" ? rec.fields.fix_change : null,
    },
    workaround,
    transitions: availableMoves(rec.table, (rec.fields.model as string | null) ?? null, String(rec.fields.state), { roles, isCaller: rec.fields.caller === env.user.username }),
  };
}

async function relatedNumbers(env: Env, field: "parent" | "problem", number: string, access: Awaited<ReturnType<Env["access"]>>): Promise<string[]> {
  const rows = await env.tx.query("SELECT * FROM records WHERE fields->>$1 = $2 ORDER BY id", [field, number]);
  return rows.map(toRecord).filter((r) => access.canRead(r)).map((r) => r.number);
}

export interface SummaryJson {
  number: string;
  table: Table;
  state: string;
  state_label: string;
  short_description: string;
  priority: number | null;
  assigned_to: string | null;
  sla: Pick<SlaView, "percent" | "remaining_seconds" | "ticking" | "next_change_at" | "server_time" | "stage" | "breached"> | null;
  label: string;
  values?: Record<string, Value>;
}

export async function summarize(env: Env, recs: RecordObj[], columns?: string[]): Promise<SummaryJson[]> {
  const catalog = await env.slaCatalog();
  const rows = recs.length > 0 ? await env.tx.query("SELECT * FROM slas WHERE record_number = ANY($1) ORDER BY id", [recs.map((r) => r.number)]) : [];
  const byRecord = new Map<string, SlaRow[]>();
  for (const row of rows.map(rowOf)) byRecord.set(row.record_number, [...(byRecord.get(row.record_number) ?? []), row]);
  const out: SummaryJson[] = [];
  for (const rec of recs) {
    const views = await slaViews(null, rec, env.world, catalog, now(), byRecord.get(rec.number) ?? []);
    const shown = shownSla(views);
    const assignedTo = typeof rec.fields.assigned_to === "string" ? rec.fields.assigned_to : null;
    const priority = typeof rec.fields.priority === "number" ? rec.fields.priority : null;
    const stateText = stateLabel(rec.table, String(rec.fields.state));
    const label = `${TABLE_LABELS[rec.table]} ${rec.number}, priority ${priority}, ${stateText}, assigned to ${assignedTo ? env.world.displayName(assignedTo) : "nobody"}, ${shown ? `SLA ${shown.percent} percent` : "no SLA"}`;
    const summary: SummaryJson = {
      number: rec.number,
      table: rec.table,
      state: String(rec.fields.state),
      state_label: stateText,
      short_description: String((rec.table === "change" ? rec.fields.title : rec.fields.short_description) ?? ""),
      priority,
      assigned_to: assignedTo,
      sla: shown ? { percent: shown.percent, remaining_seconds: shown.remaining_seconds, ticking: shown.ticking, next_change_at: shown.next_change_at, server_time: shown.server_time, stage: shown.stage, breached: shown.breached } : null,
      label,
    };
    if (columns) summary.values = Object.fromEntries(columns.map((c) => [c, rec.fields[c] ?? null]));
    out.push(summary);
  }
  return out;
}
