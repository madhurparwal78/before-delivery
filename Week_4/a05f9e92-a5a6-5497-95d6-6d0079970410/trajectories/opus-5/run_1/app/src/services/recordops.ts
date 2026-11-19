/**
 * Creating, saving and moving records: per-field versions, form policies,
 * business rules, derived values, SLAs, assignment, activity and audit. Each
 * save is one transaction, so a refused save changes nothing and uses no number.
 */

import { iso, now, nowMs } from '../clock';
import { settings } from '../config';
import { nextNumber, transaction, type PoolClient } from '../db';
import { ApiError, notFound } from '../errors';
import { condition as evaluateCondition, evaluateText } from '../expr/interpret';
import {
  canSeeRecord,
  canWriteField,
  canWriteRecord,
  deniedFieldWrite,
  deniedTableWrite,
} from '../domain/access';
import {
  canTake,
  nextAssignee,
  assignedLine,
  sortRules,
  triageGroup,
  triageLine,
  type GroupMember,
} from '../domain/assignment';
import {
  fieldLabel,
  fieldSpec,
  tableFields,
  type FieldSpec,
  type TableName,
  typeLabels,
} from '../domain/fields';
import { eventTexts } from '../domain/inbox';
import { priorityLabel } from '../domain/priority';
import {
  closedStates,
  fieldRequired,
  findTransition,
  rowsFor,
  illegalTransition,
  initialStates,
  isOpenState,
  roleNotAllowed,
  stateLabel,
} from '../domain/transitions';
import { openDayAfter, isOpenDay } from '../domain/schedule';
import { shownSla, type SlaComputed } from '../domain/sla';
import { addDays, instantOf, localDate, wallOf } from '../domain/zone';
import { Engine, type Caller } from './engine';
import { enforcePolicies, fieldErrors, resolvePolicies, tableLabelFor } from './formpolicy';
import { noticeListChange, publish } from './live';
import { deliver, mentionsIn, unreadCount } from './notify';
import { attachSlas, pushSlas, reviewSlas, slaJson, swapPriority } from './slaservice';
import { insertActivity, insertAudit, type FieldValue, type RecordFields, type RecordRow } from './store';
import { depthLimit, RuleAbort, RuleDepthExceeded, runRules, backgroundFailureLine } from './rules';

export const numberPrefixes: Readonly<Record<string, string>> = {
  incident: 'BRK-',
  problem: 'ROOT-',
  change: 'ALT-',
  request: 'ASK-',
  request_item: 'ITM-',
  task: 'JOB-',
  article: 'ART-',
  config_set: 'SET-',
};

export interface FieldSave {
  readonly value: unknown;
  readonly version: number;
}

/** A pushed live event, published only after the transaction commits. */
export interface LiveEvent {
  readonly topic: string;
  readonly event: string;
  readonly data: unknown;
}

export interface SaveResult {
  readonly record: RecordRow;
  readonly slas: readonly SlaComputed[];
  readonly events: readonly LiveEvent[];
}

function defaultsFor(table: TableName): RecordFields {
  const out: RecordFields = {};
  for (const spec of tableFields[table]) {
    if (spec.default !== undefined) out[spec.name] = spec.default;
  }
  return out;
}

function emptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Coerces a submitted value to the field's published plain form. */
function coerce(spec: FieldSpec, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (spec.type) {
    case 'number':
    case 'choice': {
      if (spec.type === 'choice' && spec.choices && typeof raw === 'string' && !/^\d+$/.test(raw)) {
        return raw;
      }
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case 'boolean':
      return raw === true || raw === 'true';
    case 'time': {
      const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
      return Number.isNaN(ms) ? null : iso(new Date(ms));
    }
    case 'object':
      return typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

function validateValue(table: TableName, spec: FieldSpec, value: unknown): string | null {
  if (value === null) return null;
  if (spec.maxLength !== undefined && typeof value === 'string' && value.length > spec.maxLength) {
    return `${spec.label} can be at most ${spec.maxLength} characters.`;
  }
  if (spec.choices && spec.choices.length > 0) {
    const allowed = spec.choices.map((c) => c.value);
    if (!allowed.includes(String(value))) {
      return `${spec.label} must be one of ${spec.choices.map((c) => c.label).join(', ')}.`;
    }
  }
  return null;
}

function isDerived(table: TableName, field: string): boolean {
  return fieldSpec(table, field)?.derived === true;
}

/** `priority` is derived unless an operator has frozen it with an override. */
function recomputeDerived(engine: Engine, table: TableName, fields: RecordFields, overridden: boolean): void {
  if (table === 'change' || table === 'task') return;
  if (overridden) return;
  if (table === 'incident' && closedStates.incident.includes(String(fields.state ?? ''))) return;
  fields.priority = engine.computedPriority(table, fields);
}

export function priorityOverridden(record: RecordRow): boolean {
  return record.fields.priority_overridden === true;
}

async function writeRecord(
  client: PoolClient,
  record: RecordRow,
): Promise<void> {
  await client.query(
    `UPDATE record SET state = $2, fields = $3::jsonb, versions = $4::jsonb,
            state_history = $5::jsonb, updated_at = $6
     WHERE number = $1`,
    [
      record.number,
      record.state,
      JSON.stringify(record.fields),
      JSON.stringify(record.versions),
      JSON.stringify(record.stateHistory),
      new Date(record.updatedAt),
    ],
  );
}

export interface CreateOptions {
  readonly table: TableName;
  readonly fields: Readonly<Record<string, unknown>>;
  /** Skips assignment rules, used by checkout where the workflow assigns. */
  readonly runAssignment?: boolean;
  readonly state?: string;
  readonly createdBy?: string;
}

/**
 * Creates a record. The number is taken in the same transaction that first saves
 * it, after the before rules have had their chance to abort.
 */
export async function createRecord(
  engine: Engine,
  caller: Caller,
  options: CreateOptions,
): Promise<SaveResult> {
  const table = options.table;
  const access = engine.accessContext(caller);
  if (!canWriteRecord(access, { table, number: '', fields: {} })) throw deniedTableWrite(table);

  const fields: RecordFields = { ...defaultsFor(table) };
  const errors: Record<string, string> = {};
  for (const [name, raw] of Object.entries(options.fields)) {
    const spec = fieldSpec(table, name);
    if (!spec || spec.name === 'state') continue;
    if (spec.derived) continue;
    if (!canWriteField(access, null, table, name)) throw deniedFieldWrite(table, name);
    const value = coerce(spec, raw);
    const problem = validateValue(table, spec, value);
    if (problem) errors[name] = problem;
    else fields[name] = value as RecordFields[string];
  }

  const state = options.state ?? initialStates[table];
  fields.state = state;

  const required = tableFields[table].find(
    (spec) => spec.name === 'short_description' && table !== 'request_item',
  );
  if (required && emptyValue(fields.short_description) && table !== 'change') {
    errors.short_description = `${required.label} is required.`;
  }
  if (table === 'change' && emptyValue(fields.title)) {
    errors.title = 'Title is required.';
  }

  const policyScope = engine.scopeFor({ table, fields, state, number: null }, caller);
  const outcome = resolvePolicies(
    engine.formPolicies,
    { table },
    policyScope,
    tableFields[table].map((f) => f.name),
  );
  const enforcement = enforcePolicies(outcome, options.fields, defaultsFor(table), tableLabelFor(table));
  Object.assign(errors, enforcement.errors);
  for (const field of Object.keys(outcome)) {
    if (!outcome[field].visible && field in options.fields) delete fields[field];
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);

  recomputeDerived(engine, table, fields, false);

  const events: LiveEvent[] = [];
  const result = await transaction(async (client) => {
    const ruleRun = runRules(engine.businessRules, table, 'before', 'insert', fields, (working) =>
      engine.scopeFor({ table, fields: working, state, number: null }, caller, { previous: {} }),
    );
    Object.assign(fields, ruleRun.effects.sets);
    recomputeDerived(engine, table, fields, false);

    const number = await nextNumber(client, numberPrefixes[table]);
    const createdAt = nowMs();
    fields.created_at = iso(new Date(createdAt));
    const versions: Record<string, number> = {};
    for (const name of Object.keys(fields)) versions[name] = 1;

    await client.query(
      `INSERT INTO record (number, table_name, state, fields, versions, state_history,
                           created_at, updated_at, created_by, workspace)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $7, $8, $9)`,
      [
        number,
        table,
        state,
        JSON.stringify(fields),
        JSON.stringify(versions),
        JSON.stringify([{ state, at: iso(new Date(createdAt)) }]),
        new Date(createdAt),
        options.createdBy ?? caller.username,
        engine.workspace,
      ],
    );

    let record: RecordRow = {
      number,
      table,
      state,
      fields,
      versions,
      stateHistory: [{ state, at: iso(new Date(createdAt)) }],
      createdAt,
      updatedAt: createdAt,
      createdBy: options.createdBy ?? caller.username,
      workspace: engine.workspace,
    };
    engine.records.set(number, record);

    for (const note of ruleRun.effects.workNotes) {
      await insertActivity(client, number, now(), 'work_note', note, null);
    }

    if (options.runAssignment !== false && emptyValue(fields.assignment_group) && emptyValue(fields.assigned_to)) {
      record = await applyAssignmentRules(client, engine, record);
    }

    await attachSlas(client, engine, record, createdAt);
    const slas = await reviewSlas(client, engine, record);

    const after = runRules(engine.businessRules, table, 'after', 'insert', record.fields, (working) =>
      engine.scopeFor({ table, fields: working, state: record.state, number }, caller, { previous: {} }),
    );
    if (Object.keys(after.effects.sets).length > 0) {
      record = { ...record, fields: { ...record.fields, ...after.effects.sets } as RecordFields };
      await writeRecord(client, record);
      engine.records.set(number, record);
    }
    for (const note of after.effects.workNotes) {
      await insertActivity(client, number, now(), 'work_note', note, null);
    }
    await deliverRuleInboxes(client, engine, record, [...ruleRun.effects.inboxes, ...after.effects.inboxes]);
    await announceAssignment(client, engine, record, null);

    events.push({ topic: `record:${number}`, event: 'created', data: { number } });
    return { record, slas, events };
  });

  for (const event of result.events) publish(event);
  noticeListChange(table, result.record.number, 'created');
  pushSlas(result.record.number, result.slas);
  return result;
}

async function deliverRuleInboxes(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  inboxes: readonly { users: readonly string[]; roles: readonly string[]; text: string }[],
): Promise<void> {
  for (const box of inboxes) {
    const roleUsers = [...engine.people.values()]
      .filter((p) => p.active && p.roles.some((r) => box.roles.includes(r)))
      .map((p) => p.username);
    await deliver(
      client,
      engine.inboxRules,
      engine.people,
      'assigned',
      [...box.users, ...roleUsers],
      box.text,
      record.number,
    );
  }
}

async function announceAssignment(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  before: string | null,
): Promise<void> {
  const assignee = record.fields.assigned_to;
  if (typeof assignee !== 'string' || assignee === before) return;
  const delivered = await deliver(
    client,
    engine.inboxRules,
    engine.people,
    'assigned',
    [assignee],
    eventTexts.assigned(record.number),
    record.number,
  );
  for (const username of delivered) {
    publish({ topic: 'inbox', event: 'unread', data: { username, unread: await unreadCount(client, username) } });
  }
}

/** The first matching assignment rule picks the group, then round robin picks the person. */
export async function applyAssignmentRules(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
): Promise<RecordRow> {
  const rules = sortRules(engine.assignmentRules, record.table);
  const scope = engine.scopeFor(
    { table: record.table, fields: record.fields, state: record.state, number: record.number },
    { username: null, roles: ['operator'] },
  );
  let matched: { group: string; name: string } | null = null;
  for (const rule of rules) {
    let holds = false;
    try {
      holds = evaluateCondition(rule.condition, scope);
    } catch {
      holds = false;
    }
    if (holds) {
      matched = { group: rule.group, name: rule.name };
      break;
    }
  }
  if (!matched) return record;

  const group = engine.groups.get(matched.group);
  const members: GroupMember[] = (group?.members ?? []).map((username) => {
    const person = engine.person(username);
    return {
      username,
      displayName: person?.displayName ?? username,
      active: person?.active ?? false,
      outOfOffice: person?.outOfOffice ?? false,
      capacity: person?.capacity ?? null,
      openRecords: openRecordsOf(engine, username),
    };
  });
  const chosen = nextAssignee(members, group?.lastAssigned ?? null, settings().ASSIGNMENT_CAPACITY);

  const fields: RecordFields = { ...record.fields };
  if (chosen) {
    fields.assignment_group = matched.group;
    fields.assigned_to = chosen.username;
  } else {
    fields.assignment_group = triageGroup;
    fields.assigned_to = null;
  }
  const versions: Record<string, number> = { ...record.versions };
  versions.assignment_group = (versions.assignment_group ?? 1) + 1;
  versions.assigned_to = (versions.assigned_to ?? 1) + 1;
  const updated: RecordRow = { ...record, fields, versions, updatedAt: nowMs() };
  await writeRecord(client, updated);
  engine.records.set(updated.number, updated);

  if (chosen) {
    await client.query(`UPDATE work_group SET last_assigned = $2 WHERE name = $1`, [
      matched.group,
      chosen.username,
    ]);
    await insertActivity(
      client,
      record.number,
      now(),
      'assignment',
      assignedLine(chosen.displayName, matched.name),
      null,
    );
  } else {
    await insertActivity(
      client,
      record.number,
      now(),
      'assignment',
      triageLine(matched.group, record.number),
      null,
    );
  }
  return updated;
}

function openRecordsOf(engine: Engine, username: string): number {
  let count = 0;
  for (const record of engine.records.values()) {
    if (record.fields.assigned_to !== username) continue;
    if (isOpenState(record.table, record.state)) count += 1;
  }
  return count;
}

export interface Conflict {
  readonly field: string;
  readonly label: string;
  readonly yours: unknown;
  readonly theirs: unknown;
  readonly theirsBy: string;
  readonly version: number;
}

export function conflictError(conflicts: readonly Conflict[]): ApiError {
  return new ApiError(
    409,
    'field_conflict',
    `Conflict on ${conflicts[0].label}: ${conflicts[0].theirsBy} saved a newer value.`,
    undefined,
    {
      conflicts: conflicts.map((c) => ({
        field: c.field,
        label: c.label,
        yours: c.yours,
        theirs: c.theirs,
        theirs_by: c.theirsBy,
        version: c.version,
      })),
    },
  );
}

async function lastEditorOf(client: PoolClient, number: string, field: string): Promise<string | null> {
  const result = await client.query<{ actor: string | null }>(
    `SELECT actor FROM record_audit WHERE number = $1 AND field = $2 ORDER BY id DESC LIMIT 1`,
    [number, field],
  );
  return result.rows[0]?.actor ?? null;
}

export interface PatchOptions {
  readonly fields: Readonly<Record<string, FieldSave>>;
  /**
   * The state the record is moving to, when this save belongs to a transition.
   * Form policies are then resolved against the state being moved to, so a
   * field the move makes visible and mandatory is kept rather than discarded.
   */
  readonly targetState?: string;
  readonly depth?: number;
  readonly reason?: string;
}

/**
 * Saves named fields with the versions they were last seen at. Saves to
 * different fields merge; a stale save to a changed field answers 409 with both
 * values and applies nothing.
 */
export async function patchRecord(
  engine: Engine,
  caller: Caller,
  number: string,
  options: PatchOptions,
): Promise<SaveResult> {
  const result = await transaction((client) => patchInTransaction(client, engine, caller, number, options));
  for (const event of result.events) publish(event);
  noticeListChange(result.record.table, result.record.number, 'updated');
  pushSlas(result.record.number, result.slas);
  publish({
    topic: `record:${result.record.number}`,
    event: 'changed',
    data: { number: result.record.number, state: result.record.state },
  });
  await runBackgroundRules(engine, caller, result.record);
  return result;
}

export async function patchInTransaction(
  client: PoolClient,
  engine: Engine,
  caller: Caller,
  number: string,
  options: PatchOptions,
): Promise<SaveResult> {
  const depth = options.depth ?? 1;
  if (depth > depthLimit()) throw new RuleDepthExceeded(depthLimit(), 'update_record');

  const existing = engine.records.get(number);
  if (!existing) throw notFound();
  const access = engine.accessContext(caller);
  if (!canSeeRecord(access, Engine.asAccessRecord(existing))) throw notFound();

  const table = existing.table;
  if (Object.keys(options.fields).length > 0 && !canWriteRecord(access, Engine.asAccessRecord(existing))) {
    throw deniedTableWrite(table);
  }

  const conflicts: Conflict[] = [];
  const submitted: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [name, save] of Object.entries(options.fields)) {
    const spec = fieldSpec(table, name);
    if (!spec || spec.name === 'state') continue;
    if (spec.derived && options.reason === undefined) continue;
    if (!canWriteField(access, Engine.asAccessRecord(existing), table, name)) {
      throw deniedFieldWrite(table, name);
    }
    const value = coerce(spec, save.value);
    const current = existing.versions[name] ?? 1;
    const sameAsStored = JSON.stringify(existing.fields[name] ?? null) === JSON.stringify(value ?? null);
    if (!sameAsStored && save.version !== undefined && save.version < current) {
      conflicts.push({
        field: name,
        label: fieldLabel(table, name),
        yours: value ?? null,
        theirs: existing.fields[name] ?? null,
        theirsBy: engine.displayName(await lastEditorOf(client, number, name)),
        version: current,
      });
      continue;
    }
    const problem = validateValue(table, spec, value);
    if (problem) errors[name] = problem;
    else submitted[name] = value;
  }

  if (conflicts.length > 0) throw conflictError(conflicts);

  const policyState = options.targetState ?? existing.state;
  const merged: RecordFields = { ...existing.fields, ...(submitted as RecordFields), state: policyState };
  const policyScope = engine.scopeFor(
    { table, fields: merged, state: policyState, number },
    caller,
  );
  const outcome = resolvePolicies(
    engine.formPolicies,
    { table },
    policyScope,
    tableFields[table].map((f) => f.name),
  );
  const enforcement = enforcePolicies(outcome, submitted, existing.fields, tableLabelFor(table));
  Object.assign(errors, enforcement.errors);
  for (const field of Object.keys(outcome)) {
    if (!outcome[field].visible) delete submitted[field];
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);

  const fields: RecordFields = { ...existing.fields, ...(submitted as RecordFields) };
  const before = existing.fields;

  const ruleRun = runRules(engine.businessRules, table, 'before', 'update', fields, (working) =>
    engine.scopeFor({ table, fields: working, state: existing.state, number }, caller, {
      previous: before,
      previousState: existing.state,
    }),
  );
  Object.assign(fields, ruleRun.effects.sets);

  const overridden = priorityOverridden(existing);
  const priorityBefore = Number(existing.fields.priority ?? 0);
  recomputeDerived(engine, table, fields, overridden);

  const versions: Record<string, number> = { ...existing.versions };
  const changed: string[] = [];
  for (const name of Object.keys(fields)) {
    if (JSON.stringify(fields[name] ?? null) === JSON.stringify(before[name] ?? null)) continue;
    versions[name] = (versions[name] ?? 1) + 1;
    changed.push(name);
  }

  let record: RecordRow = { ...existing, fields, versions, updatedAt: nowMs() };
  await writeRecord(client, record);
  engine.records.set(number, record);

  for (const name of changed) {
    await insertAudit(
      client,
      number,
      now(),
      name,
      before[name] ?? null,
      fields[name] ?? null,
      caller.actor,
      caller.impersonating ? caller.username : null,
      name === 'priority' && options.reason !== undefined ? options.reason : null,
    );
  }

  for (const note of ruleRun.effects.workNotes) {
    await insertActivity(client, number, now(), 'work_note', note, null);
  }

  const resetHook = lockedFieldHook();
  if (resetHook) await resetHook(client, engine, record, changed);

  const priorityAfter = Number(fields.priority ?? 0);
  if (priorityAfter !== priorityBefore && priorityAfter > 0) {
    await swapPriority(client, engine, record, priorityAfter);
  }
  await attachSlas(client, engine, record);
  const slas = await reviewSlas(client, engine, record);

  const after = runRules(engine.businessRules, table, 'after', 'update', record.fields, (working) =>
    engine.scopeFor({ table, fields: working, state: record.state, number }, caller, {
      previous: before,
      previousState: existing.state,
    }),
  );
  if (Object.keys(after.effects.sets).length > 0) {
    const merged2: RecordFields = { ...record.fields, ...(after.effects.sets as RecordFields) };
    const versions2 = { ...record.versions };
    for (const name of Object.keys(after.effects.sets)) {
      if (JSON.stringify(merged2[name] ?? null) !== JSON.stringify(record.fields[name] ?? null)) {
        versions2[name] = (versions2[name] ?? 1) + 1;
      }
    }
    record = { ...record, fields: merged2, versions: versions2, updatedAt: nowMs() };
    await writeRecord(client, record);
    engine.records.set(number, record);
  }
  for (const note of after.effects.workNotes) {
    await insertActivity(client, number, now(), 'work_note', note, null);
  }
  await deliverRuleInboxes(client, engine, record, [...ruleRun.effects.inboxes, ...after.effects.inboxes]);
  await announceAssignment(client, engine, record, typeof before.assigned_to === 'string' ? before.assigned_to : null);

  for (const nested of [...ruleRun.effects.nested, ...after.effects.nested]) {
    const target = resolveReferencePath(engine, record, nested.path);
    if (!target) continue;
    const nestedFields: Record<string, FieldSave> = {};
    const nestedScope = engine.scopeFor(
      { table: record.table, fields: record.fields, state: record.state, number },
      caller,
    );
    for (const [field, expression] of Object.entries(nested.fields)) {
      nestedFields[field] = {
        value: evaluateText(expression, nestedScope),
        version: target.versions[field] ?? 1,
      };
    }
    if (depth + 1 > depthLimit()) throw new RuleDepthExceeded(depthLimit(), nested.ruleName);
    await patchInTransaction(client, engine, caller, target.number, {
      fields: nestedFields,
      depth: depth + 1,
    });
  }

  const events: LiveEvent[] = changed.map((field) => ({
    topic: `record:${number}`,
    event: 'field',
    data: { number, field, value: fields[field] ?? null },
  }));
  return { record, slas, events };
}

function resolveReferencePath(engine: Engine, record: RecordRow, path: string): RecordRow | null {
  let current: RecordRow | null = record;
  for (const part of path.split('.')) {
    if (current === null) return null;
    const reference: FieldValue = current.fields[part] ?? null;
    if (typeof reference !== 'string') return null;
    current = engine.records.get(reference) ?? null;
  }
  return current;
}

export async function runBackgroundRules(
  engine: Engine,
  caller: Caller,
  record: RecordRow,
): Promise<void> {
  const rules = engine.businessRules.filter(
    (r) => r.active && r.table === record.table && r.when === 'background',
  );
  if (rules.length === 0) return;
  await transaction(async (client) => {
    try {
      const run = runRules(engine.businessRules, record.table, 'background', 'update', record.fields, (working) =>
        engine.scopeFor({ table: record.table, fields: working, state: record.state, number: record.number }, caller, {
          previous: record.fields,
          previousState: record.state,
        }),
      );
      for (const note of run.effects.workNotes) {
        await insertActivity(client, record.number, now(), 'work_note', note, null);
      }
      await deliverRuleInboxes(client, engine, record, run.effects.inboxes);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await insertActivity(
        client,
        record.number,
        now(),
        'rule',
        backgroundFailureLine(rules[0].name, message),
        null,
      );
    }
  });
}

/** The reopen deadline of a resolved incident, in the Office hours zone. */
export function reopenDeadline(engine: Engine, record: RecordRow): number | null {
  const resolvedAt = record.fields.resolved_at;
  if (typeof resolvedAt !== 'string') return null;
  const ms = Date.parse(resolvedAt);
  if (Number.isNaN(ms)) return null;
  const schedule = engine.officeHours;
  const zone = schedule.timeZone;
  const date = localDate(zone, ms);
  const deadlineDate = openDayAfter(schedule, date, 5);
  const wall = wallOf(ms, zone);
  const { year, month, day } = parseDate(deadlineDate);
  return instantOf(zone, {
    year,
    month,
    day,
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
  });
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a local date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Extra checks and side effects a table adds to a move. */
export interface TransitionHooks {
  readonly before?: (
    client: PoolClient,
    engine: Engine,
    caller: Caller,
    record: RecordRow,
    to: string,
  ) => Promise<void>;
  readonly after?: (
    client: PoolClient,
    engine: Engine,
    caller: Caller,
    record: RecordRow,
    to: string,
    from: string,
  ) => Promise<void>;
}

const hooksByTable = new Map<TableName, TransitionHooks>();

export function registerTransitionHooks(table: TableName, hooks: TransitionHooks): void {
  hooksByTable.set(table, hooks);
}

export type LockedFieldHook = (
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  changedFields: readonly string[],
) => Promise<void>;

let lockedHook: LockedFieldHook | null = null;

/** Registered by the change hooks, so a locked-field edit resets the approval. */
export function registerLockedFieldHook(hook: LockedFieldHook): void {
  lockedHook = hook;
}

function lockedFieldHook(): LockedFieldHook | null {
  return lockedHook;
}

/** Moves a record along its transition table, applying any fields sent with it. */
export async function transitionRecord(
  engine: Engine,
  caller: Caller,
  number: string,
  to: string,
  fields: Readonly<Record<string, FieldSave>> = {},
): Promise<SaveResult> {
  const outcome = await transaction((client) =>
    transitionInTransaction(client, engine, caller, number, to, fields),
  );
  for (const event of outcome.events) publish(event);
  noticeListChange(outcome.record.table, outcome.record.number, 'updated');
  pushSlas(outcome.record.number, outcome.slas);
  publish({
    topic: `record:${outcome.record.number}`,
    event: 'state',
    data: {
      number: outcome.record.number,
      state: outcome.record.state,
      state_label: stateLabel(outcome.record.table, outcome.record.state),
    },
  });
  await runBackgroundRules(engine, caller, outcome.record);
  return outcome;
}

export interface TransitionOptions {
  /**
   * Resolving a major incident resolves every open child from any open state,
   * so the child's move is not looked up in the transition table. Only the
   * resolve-together rule uses this.
   */
  readonly fromAnyOpenState?: boolean;
}

export async function transitionInTransaction(
  client: PoolClient,
  engine: Engine,
  caller: Caller,
  number: string,
  to: string,
  fields: Readonly<Record<string, FieldSave>> = {},
  options: TransitionOptions = {},
): Promise<SaveResult> {
  const existing = engine.records.get(number);
  if (!existing) throw notFound();
  if (!canSeeRecord(engine.accessContext(caller), Engine.asAccessRecord(existing))) throw notFound();

  if (Object.keys(fields).length > 0) {
    await patchInTransaction(client, engine, caller, number, { fields, targetState: to });
  }
  const record = engine.records.get(number);
  if (!record) throw notFound();

  const table = record.table;
  const from = record.state;
  const model = table === 'change' ? String(record.fields.model ?? 'normal') : null;

  const anyOpen = options.fromAnyOpenState === true && isOpenState(table, from);
  const row = findTransition(table, model, from, to);
  if (!anyOpen) {
    if (!row) throw illegalTransition(table, from, to);
    const movers = engine.moversFor(caller, record);
    if (!row.roles.some((role) => movers.includes(role))) throw roleNotAllowed(table, to);
  }

  const required = row?.required ?? rowsFor(table, model).find((r) => r.to === to)?.required;
  for (const spec of tableFields[table]) {
    if (!required?.includes(spec.name)) continue;
    if (emptyValue(record.fields[spec.name])) throw fieldRequired(table, spec.name, to);
  }

  // The move is a save, so before rules see the new state and may abort it.
  const beforeFields: RecordFields = { ...record.fields, state: to };
  runRules(engine.businessRules, table, 'before', 'update', beforeFields, (working) =>
    engine.scopeFor({ table, fields: working, state: to, number }, caller, {
      previous: record.fields,
      previousState: from,
    }),
  );

  const hooks = hooksByTable.get(table);
  if (hooks?.before) await hooks.before(client, engine, caller, record, to);

  const at = nowMs();
  const updatedFields: RecordFields = { ...record.fields, state: to };
  if (table === 'incident' && to === 'resolved') updatedFields.resolved_at = iso(new Date(at));
  if (table === 'problem' && to === 'resolved') updatedFields.resolved_at = iso(new Date(at));
  if (table === 'incident' && to === 'in_progress' && from === 'resolved') updatedFields.resolved_at = null;

  const history = [...record.stateHistory, { state: to, at: iso(new Date(at)) }];
  const versions = { ...record.versions, state: (record.versions.state ?? 1) + 1 };
  let moved: RecordRow = { ...record, state: to, fields: updatedFields, versions, stateHistory: history, updatedAt: at };
  await writeRecord(client, moved);
  engine.records.set(number, moved);

  await insertAudit(client, number, now(), 'state', from, to, caller.actor, caller.impersonating ? caller.username : null, null);
  await insertActivity(
    client,
    number,
    now(),
    'state',
    `${stateLabel(table, from)} to ${stateLabel(table, to)}`,
    caller.actor,
    caller.impersonating ? caller.username : null,
  );

  await attachSlas(client, engine, moved);
  const slas = await reviewSlas(client, engine, moved);

  if (hooks?.after) await hooks.after(client, engine, caller, moved, to, from);
  moved = engine.records.get(number) ?? moved;

  return {
    record: moved,
    slas,
    events: [{ topic: `record:${number}`, event: 'state', data: { number, state: to } }],
  };
}

/** Work notes and comments never conflict and always append. */
export async function addEntry(
  engine: Engine,
  caller: Caller,
  number: string,
  kind: 'work_note' | 'comment',
  text: string,
): Promise<{ at: string; actor: string }> {
  return transaction(async (client) => {
    const record = engine.records.get(number);
    if (!record) throw notFound();
    if (!canSeeRecord(engine.accessContext(caller), Engine.asAccessRecord(record))) throw notFound();
    const at = now();
    await insertActivity(
      client,
      number,
      at,
      kind,
      text,
      caller.actor,
      caller.impersonating ? caller.username : null,
    );
    const mentioned = mentionsIn(text, engine.people);
    if (mentioned.length > 0) {
      const delivered = await deliver(
        client,
        engine.inboxRules,
        engine.people,
        'mentioned',
        mentioned,
        eventTexts.mentioned(caller.displayName, number),
        number,
      );
      for (const username of delivered) {
        publish({
          topic: 'inbox',
          event: 'unread',
          data: { username, unread: await unreadCount(client, username) },
        });
      }
    }
    publish({
      topic: `record:${number}`,
      event: kind,
      data: { number, text, actor: caller.actor, at: iso(at) },
    });
    return { at: iso(at), actor: caller.actor };
  });
}

/** The published grid row label. */
export function rowLabel(
  engine: Engine,
  record: RecordRow,
  sla: SlaComputed | null,
): string {
  const type = typeLabels[record.table];
  const priority = Number(record.fields.priority ?? 0);
  const assignee =
    typeof record.fields.assigned_to === 'string' ? engine.displayName(record.fields.assigned_to) : 'nobody';
  const slaPart = sla === null ? ', no SLA' : `, SLA ${sla.percent} percent`;
  return `${type} ${record.number}, priority ${priority}, ${stateLabel(record.table, record.state)}, assigned to ${assignee}${slaPart}`;
}

export function shortDescriptionOf(engine: Engine, record: RecordRow): string {
  if (record.table === 'change') return String(record.fields.title ?? '');
  if (record.table === 'request_item') {
    const item = engine.catalogItems.get(String(record.fields.item ?? ''));
    return item?.name ?? String(record.fields.item ?? '');
  }
  return String(record.fields.short_description ?? '');
}

/** The published `<record summary>`. */
export function recordSummary(
  engine: Engine,
  caller: Caller,
  record: RecordRow,
  slas: readonly SlaComputed[],
): Record<string, unknown> {
  const sla = shownSla(slas);
  const readable = new Set(engine.readableFieldNames(caller, record));
  return {
    number: record.number,
    table: record.table,
    state: record.state,
    state_label: stateLabel(record.table, record.state),
    short_description: readable.has('short_description') || record.table === 'change'
      ? shortDescriptionOf(engine, record)
      : null,
    priority: readable.has('priority') ? Number(record.fields.priority ?? 0) : null,
    assigned_to: readable.has('assigned_to') ? (record.fields.assigned_to ?? null) : null,
    sla: sla === null ? null : slaJson(sla),
    label: rowLabel(engine, record, sla),
  };
}

/** The published `<record>`. */
export async function recordJson(
  engine: Engine,
  caller: Caller,
  record: RecordRow,
  slas: readonly SlaComputed[],
): Promise<Record<string, unknown>> {
  const access = engine.accessContext(caller);
  const readable = engine.readableFieldNames(caller, record);
  const scope = engine.scopeFor(
    { table: record.table, fields: record.fields, state: record.state, number: record.number },
    caller,
  );
  const outcome = resolvePolicies(engine.formPolicies, { table: record.table }, scope, readable);
  const fields: Record<string, unknown> = {};
  for (const name of readable) {
    const spec = fieldSpec(record.table, name);
    const state = outcome[name] ?? { mandatory: false, visible: true, read_only: false };
    fields[name] = {
      value: record.fields[name] ?? null,
      display: engine.displayOf(record.table, name, record.fields[name] ?? null),
      version: record.versions[name] ?? 1,
      label: fieldLabel(record.table, name),
      mandatory: state.mandatory,
      read_only: state.read_only || spec?.derived === true || !canWriteField(access, Engine.asAccessRecord(record), record.table, name),
      visible: state.visible,
    };
  }
  const children = [...engine.records.values()]
    .filter((r) => r.fields.parent === record.number)
    .map((r) => r.number);
  const linkedIncidents = [...engine.records.values()]
    .filter((r) => r.table === 'incident' && r.fields.problem === record.number)
    .map((r) => r.number);
  const problemNumber = typeof record.fields.problem === 'string' ? record.fields.problem : null;
  const problem = problemNumber ? engine.records.get(problemNumber) : null;
  const workaroundText = problem && typeof problem.fields.workaround === 'string' ? problem.fields.workaround : null;

  return {
    number: record.number,
    table: record.table,
    state: record.state,
    state_label: stateLabel(record.table, record.state),
    fields,
    priority_overridden: priorityOverridden(record),
    slas: slas.map(slaJson),
    links: {
      parent: record.fields.parent ?? null,
      children,
      problem: problemNumber,
      incidents: linkedIncidents,
      fix_change: record.fields.fix_change ?? null,
    },
    workaround:
      workaroundText && isOpenState(record.table, record.state) && problem
        ? { problem: problem.number, text: workaroundText }
        : null,
    transitions: engine.transitionsFor(caller, record),
  };
}

export function priorityBadgeLabel(priority: number): string {
  return `${priority} ${priorityLabel(priority)}`;
}

export function isReopenAllowed(engine: Engine, record: RecordRow): boolean {
  const deadline = reopenDeadline(engine, record);
  return deadline !== null && nowMs() <= deadline;
}

export function reopenWindowPassed(): ApiError {
  return new ApiError(
    422,
    'reopen_window_passed',
    'This incident was resolved more than 5 business days ago and cannot be reopened.',
  );
}

export { isOpenDay, addDays };
