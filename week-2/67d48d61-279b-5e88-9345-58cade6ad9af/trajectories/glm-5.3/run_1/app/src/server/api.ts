import {
  CYCLES, CYCLE_INDEX, type Priority, type Status, isCrewHandle, isCycleKey, isDepartmentKey, isLabelFor,
  isPriority, isStatus, legalStatusMove, idFromNumber, numberFromId, OPEN_STATUSES,
} from "../domain/model.js";
import type { CycleConfig } from "../domain/cycles.js";
import { currentCycle } from "../domain/cycles.js";
import type { PoolClient } from "pg";
import { Db, iso } from "./db.js";
import { Engine, RuleError, type Outcome } from "./engine.js";
import { Intake, IntakeRefused, type IntakeRequest } from "./intake.js";
import { PlotStorage } from "./storage.js";
import type { RequestJson, TaskBefore, TaskRow, StoredUndo } from "../domain/types.js";
export type { TaskRow };

export interface Ctx {
  db: Db;
  intake: Intake;
  storage: PlotStorage;
  cycleConfig: CycleConfig;
}

const MAX_TITLE = 140;
const MAX_DETAILS = 4000;

/** Request bodies are untrusted: every member is optional and unknown-typed until validated. */
export interface EditBody {
  title?: unknown;
  details?: unknown;
  status?: unknown;
  priority?: unknown;
  owner?: unknown;
  label?: unknown;
  cycle?: unknown;
  department?: unknown;
  parent?: unknown;
  decision?: unknown;
  reason?: unknown;
  duplicate_of?: unknown;
  requester?: unknown;
  blocks?: unknown;
  tasks?: unknown;
  set?: unknown;
}


function str(v: unknown): string | undefined { return typeof v === "string" ? v : undefined }
function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined }
export function actorFromHeader(header: string | undefined): string {
  if (header === undefined || header === "") return "maya";
  if (!isCrewHandle(header)) throw new RuleError("validation_failed", 422, {
    fields: { "X-Crew-Member": "Choose someone on the crew list." },
  });
  return header;
}

export function parseId(id: unknown, field = "tasks"): number {
  const m = /^STG-(\d+)$/.exec(typeof id === "string" ? id : "");
  if (!m) throw new RuleError("validation_failed", 422, { fields: { [field]: "Choose an existing task." } });
  return Number(m[1]);
}

function titleOrError(title: unknown): { title?: string; error: string | null } {
  if (typeof title !== "string") return { error: "Give the task a title." };
  const t = title.trim();
  if (t.length < 1) return { error: "Give the task a title." };
  if (t.length > MAX_TITLE) return { error: "Keep it to 140 characters." };
  return { title, error: null };
}

function isEditable(status: Status): boolean {
  return status !== "triage" && status !== "duplicate";
}

/** All-or-nothing single edit (DP-19, DP-20, DP-24, DP-44). */
export async function patchTask(ctx: Ctx, client: PoolClient, actor: string, number: number, body: EditBody, ifMatch: string | undefined): Promise<Outcome> {
  if (ifMatch === undefined) throw new RuleError("precondition_required", 428, {});
  const m = /^"?(\d+)"?$/.exec(ifMatch.trim());
  if (!m) throw new RuleError("validation_failed", 422, { fields: { IfMatch: "Choose a version." } });
  const engine = new Engine(client, actor);
  await engine.begin();
  const row = await engine.taskForUpdate(number);
  if (!row) { await engine.rollback(); throw new RuleError("not_found", 404, {}) }
  if (Number(m[1]) !== row.version) {
    await engine.rollback();
    const saved = await ctx.db.taskJson(number);
    throw new RuleError("version_conflict", 412, { current: saved });
  }
  if (!isEditable(row.status)) { await engine.rollback(); throw new RuleError("not_editable", 409, {}) }
  engine.remember(row);

  const fields: Partial<TaskRow> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (body.title !== undefined) {
    const { title, error } = titleOrError(body.title);
    if (error) { await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { title: error } }) }
    if (title !== row.title) { fields.title = title; changes.title = { from: row.title, to: title } }
  }
  if (body.details !== undefined) {
    if (typeof body.details !== "string" || body.details.length > MAX_DETAILS) {
      await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { details: "Keep details to 4,000 characters." } });
    }
    if (body.details !== row.details) { fields.details = body.details; changes.details = { from: row.details, to: body.details } }
  }
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) { await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { priority: "Choose a priority from 0 to 4." } }) }
    if (body.priority !== row.priority) { fields.priority = body.priority; changes.priority = { from: row.priority, to: body.priority } }
  }
  if (body.owner !== undefined) {
    if (body.owner !== null && !isCrewHandle(body.owner)) { await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { owner: "Choose someone on the crew list." } }) }
    if (body.owner !== row.owner) { fields.owner = body.owner; changes.owner = { from: row.owner, to: body.owner } }
  }
  if (body.label !== undefined) {
    if (body.label !== null && (typeof body.label !== "string" || !isLabelFor(row.department as never, body.label))) {
      await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { label: "Choose a label this department uses." } });
    }
    if (body.label !== row.label) { fields.label = body.label; changes.label = { from: row.label, to: body.label } }
  }
  if (body.cycle !== undefined) {
    const cur = currentCycle(new Date(), ctx.cycleConfig.spans).key;
    if (body.cycle !== null && (typeof body.cycle !== "string" || !isCycleKey(body.cycle) || CYCLE_INDEX[body.cycle as never] < CYCLE_INDEX[cur])) {
      await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { cycle: "Choose the current cycle or a later one." } });
    }
    if (body.cycle !== row.cycle) { fields.cycle = body.cycle; changes.cycle = { from: row.cycle, to: body.cycle } }
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status) || body.status === "triage" || body.status === "duplicate") {
      await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { status: "Choose a status." } });
    }
    if (body.status !== row.status) {
      await checkStatusMove(engine, row, body.status, []);
      fields.status = body.status; changes.status = { from: row.status, to: body.status };
    }
  }

  // a body that changes nothing creates no new change
  if (Object.keys(fields).length === 0) {
    await engine.rollback();
    return { change: 0, kind: "edit", touched: [number], cascade: [], reblocked: [], undoable: false, request: null, noop: true };
  }
  await engine.write(number, fields, { kind: "edited", changes });
  const direct = new Set<number>([number]);
  const levels = new Map<number, number>();
  if (fields.status === "done" || fields.status === "cancelled") levels.set(number, 0);
  const outcome = await engine.finish({ kind: "edit", direct, levels, undo: { crew: actor, kind: "edit" } });
  await engine.commit();
  return outcome;
}

async function checkStatusMove(engine: Engine, row: TaskRow, to: Status, closedInChange: number[]): Promise<void> {
  if (!legalStatusMove(row.status, to)) throw new RuleError("illegal_transition", 409, {});
  if (to === "done") {
    const open = (await engine.selectAllRows(
      `select l.source from links l join tasks b on b.number = l.source
       where l.target = $1 and b.status in ('backlog','todo','in_progress')`, [row.number],
    )) as unknown as { source: number }[];
    const remaining = open.filter((r) => !closedInChange.includes(r.source));
    if (remaining.length > 0) throw new RuleError("blocked_by_open", 409, {
      blocked_by: remaining.map((r) => idFromNumber(r.source)).sort((a, b) => numberFromId(a) - numberFromId(b)),
    });
    const subs = await engine.selectAllRows(
      `select number from tasks where parent = $1 and status in ('backlog','todo','in_progress')`, [row.number]);
    if (subs.length > 0) throw new RuleError("open_subtasks", 409, {});
  }
}

/** All-or-nothing bulk change (DP-08). */
export async function bulkChange(ctx: Ctx, client: PoolClient, actor: string, body: EditBody): Promise<Outcome> {
  const entries = body?.tasks;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) {
    throw new RuleError("validation_failed", 422, { fields: { tasks: "Choose 1 to 100 tasks." } });
  }
  interface BulkSet { status?: Status; priority?: Priority; owner?: string | null }
  const rawSet = (body.set ?? {}) as Record<string, unknown>;
  const fields: BulkSet = {};
  if (rawSet.status !== undefined) {
    if (!isStatus(rawSet.status) || rawSet.status === "triage" || rawSet.status === "duplicate") {
      throw new RuleError("validation_failed", 422, { fields: { status: "Choose a status." } });
    }
    fields.status = rawSet.status;
  }
  if (rawSet.priority !== undefined) {
    if (!isPriority(rawSet.priority)) throw new RuleError("validation_failed", 422, { fields: { priority: "Choose a priority from 0 to 4." } });
    fields.priority = rawSet.priority;
  }
  if (rawSet.owner !== undefined) {
    if (rawSet.owner !== null && !isCrewHandle(rawSet.owner)) throw new RuleError("validation_failed", 422, { fields: { owner: "Choose someone on the crew list." } });
    fields.owner = rawSet.owner as string | null;
  }
  if (Object.keys(fields).length === 0) throw new RuleError("validation_failed", 422, { fields: { set: "Choose a change to make." } });

  const engine = new Engine(client, actor);
  await engine.begin();
  const ids = entries.map((e) => {
    const rec = e as Record<string, unknown>;
    const n = parseId(rec.id);
    if (typeof rec.version !== "number") throw new RuleError("validation_failed", 422, { fields: { tasks: "Choose 1 to 100 tasks." } });
    return { n, version: rec.version };
  });
  const known = await engine.selectAllRows("select number from tasks where number = any($1::int[])", [ids.map((i) => i.n)]);
  const knownSet = new Set(known.map((r) => r.number));
  const unknown = [...new Set(ids.filter((i) => !knownSet.has(i.n)).map((i) => i.n))];
  if (unknown.length > 0) {
    await engine.rollback();
    throw new RuleError("not_found", 404, { tasks: unknown.sort((a, b) => a - b).map(idFromNumber) });
  }
  const sorted = [...new Set(ids.map((i) => i.n))].sort((a, b) => a - b);
  const rows = new Map<number, TaskRow>();
  for (const n of sorted) rows.set(n, (await engine.taskForUpdate(n))!);

  const stale = sorted.filter((n) => ids.find((i: { n: number; version: number }) => i.n === n)!.version !== rows.get(n)!.version);
  if (stale.length > 0) {
    await engine.rollback();
    const current = [];
    for (const n of stale) current.push(await ctx.db.taskJson(n));
    throw new RuleError("version_conflict", 412, { current });
  }
  // state conflicts in the published order
  const notEditable = sorted.filter((n) => !isEditable(rows.get(n)!.status));
  if (notEditable.length > 0) {
    await engine.rollback();
    throw new RuleError("not_editable", 409, { tasks: notEditable.map(idFromNumber) });
  }
  const illegal = sorted.filter((n) => {
    const r = rows.get(n)!;
    return fields.status !== undefined && fields.status !== r.status && !legalStatusMove(r.status, fields.status as Status);
  });
  if (illegal.length > 0) {
    await engine.rollback();
    throw new RuleError("illegal_transition", 409, { tasks: illegal.map(idFromNumber) });
  }
  if (fields.status === "done") {
    const closedInChange = sorted.filter((n) => rows.get(n)!.status !== "done");
    const refused: number[] = [];
    const blockedBy: number[] = [];
    for (const n of sorted) {
      if (rows.get(n)!.status === "done") continue;
      const open = (await engine.selectAllRows(
        `select l.source from links l join tasks b on b.number = l.source
         where l.target = $1 and b.status in ('backlog','todo','in_progress')`, [n],
      )) as unknown as { source: number }[];
      const remaining = open.filter((r) => !closedInChange.includes(r.source));
      if (remaining.length > 0) { refused.push(n); blockedBy.push(...remaining.map((r) => r.source)) }
    }
    if (refused.length > 0) {
      await engine.rollback();
      throw new RuleError("blocked_by_open", 409, {
        tasks: refused.sort((a, b) => a - b).map(idFromNumber),
        blocked_by: [...new Set(blockedBy)].sort((a, b) => a - b).map(idFromNumber),
      });
    }
    const openSubs: number[] = [];
    for (const n of sorted) {
      if (rows.get(n)!.status === "done") continue;
      const subs = await engine.selectAllRows(
        `select number from tasks where parent = $1 and status in ('backlog','todo','in_progress')`, [n]);
      if (subs.length > 0) openSubs.push(n);
    }
    if (openSubs.length > 0) {
      await engine.rollback();
      throw new RuleError("open_subtasks", 409, { tasks: openSubs.sort((a, b) => a - b).map(idFromNumber) });
    }
  }

  const direct = new Set<number>();
  const levels = new Map<number, number>();
  for (const n of sorted) {
    const row = rows.get(n)!;
    engine.remember(row);
    const f: Partial<TaskRow> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(fields)) {
      const from = (row as unknown as Record<string, unknown>)[k]; if (from !== v) { (f as unknown as Record<string, unknown>)[k] = v; changes[k] = { from, to: v } }
    }
    if (Object.keys(f).length > 0) {
      await engine.write(n, f, { kind: "edited", changes });
      direct.add(n);
      if (f.status === "done" || f.status === "cancelled") levels.set(n, 0);
    }
  }
  if (direct.size === 0) {
    await engine.rollback();
    return { change: 0, kind: "bulk", touched: sorted, cascade: [], reblocked: [], undoable: false, request: null, noop: true };
  }
  const outcome = await engine.finish({ kind: "bulk", direct, levels, undo: { crew: actor, kind: "bulk" } });
  await engine.commit();
  return outcome;
}

export async function createTask(ctx: Ctx, client: PoolClient, actor: string, body: EditBody): Promise<{ outcome: Outcome; taskNumber: number }> {
  const fields: Record<string, string> = {};
  const { title: newTitle, error: tErr } = titleOrError(body.title);
  if (tErr) fields.title = tErr;
  if (body.details !== undefined && (typeof body.details !== "string" || body.details.length > MAX_DETAILS)) fields.details = "Keep details to 4,000 characters.";
  if (!isDepartmentKey(body.department)) fields.department = "Choose a department.";
  if (body.priority !== undefined && !isPriority(body.priority)) fields.priority = "Choose a priority from 0 to 4.";
  if (body.owner !== undefined && body.owner !== null && !isCrewHandle(body.owner)) fields.owner = "Choose someone on the crew list.";
  if (body.status !== undefined && body.status !== "backlog" && body.status !== "todo") fields.status = "Choose a status.";
  const cur = currentCycle(new Date(), ctx.cycleConfig.spans).key;
  const givenCycle = body.cycle;
  if (givenCycle !== undefined && givenCycle !== null && (!isCycleKey(givenCycle) || CYCLE_INDEX[givenCycle as never] < CYCLE_INDEX[cur])) {
    fields.cycle = "Choose the current cycle or a later one.";
  }
  const givenDept = isDepartmentKey(body.department) ? body.department : null;
  if (typeof body.label === "string" && givenDept !== null && !isLabelFor(givenDept, body.label)) {
    fields.label = "Choose a label this department uses.";
  }
  let parent: number | null = null;
  if (body.parent !== undefined && body.parent !== null) {
    const m = /^STG-(\d+)$/.exec(typeof body.parent === "string" ? body.parent : "");
    if (!m) fields.parent = "Choose an existing task that is not a sub-task.";
    else parent = Number(m[1]);
  }
  if (Object.keys(fields).length > 0) throw new RuleError("validation_failed", 422, { fields });

  const engine = new Engine(client, actor);
  await engine.begin();
  if (parent !== null) {
    const p = await engine.taskForUpdate(parent);
    if (!p || p.parent !== null) {
      await engine.rollback();
      throw new RuleError("validation_failed", 422, { fields: { parent: "Choose an existing task that is not a sub-task." } });
    }
    if (p.status === "triage" || p.status === "duplicate") { await engine.rollback(); throw new RuleError("illegal_relation", 409, {}) }
    const blockers = await engine.selectAllRows("select 1 from links where target = $1", [parent]);
    if (blockers.length > 0) { await engine.rollback(); throw new RuleError("blocks_parent", 409, {}) }
  }
  const max = (await engine.selectRow("select coalesce(max(number),0)::int as n from tasks")) as unknown as { n: number };
  const n = max.n + 1;
  await client.query(
    `insert into tasks (number, title, details, department, label, status, priority, owner, cycle, parent, version, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,now())`,
    [n, newTitle, body.details ?? "", body.department, body.label ?? null,
     body.status ?? "backlog", body.priority ?? 0, body.owner ?? null, body.cycle ?? cur, parent],
  );
  await engine.activity(n, "created", { status: { from: null, to: body.status ?? "backlog" } }, actor);
  const outcome = await engine.finish({ kind: "create", direct: new Set([n]), levels: new Map() });
  await engine.commit();
  return { outcome, taskNumber: n };
}

export async function addRelation(ctx: Ctx, client: PoolClient, actor: string, id: number, blocks: unknown): Promise<Outcome> {
  if (typeof blocks !== "string") throw new RuleError("validation_failed", 422, { fields: { blocks: "Choose an existing task." } });
  const target = parseId(blocks, "blocks");
  const engine = new Engine(client, actor);
  await engine.begin();
  if (id === target) { await engine.rollback(); throw new RuleError("validation_failed", 422, { fields: { blocks: "A task can't block itself." } }) }
  const first = Math.min(id, target), second = Math.max(id, target);
  const a = await engine.taskForUpdate(first);
  const b = await engine.taskForUpdate(second);
  if (!a || !b) { await engine.rollback(); throw new RuleError("not_found", 404, {}) }
  const src = id < target ? a : b;
  const tgt = id < target ? b : a;
  if (src.status === "triage" || src.status === "duplicate" || tgt.status === "triage" || tgt.status === "duplicate") {
    await engine.rollback(); throw new RuleError("illegal_relation", 409, {});
  }
  const exists = await engine.selectAllRows("select 1 from links where source = $1 and target = $2", [id, target]);
  if (exists.length > 0) { await engine.rollback(); throw new RuleError("relation_exists", 409, {}) }
  const subs = await engine.selectAllRows("select 1 from tasks where parent = $1", [target]);
  if (subs.length > 0) { await engine.rollback(); throw new RuleError("blocks_parent", 409, {}) }
  if (await reaches(engine, target, id)) { await engine.rollback(); throw new RuleError("relation_cycle", 409, {}) }

  await client.query("insert into links (source, target) values ($1,$2)", [id, target]);
  engine.remember(src); engine.remember(tgt);
  await engine.write(id, {}, { kind: "linked", changes: { blocks: { from: null, to: idFromNumber(target) } } });
  await engine.write(target, {}, { kind: "linked", changes: { blocked_by: { from: null, to: idFromNumber(id) } } });
  const outcome = await engine.finish({
    kind: "relation", direct: new Set([id, target]), levels: new Map(),
  });
  await engine.commit();
  return outcome;
}

async function reaches(engine: Engine, from: number, to: number): Promise<boolean> {
  const rows = await engine.selectAllRows(
    `with recursive walk(n) as (
       select $1::int as n
       union
       select l.target from links l join walk on l.source = walk.n
     ) select n from walk`, [from]);
  return rows.some((r) => (r as unknown as { n: number }).n === to);
}

export async function removeRelation(ctx: Ctx, client: PoolClient, actor: string, id: number, target: number): Promise<Outcome> {
  const engine = new Engine(client, actor);
  await engine.begin();
  const src = await engine.taskForUpdate(id);
  const tgt = await engine.taskForUpdate(target);
  if (!src || !tgt) { await engine.rollback(); throw new RuleError("not_found", 404, {}) }
  const wasBlocked = OPEN_STATUSES.includes(tgt.status) && (await engine.selectAllRows(
    `select 1 from links l join tasks b on b.number = l.source
     where l.target = $1 and b.status in ('backlog','todo','in_progress')`, [target])).length > 0;
  const del = await client.query("delete from links where source = $1 and target = $2", [id, target]);
  if (del.rowCount === 0) { await engine.rollback(); throw new RuleError("not_found", 404, {}) }
  engine.remember(src); engine.remember(tgt);
  await engine.write(id, {}, { kind: "unlinked", changes: { blocks: { from: idFromNumber(target), to: null } } });
  await engine.write(target, {}, { kind: "unlinked", changes: { blocked_by: { from: idFromNumber(id), to: null } } });
  const stillBlocked = OPEN_STATUSES.includes(tgt.status) && (await engine.selectAllRows(
    `select 1 from links l join tasks b on b.number = l.source
     where l.target = $1 and b.status in ('backlog','todo','in_progress')`, [target])).length > 0;
  const outcome = await engine.finish({
    kind: "relation", direct: new Set([id]), levels: new Map(), alsoListed: new Set([target]),
    link: { freed: wasBlocked && !stillBlocked ? [target] : [], blocker: idFromNumber(id) },
  });
  await engine.commit();
  return outcome;
}

/** The one place the undo restore is decided (DP-15, DP-16). */
export async function undoChange(ctx: Ctx, client: PoolClient, actor: string): Promise<Outcome> {
  const engine = new Engine(client, actor);
  await engine.begin();
  const j = (await engine.selectRow(
    `select j.seq, j.undone, u.* from journal j join undo_journal u on u.change = j.seq
     where u.crew = $1 and j.undoable = true order by j.seq desc limit 1`, [actor])) as unknown as {
    seq: number; undone: boolean; before: TaskBefore[];
    after_versions: { number: number; version: number }[];
    cascade_json: { id: string; order: number }[];
  };
  if (!j || j.undone) { await engine.rollback(); throw new RuleError("nothing_to_undo", 409, {}) }
  const before = j.before;
  const afterVersions = j.after_versions;
  const undoneCascade = j.cascade_json;
  for (const av of afterVersions) {
    const row = await engine.task(av.number);
    if (!row || row.version !== av.version) { await engine.rollback(); throw new RuleError("undo_stale", 409, {}) }
  }
  const direct = new Set<number>();
  const levels = new Map<number, number>();
  for (const b of before) {
    const row = await engine.taskForUpdate(b.number);
    if (!row) continue;
    engine.remember(row);
    const f: Partial<TaskRow> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (row.status !== b.status) { f.status = b.status; changes.status = { from: row.status, to: b.status } }
    if (row.priority !== b.priority) { f.priority = b.priority; changes.priority = { from: row.priority, to: b.priority } }
    if (row.owner !== b.owner) { f.owner = b.owner; changes.owner = { from: row.owner, to: b.owner } }
    if (row.title !== b.title) { f.title = b.title; changes.title = { from: row.title, to: b.title } }
    if (row.details !== b.details) { f.details = b.details; changes.details = { from: row.details, to: b.details } }
    if (row.label !== b.label) { f.label = b.label; changes.label = { from: row.label, to: b.label } }
    if (row.cycle !== b.cycle) { f.cycle = b.cycle; changes.cycle = { from: row.cycle, to: b.cycle } }
    if (Object.keys(f).length > 0) {
      await engine.write(b.number, f, null);
      await engine.activity(b.number, "undo", changes, actor);
      direct.add(b.number);
      if (f.status === "done" || f.status === "cancelled") levels.set(b.number, 0);
    }
  }
  await client.query("update journal set undone = true where seq = $1", [j.seq]);
  const outcome = await engine.finish({ kind: "undo", direct, levels, skipRollup: true });
  // reblocked: the undone change's cascade in reverse order, only what actually blocked again
  const reversed = [...undoneCascade].sort((a, b) => b.order - a.order);
  const reblocked: { id: string; order: number }[] = [];
  let order = 1;
  for (const c of reversed) {
    const r = (await engine.selectRow(
      `select t.status, exists(select 1 from links l join tasks b on b.number = l.source
         where l.target = t.number and b.status in ('backlog','todo','in_progress')) as blocked
       from tasks t where t.number = $1`, [numberFromId(c.id)],
    )) as unknown as { status: Status; blocked: boolean } | null;
    if (r && r.blocked && OPEN_STATUSES.includes(r.status)) reblocked.push({ id: c.id, order: order++ });
  }
  outcome.reblocked = reblocked;
  await engine.commit();
  return outcome;
}

export function requestToJson(r: IntakeRequest): RequestJson {
  return {
    id: r.id, title: r.title, details: r.details, requester: r.requester, department: r.department,
    status: r.status, task: r.task === "" ? null : r.task, created: r.created, decided_at: r.decided_at,
  };
}

/** Triage decision: the intake write-back is part of the commit (DP-02). */
export async function triageDecision(ctx: Ctx, client: PoolClient, actor: string, number: number, body: EditBody): Promise<{ outcome: Outcome; request: RequestJson }> {
  const decision = body?.decision;
  const fields: Record<string, string> = {};
  if (decision !== "accept" && decision !== "decline" && decision !== "merge") fields.decision = "Choose accept, decline or merge.";
  let dupNum: number | null = null;
  if (decision === "accept") {
    if (!isDepartmentKey(body?.department)) fields.department = "Choose a department.";
    if (body?.priority !== undefined && !isPriority(body?.priority)) fields.priority = "Choose a priority from 0 to 4.";
    if (body?.owner !== undefined && body?.owner !== null && !isCrewHandle(body.owner)) fields.owner = "Choose someone on the crew list.";
    const triDept = isDepartmentKey(body?.department) ? body.department : null;
    if (typeof body?.label === "string" && triDept !== null && !isLabelFor(triDept, body?.label)) fields.label = "Choose a label this department uses.";
  }
  if (decision === "decline" && (typeof body?.reason !== "string" || body.reason.trim().length < 1)) fields.reason = "Say why it was declined.";
  if (decision === "merge") {
    const m = /^STG-(\d+)$/.exec(typeof body?.duplicate_of === "string" ? body.duplicate_of : "");
    if (!m) fields.duplicate_of = "Choose an accepted task to merge into.";
    else dupNum = Number(m[1]);
  }
  if (Object.keys(fields).length > 0) throw new RuleError("validation_failed", 422, { fields });

  const engine = new Engine(client, actor);
  await engine.begin();
  const row = await engine.taskForUpdate(number);
  if (!row) { await engine.rollback(); throw new RuleError("not_found", 404, {}) }
  if (row.status !== "triage") { await engine.rollback(); throw new RuleError("already_decided", 409, {}) }
  if (dupNum !== null) {
    const target = await engine.task(dupNum);
    if (!target || !["backlog", "todo", "in_progress", "done"].includes(target.status)) {
      await engine.rollback();
      throw new RuleError("validation_failed", 422, { fields: { duplicate_of: "Choose an accepted task to merge into." } });
    }
  }
  let rec: IntakeRequest | null = null;
  if (row.request) {
    try { rec = await ctx.intake.record(row.request) } catch {
      await engine.rollback(); throw new RuleError("intake_unavailable", 503, {});
    }
    if (!rec || rec.status !== "pending") { await engine.rollback(); throw new RuleError("intake_rejected", 502, {}) }
  }
  const cur = currentCycle(new Date(), ctx.cycleConfig.spans).key;
  engine.remember(row);
  const direct = new Set<number>([number]);
  if (decision === "accept") {
    const triDept = isDepartmentKey(body?.department) ? body.department : "carpentry";
    const triPri = isPriority(body?.priority) ? body.priority : 0;
    const triOwner = isCrewHandle(body?.owner) ? body.owner : null;
    const triLabel = typeof body?.label === "string" ? body.label : null;
    await engine.write(number, {
      status: "backlog", department: triDept, cycle: cur,
      priority: triPri, owner: triOwner, label: triLabel,
    }, { kind: "decided", changes: { status: { from: "triage", to: "backlog" } } });
  } else if (decision === "decline") {
    await engine.write(number, { status: "cancelled", cycle: null }, {
      kind: "decided", changes: { status: { from: "triage", to: "cancelled" } },
    });
  } else {
    await engine.write(number, { status: "duplicate", cycle: null, duplicate_of: dupNum }, {
      kind: "decided", changes: { status: { from: "triage", to: "duplicate" } },
    });
  }
  let request: RequestJson;
  if (rec) {
    // the decision becomes final only after the intake records the outcome (DP-02)
    try {
      await ctx.intake.decide(rec.id, {
        status: decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "merged",
        task: decision === "merge" ? idFromNumber(dupNum!) : idFromNumber(number),
        decision_note: decision === "decline" ? str(body.reason) ?? "" : "",
        decided_at: new Date().toISOString(),
      });
      request = requestToJson((await ctx.intake.record(rec.id))!);
    } catch (e) {
      await engine.rollback();
      if (e instanceof IntakeRefused) throw new RuleError("intake_rejected", 502, {});
      throw new RuleError("intake_unavailable", 503, {});
    }
  } else {
    request = requestToJson({
      id: row.request ?? "", title: row.title, details: row.details, requester: "", department: row.department,
      status: decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "merged",
      task: decision === "merge" ? idFromNumber(dupNum!) : idFromNumber(number), decision_note: "",
      decided_at: new Date().toISOString(), created: iso(new Date()),
    });
  }
  const outcome = await engine.finish({ kind: "decision", direct, levels: new Map(), request });
  await engine.commit();
  return { outcome, request };
}

/** Rollover: open tasks of a past cycle move to the current cycle (DP-37). */
export async function rollover(ctx: Ctx, client: PoolClient): Promise<Outcome | null> {
  const cur = currentCycle(new Date(), ctx.cycleConfig.spans).key;
  const engine = new Engine(client, "promptside");
  await engine.begin();
  const past = CYCLE_INDEX[cur] === 0
    ? null
    : `(${CYCLES.slice(0, CYCLE_INDEX[cur]).map((c) => `'${c.key}'`).join(",")})`;
  const rows = past === null ? [] : await engine.selectAllRows(
    `select number, cycle from tasks where cycle in ${past} and status in ('backlog','todo','in_progress')`, []);
  if (rows.length === 0) { await engine.rollback(); return null }
  const direct = new Set<number>();
  for (const r of rows) {
    const row = await engine.taskForUpdate(r.number);
    engine.remember(row!);
    await engine.write(r.number, { cycle: cur }, {
      kind: "rolled", changes: { cycle: { from: r.cycle, to: cur } }, actor: null,
    });
    direct.add(r.number);
  }
  const outcome = await engine.finish({ kind: "rollover", direct, levels: new Map() });
  await engine.commit();
  return outcome;
}

/** Intake pull: one Triage task per pending record with no task yet (DP-01). */
export async function pullIntake(ctx: Ctx, client: PoolClient): Promise<Outcome | null> {
  let pending: IntakeRequest[];
  try { pending = await ctx.intake.pending() } catch { return null }
  const engine = new Engine(client, "promptside");
  await engine.begin();
  const existing = new Set((await engine.selectAllRows("select request from tasks where request is not null")).map((r) => r.request));
  const direct = new Set<number>();
  let next = ((await engine.selectRow("select coalesce(max(number),0)::int as n from tasks")) as unknown as { n: number }).n;
  for (const rec of pending) {
    if (existing.has(rec.id)) continue;
    next += 1;
    await client.query(
      `insert into tasks (number, title, details, department, label, status, priority, owner, cycle, parent, request, version, updated_at)
       values ($1,$2,$3,$4,null,'triage',0,null,null,null,$5,1,now())`,
      [next, rec.title, rec.details, rec.department ?? "", rec.id],
    );
    await engine.activity(next, "created", { status: { from: null, to: "triage" } }, null);
    direct.add(next);
  }
  if (direct.size === 0) { await engine.rollback(); return null }
  const outcome = await engine.finish({ kind: "pull", direct, levels: new Map() });
  await engine.commit();
  return outcome;
}

