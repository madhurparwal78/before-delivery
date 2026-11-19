import { evaluate, type Value } from "../shared/expression.js";
import type { Table } from "../shared/types.js";
import { now } from "./clock.js";
import { assertExpression, compile, conditionHolds } from "./conditions.js";
import { settings } from "./config.js";
import { transaction, type Tx } from "./db.js";
import { Env, SYSTEM } from "./env.js";
import { ApiError, fail, notFound, validation } from "./errors.js";
import { deliver } from "./inbox.js";
import { publish, publishTo } from "./live.js";
import { findRecord, nowIso, save } from "./records.js";
import { configList, configGet, type ConfigRow } from "./store.js";
import { recordScope, type RecordObj } from "./world.js";

export type StepType = "trigger" | "if" | "loop" | "approval" | "create_task" | "set_fields" | "wait" | "subflow" | "notify" | "end";
const STEP_TYPES: StepType[] = ["trigger", "if", "loop", "approval", "create_task", "set_fields", "wait", "subflow", "notify", "end"];

export interface Step {
  id: string;
  type: StepType;
  name: string;
  on_error?: Step[];
  on?: "record_created" | "record_updated" | "item_ordered";
  table?: Table;
  items?: string[];
  condition?: string;
  then?: Step[];
  else?: Step[];
  over?: string | null;
  until?: string | null;
  body?: Step[];
  approvers?: { kind: "department_approvers" | "user"; user: string | null };
  rule?: "any" | "all";
  group?: string;
  short_description?: string;
  wait?: boolean;
  fields?: Record<string, string>;
  units?: number;
  flow?: string;
  inputs?: Record<string, string>;
  to?: { users?: string[]; roles?: string[] };
  text?: string;
}

export interface WorkflowContent {
  name: string;
  kind: "flow" | "subflow";
  inputs: { name: string; type: string }[];
  outputs: { name: string; expr: string }[];
  draft: Step[];
}

export interface WorkflowJson extends WorkflowContent {
  id: number;
  versions: number[];
}

type StepStatus = "waiting" | "running" | "done" | "skipped" | "failed" | "handled";

interface RunStepView {
  id: string;
  name: string;
  status: StepStatus;
  error: string | null;
  simulated?: boolean;
}

interface RunState {
  done: Record<string, Record<string, Value>>;
  failed: { key: string; message: string } | null;
  waitingTask: string | null;
  waitingApproval: number | null;
  inputs: Record<string, Value>;
}

class Suspend extends Error {}

class StepFailure extends Error {}

async function versionsOf(tx: Tx, id: number, includeWithdrawn = false): Promise<Array<{ version: number; steps: Step[]; withdrawn: boolean }>> {
  const rows = await tx.query("SELECT version, steps, withdrawn FROM workflow_versions WHERE workflow_id = $1 ORDER BY version", [id]);
  return rows.map((r) => ({ version: r.version as number, steps: r.steps as Step[], withdrawn: r.withdrawn as boolean })).filter((v) => includeWithdrawn || !v.withdrawn);
}

export async function workflowJson(tx: Tx, row: ConfigRow<WorkflowContent>): Promise<WorkflowJson> {
  return { ...row.content, id: row.id, versions: (await versionsOf(tx, row.id)).map((v) => v.version) };
}

function stepTable(trigger: Step | undefined): Table {
  if (trigger?.on === "item_ordered") return "request_item";
  return trigger?.table ?? "incident";
}

function eachStep(steps: Step[], visit: (step: Step) => void): void {
  for (const step of steps) {
    visit(step);
    for (const nested of [step.then, step.else, step.body, step.on_error]) if (nested) eachStep(nested, visit);
  }
}

/** Refuses a draft with unknown step types, repeated ids or expressions that do not parse. */
export function validateDraft(content: Pick<WorkflowContent, "kind">, steps: Step[]): void {
  const seen = new Set<string>();
  const trigger = steps.find((s) => s.type === "trigger");
  const table = stepTable(trigger);
  if (content.kind === "flow" && steps.length > 0 && steps[0]!.type !== "trigger") validation("A flow starts with its trigger step.");
  eachStep(steps, (step) => {
    if (!STEP_TYPES.includes(step.type)) validation(`Unknown step type "${String(step.type)}".`);
    if (typeof step.id !== "string" || step.id === "" || seen.has(step.id)) validation(`Step ids must be unique; "${step.id}" is repeated or empty.`);
    seen.add(step.id);
    if (typeof step.name !== "string" || step.name === "") validation("Every step needs a name.");
    const context = { table: null, extraRoots: ["inputs", "steps", "variables"] };
    for (const text of [step.condition, step.over ?? undefined, step.until ?? undefined, ...Object.values(step.fields ?? {}), ...Object.values(step.inputs ?? {})]) {
      if (typeof text === "string" && text !== "") assertExpression(text, { ...context, table });
    }
  });
}

async function latestVersion(tx: Tx, id: number): Promise<{ version: number; steps: Step[] } | null> {
  const all = await versionsOf(tx, id);
  return all[all.length - 1] ?? null;
}

/** The flows a flow calls through the latest published versions of subflows, depth first. */
async function refuseSubflowCycle(tx: Tx, own: ConfigRow<WorkflowContent>, steps: Step[]): Promise<void> {
  const all = await configList<WorkflowContent>("workflow", "live", tx);
  const byName = new Map(all.map((w) => [w.name, w]));
  const calls = async (entry: Step[]): Promise<string[]> => {
    const out: string[] = [];
    eachStep(entry, (s) => {
      if (s.type === "subflow" && s.flow) out.push(s.flow);
    });
    return out;
  };
  const walk = async (name: string, trail: string[]): Promise<void> => {
    const target = byName.get(name);
    const latest = target ? await latestVersion(tx, target.id) : null;
    if (!latest) return;
    for (const next of await calls(latest.steps)) {
      if (next === own.name) fail(422, "subflow_cycle", `This subflow calls itself: ${[...trail, next].join(" -> ")}.`);
      if (!trail.includes(next)) await walk(next, [...trail, next]);
    }
  };
  for (const first of await calls(steps)) {
    if (first === own.name) fail(422, "subflow_cycle", `This subflow calls itself: ${own.name} -> ${first}.`);
    await walk(first, [own.name, first]);
  }
}

export async function publishWorkflow(env: Env, id: number): Promise<number> {
  const row = await workflowRowById(env.tx, id);
  if (!row) return notFound();
  validateDraft(row.content, row.content.draft);
  await refuseSubflowCycle(env.tx, row, row.content.draft);
  const rows = await env.tx.query("SELECT coalesce(max(version), 0) + 1 AS next FROM workflow_versions WHERE workflow_id = $1", [id]);
  const version = rows[0]!.next as number;
  await env.tx.query("INSERT INTO workflow_versions (workflow_id, version, steps) VALUES ($1, $2, $3)", [id, version, JSON.stringify(row.content.draft)]);
  return version;
}

export async function workflowRowById(tx: Tx, id: number, workspace?: string): Promise<ConfigRow<WorkflowContent> | undefined> {
  const rows = await tx.query("SELECT id, name, content, promoted, workspace FROM config_items WHERE kind = 'workflow' AND id = $1", [id]);
  const r = rows[0];
  if (!r || (workspace && r.workspace !== workspace)) return undefined;
  return { id: r.id as number, name: r.name as string, content: r.content as WorkflowContent, promoted: (r.promoted as WorkflowContent | null) ?? null };
}

function viewOf(row: Record<string, unknown>): { id: number; workflow: string; version: number; record: string | null; status: string; steps: RunStepView[] } {
  return { id: row.id as number, workflow: row.workflow_name as string, version: row.version as number, record: (row.record as string | null) ?? null, status: row.status as string, steps: row.steps as RunStepView[] };
}

export async function runJson(tx: Tx, id: number): Promise<ReturnType<typeof viewOf> | null> {
  const rows = await tx.query("SELECT * FROM runs WHERE id = $1", [id]);
  return rows[0] ? viewOf(rows[0]) : null;
}

interface Execution {
  env: Env;
  runId: number;
  rec: RecordObj;
  state: RunState;
  views: RunStepView[];
  test: boolean;
  wakeAt: number | null;
  version: number;
}

function scopeFor(run: Execution, inputs: Record<string, Value>): ReturnType<typeof recordScope> {
  const steps: Record<string, Record<string, Value>> = {};
  for (const [key, outputs] of Object.entries(run.state.done)) steps[key.split("/").pop()!.replace(/\[\d+\]$/, "")] = outputs;
  const fields = run.rec.fields;
  const variables = (fields.variables as Record<string, Value> | null | undefined) ?? undefined;
  return recordScope(run.env.world, { table: run.rec.table, number: run.rec.number, fields }, run.env.actorRef, { inputs, steps, variables });
}

function setView(run: Execution, step: Step, status: StepStatus, error: string | null = null, top = true): void {
  if (!top) return;
  const existing = run.views.find((v) => v.id === step.id);
  if (existing) Object.assign(existing, { status, error });
  else run.views.push({ id: step.id, name: step.name, status, error, ...(run.test ? { simulated: true } : {}) });
}

async function currentRecord(run: Execution): Promise<RecordObj> {
  const fresh = await findRecord(run.env.tx, run.rec.number);
  if (fresh) {
    run.rec = fresh;
    run.env.world.records.set(fresh.number, fresh);
  }
  return run.rec;
}

async function moveItem(run: Execution, to: string): Promise<void> {
  const rec = await currentRecord(run);
  if (rec.table !== "request_item" || rec.fields.state === to) return;
  await save(run.env, { table: "request_item", number: rec.number, submitted: {}, to, system: true });
  await currentRecord(run);
}

async function ensureFulfilling(run: Execution): Promise<void> {
  const rec = await currentRecord(run);
  if (rec.table === "request_item" && (rec.fields.state === "submitted" || rec.fields.state === "approved")) await moveItem(run, "fulfilling");
}

async function runSteps(run: Execution, steps: Step[], prefix: string, inputs: Record<string, Value>, top: boolean): Promise<"continue" | "end"> {
  for (const step of steps) {
    const key = `${prefix}${step.id}`;
    if (run.state.done[key]) {
      setView(run, step, "done", null, top);
      if (step.type === "end") return "end";
      continue;
    }
    setView(run, step, "running", null, top);
    try {
      const outcome = await runStep(run, step, key, inputs, top);
      if (outcome === "end") return "end";
    } catch (error) {
      if (error instanceof Suspend) {
        setView(run, step, "waiting", null, top);
        throw error;
      }
      const message = error instanceof ApiError ? error.message : error instanceof StepFailure ? error.message : String(error);
      if (step.on_error && step.on_error.length > 0) {
        await runSteps(run, step.on_error, `${key}!`, inputs, false);
        run.state.done[key] = {};
        setView(run, step, "handled", null, top);
        continue;
      }
      setView(run, step, "failed", message, top);
      run.state.failed = { key, message };
      throw new StepFailure(message);
    }
  }
  return "continue";
}

async function runStep(run: Execution, step: Step, key: string, inputs: Record<string, Value>, top: boolean): Promise<"continue" | "end"> {
  const mark = (outputs: Record<string, Value> = {}): void => {
    run.state.done[key] = outputs;
    setView(run, step, "done", null, top);
  };
  switch (step.type) {
    case "trigger":
      mark();
      return "continue";
    case "end":
      mark();
      return "end";
    case "if": {
      await currentRecord(run);
      const taken = conditionHolds(step.condition ?? "false", scopeFor(run, inputs));
      const outcome = await runSteps(run, (taken ? step.then : step.else) ?? [], `${key}.${taken ? "then" : "else"}/`, inputs, false);
      mark({ branch: taken ? "then" : "else" });
      return outcome;
    }
    case "loop": {
      await currentRecord(run);
      const list = step.over ? evaluate(compile(step.over), scopeFor(run, inputs)) : null;
      const items = Array.isArray(list) ? list : [];
      let iteration = 0;
      for (;;) {
        if (step.over ? iteration >= items.length : false) break;
        if (!step.over && step.until && conditionHolds(step.until, scopeFor(run, inputs))) break;
        if (iteration >= settings.WORKFLOW_LOOP_LIMIT) throw new StepFailure(`Loop "${step.name}" stopped after ${settings.WORKFLOW_LOOP_LIMIT} iterations.`);
        const outcome = await runSteps(run, step.body ?? [], `${key}[${iteration}]/`, inputs, false);
        iteration++;
        if (outcome === "end") return "end";
        if (step.over && step.until && conditionHolds(step.until, scopeFor(run, inputs))) break;
        if (!step.over && !step.until) break;
      }
      mark({ iterations: iteration });
      return "continue";
    }
    case "wait": {
      if (run.test) {
        mark();
        return "continue";
      }
      const started = run.state.done[`${key}?`]?.started;
      const begun = typeof started === "number" ? started : now();
      run.state.done[`${key}?`] = { started: begun };
      const until = begun + (step.units ?? 1) * settings.WAIT_STEP_UNIT_SECONDS * 1000;
      if (now() < until) {
        run.wakeAt = run.wakeAt === null ? until : Math.min(run.wakeAt, until);
        throw new Suspend();
      }
      mark();
      return "continue";
    }
    case "set_fields": {
      if (run.test) {
        mark();
        return "continue";
      }
      await ensureFulfilling(run);
      const scope = scopeFor(run, inputs);
      for (const [field, expression] of Object.entries(step.fields ?? {})) {
        const value = evaluate(compile(expression), scope);
        const rec = await currentRecord(run);
        if (field === "state") await moveItemOrRecord(run, rec, String(value));
        else await save(run.env, { table: rec.table, number: rec.number, submitted: { [field]: { value } }, system: true });
      }
      mark();
      return "continue";
    }
    case "notify": {
      if (!run.test) {
        const users = step.to?.users ?? [];
        const roleRows = step.to?.roles?.length ? await run.env.tx.query("SELECT username FROM users WHERE roles && $1", [step.to.roles]) : [];
        await deliver(run.env.tx, "notify", [...users, ...roleRows.map((r) => r.username as string)], step.text ?? "", run.rec.number);
      }
      mark();
      return "continue";
    }
    case "create_task": {
      if (run.test) {
        mark();
        return "continue";
      }
      let task = run.state.done[`${key}?`]?.task;
      if (typeof task !== "string") {
        await ensureFulfilling(run);
        const created = await save(run.env, {
          table: "task",
          number: null,
          submitted: { short_description: { value: step.short_description ?? step.name }, assignment_group: { value: step.group ?? null }, parent: { value: run.rec.number } },
          system: true,
        });
        task = created.number;
        run.state.done[`${key}?`] = { task };
      }
      if (step.wait === false) {
        mark({ task });
        return "continue";
      }
      const taskRec = await findRecord(run.env.tx, task);
      if (taskRec && (taskRec.fields.state === "done" || taskRec.fields.state === "cancelled")) {
        mark({ task });
        return "continue";
      }
      run.state.waitingTask = task;
      throw new Suspend();
    }
    case "approval": {
      if (run.test) {
        mark();
        return "continue";
      }
      const rec = await currentRecord(run);
      let approvalId = run.state.done[`${key}?`]?.approval;
      if (typeof approvalId !== "number") {
        const approvers = await approversFor(run, step);
        if (approvers.length === 0) throw new StepFailure(`No active approver for "${step.name}".`);
        const rows = await run.env.tx.query("INSERT INTO item_approvals (request_item, run_id, step_id, approvers, rule, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [rec.number, run.runId, step.id, approvers, step.rule ?? "any", nowIso()]);
        approvalId = rows[0]!.id as number;
        run.state.done[`${key}?`] = { approval: approvalId };
        await moveItem(run, "awaiting_approval");
        const requestedFor = run.env.world.displayName(String(rec.fields.requested_for ?? rec.createdBy ?? ""));
        const itemName = String(rec.fields.short_description ?? "");
        await deliver(run.env.tx, "approval_requested", approvers, `Approve ${rec.number}: ${itemName} for ${requestedFor}.`, rec.number);
        run.env.tx.after.push(() => {
          for (const user of approvers) publishTo(user, "approvals", "changed", {});
        });
      }
      const status = (await run.env.tx.query("SELECT status FROM item_approvals WHERE id = $1", [approvalId]))[0]?.status;
      if (status === "open") {
        run.state.waitingApproval = approvalId;
        throw new Suspend();
      }
      if (status === "rejected") {
        await moveItem(run, "rejected");
        mark({ approval: approvalId });
        return "end";
      }
      await moveItem(run, "approved");
      mark({ approval: approvalId });
      return "continue";
    }
    case "subflow": {
      const target = (await configList<WorkflowContent>("workflow", "live", run.env.tx)).find((w) => w.name === step.flow);
      const latest = target ? await latestVersion(run.env.tx, target.id) : null;
      if (!target || !latest) throw new StepFailure(`Subflow "${String(step.flow)}" has no published version.`);
      const scope = scopeFor(run, inputs);
      const given: Record<string, Value> = {};
      for (const [name, expression] of Object.entries(step.inputs ?? {})) given[name] = evaluate(compile(expression), scope);
      const outcome = await runSteps(run, latest.steps, `${key}/`, given, false);
      const outputs: Record<string, Value> = {};
      for (const out of target.content.outputs) outputs[out.name] = evaluate(compile(out.expr), scopeFor(run, given));
      mark(outputs);
      return outcome === "end" ? "continue" : "continue";
    }
  }
}

async function moveItemOrRecord(run: Execution, rec: RecordObj, to: string): Promise<void> {
  if (rec.fields.state === to) return;
  await save(run.env, { table: rec.table, number: rec.number, submitted: {}, to, system: true });
  await currentRecord(run);
}

async function approversFor(run: Execution, step: Step): Promise<string[]> {
  if (step.approvers?.kind === "user" && step.approvers.user) {
    const person = run.env.world.people.get(step.approvers.user);
    return person?.active ? [person.username] : [];
  }
  const rec = run.rec;
  const subject = typeof rec.fields.requested_for === "string" ? rec.fields.requested_for : typeof rec.fields.caller === "string" ? rec.fields.caller : (rec.createdBy ?? "");
  const department = run.env.world.people.get(subject)?.department;
  return [...run.env.world.people.values()].filter((p) => p.hasLogin && p.active && p.roles.includes("approver") && p.department === department).map((p) => p.username);
}

async function execute(env: Env, runRow: Record<string, unknown>, steps: Step[]): Promise<void> {
  const state = runRow.state as RunState;
  const rec = (await findRecord(env.tx, runRow.record as string)) ?? null;
  if (!rec) return;
  const run: Execution = { env, runId: runRow.id as number, rec, state, views: runRow.steps as RunStepView[], test: runRow.test as boolean, wakeAt: null, version: runRow.version as number };
  state.failed = null;
  state.waitingTask = null;
  state.waitingApproval = null;
  let status = "done";
  try {
    await runSteps(run, steps, "", state.inputs, true);
  } catch (error) {
    if (error instanceof Suspend) status = "waiting";
    else if (error instanceof StepFailure) status = "failed";
    else throw error;
  }
  await env.tx.query("UPDATE runs SET status = $2, steps = $3, state = $4, wake_at = $5 WHERE id = $1", [run.runId, status, JSON.stringify(run.views), JSON.stringify(state), run.wakeAt ? new Date(run.wakeAt).toISOString() : null]);
  env.tx.after.push(() => publish(`run:${run.runId}`, "changed", {}));
}

async function startRun(env: Env, workflow: ConfigRow<WorkflowContent>, version: number, steps: Step[], record: string, test: boolean): Promise<number> {
  const initial: RunState = { done: {}, failed: null, waitingTask: null, waitingApproval: null, inputs: {} };
  const rows = await env.tx.query("INSERT INTO runs (workflow_id, workflow_name, version, record, status, steps, state, test) VALUES ($1, $2, $3, $4, 'running', '[]', $5, $6) RETURNING *", [workflow.id, workflow.name, version, record, JSON.stringify(initial), test]);
  await execute(env, rows[0]!, steps);
  return rows[0]!.id as number;
}

export async function testRun(env: Env, id: number, record: string): Promise<number> {
  const row = await workflowRowById(env.tx, id);
  if (!row) return notFound();
  validateDraft(row.content, row.content.draft);
  const rec = await findRecord(env.tx, record);
  if (!rec) validation(`Unknown record "${record}".`, { record: "Choose an existing record." });
  return startRun(env, row, 0, row.content.draft, record, true);
}

async function resume(env: Env, runId: number): Promise<void> {
  const rows = await env.tx.query("SELECT * FROM runs WHERE id = $1 FOR UPDATE", [runId]);
  const row = rows[0];
  if (!row || row.status === "done") return;
  const steps = row.test ? (await workflowRowById(env.tx, row.workflow_id as number))?.content.draft : (await versionsOf(env.tx, row.workflow_id as number, true)).find((v) => v.version === row.version)?.steps;
  if (steps) await execute(env, row, steps);
}

export async function retryRun(env: Env, id: number): Promise<void> {
  const rows = await env.tx.query("SELECT * FROM runs WHERE id = $1 FOR UPDATE", [id]);
  const row = rows[0];
  if (!row) return notFound();
  if (row.status !== "failed") fail(409, "nothing_to_retry", "This run has no failed step to retry.");
  await resume(env, id);
}

/** Starts the published flows whose trigger matches a record event, each in its own transaction after the save committed. */
export async function triggerWorkflows(rec: RecordObj, event: "record_created" | "record_updated"): Promise<void> {
  try {
    await transaction(async (tx) => {
      const env = await Env.create(tx, SYSTEM);
      const flows = await configList<WorkflowContent>("workflow", "live", tx);
      for (const flow of flows) {
        if (flow.content.kind !== "flow") continue;
        const latest = await latestVersion(tx, flow.id);
        const trigger = latest?.steps.find((s) => s.type === "trigger");
        if (!latest || !trigger || trigger.on !== event || trigger.table !== rec.table) continue;
        const fresh = (await findRecord(tx, rec.number)) ?? rec;
        if (trigger.condition && !conditionHolds(trigger.condition, recordScope(env.world, fresh, env.actorRef))) continue;
        await startRun(env, flow, latest.version, latest.steps, rec.number, false);
      }
    });
  } catch (error) {
    process.stderr.write(`workflow trigger failed: ${String(error)}\n`);
  }
}

/** Starts the flow named by a catalog item for a freshly ordered request item. */
export async function startItemFlow(env: Env, item: { id: string; workflow: string }, record: string): Promise<void> {
  const flow = await configGet<WorkflowContent>("workflow", item.workflow, "live", env.tx);
  const latest = flow ? await latestVersion(env.tx, flow.id) : null;
  if (!flow || !latest) return;
  await startRun(env, flow, latest.version, latest.steps, record, false);
}

/** Wakes waits whose time has come and resumes runs waiting on a finished task or a decided approval. */
export async function dueWakeups(tx: Tx, atMs: number): Promise<Array<{ at: number; run: number }>> {
  const rows = await tx.query("SELECT id, wake_at FROM runs WHERE status = 'waiting' AND wake_at IS NOT NULL AND wake_at <= $1 ORDER BY wake_at", [new Date(atMs).toISOString()]);
  return rows.map((r) => ({ at: Date.parse(r.wake_at as string), run: r.id as number }));
}

export async function nextWakeup(tx: Tx): Promise<number | null> {
  const rows = await tx.query("SELECT min(wake_at) AS at FROM runs WHERE status = 'waiting' AND wake_at IS NOT NULL");
  const at = rows[0]?.at as string | null | undefined;
  return at ? Date.parse(at) : null;
}

export async function resumeRun(env: Env, id: number): Promise<void> {
  await resume(env, id);
}

export async function afterWorkItemMove(env: Env, rec: RecordObj, previous: RecordObj | null): Promise<void> {
  const state = String(rec.fields.state);
  const before = previous ? String(previous.fields.state) : null;
  if (state === before) return;
  if (rec.table === "task" && (state === "done" || state === "cancelled")) {
    const rows = await env.tx.query("SELECT id FROM runs WHERE status = 'waiting' AND state->>'waitingTask' = $1", [rec.number]);
    for (const row of rows) await resume(env, row.id as number);
  }
  if (rec.table === "request_item" && typeof rec.fields.request === "string") {
    const items = (await env.tx.query("SELECT fields->>'state' AS state FROM records WHERE table_name = 'request_item' AND fields->>'request' = $1", [rec.fields.request])).map((r) => r.state as string);
    if (items.every((s) => ["delivered", "closed", "rejected", "cancelled"].includes(s))) await env.tx.query("UPDATE requests SET closed = true WHERE number = $1", [rec.fields.request]);
  }
}

export async function decideItemApproval(env: Env, id: number, decision: "approve" | "reject"): Promise<void> {
  const rows = await env.tx.query("SELECT * FROM item_approvals WHERE id = $1 FOR UPDATE", [id]);
  const row = rows[0];
  if (!row) return notFound();
  const me = env.user.username;
  const decisions = row.decisions as { username: string; decision: string }[];
  if (!(row.approvers as string[]).includes(me)) return notFound();
  if (row.status !== "open" || decisions.some((d) => d.username === me)) fail(409, "already_decided", "This approval has already been decided.");
  const next = [...decisions, { username: me, decision }];
  const approvers = row.approvers as string[];
  const approved = row.rule === "all" ? next.filter((d) => d.decision === "approve").length === approvers.length : next.some((d) => d.decision === "approve");
  const rejected = row.rule === "all" ? next.some((d) => d.decision === "reject") : next.filter((d) => d.decision === "reject").length === approvers.length;
  const status = approved ? "approved" : rejected ? "rejected" : "open";
  await env.tx.query("UPDATE item_approvals SET decisions = $2, status = $3 WHERE id = $1", [id, JSON.stringify(next), status]);
  if (status !== "open" && row.run_id) await resume(env, row.run_id as number);
  env.tx.after.push(() => {
    for (const user of approvers) publishTo(user, "approvals", "changed", {});
    publish(`record:${String(row.request_item)}`, "changed", { number: row.request_item });
  });
}

