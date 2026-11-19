// The run engine. One place decides run and step status transitions, the
// retry rule, the step limit and version binding. Each instance owns the
// runs it created and fires only its own timers.

import { CONFIG } from "./config.js";
import { db } from "./db.js";
import type { Db } from "./db.js";
import { runsRepo, runStepsRepo, tablesRepo, timersRepo, automations, stepsRepo, edgesRepo, versionsRepo } from "./repo.js";
import type { RunRow, RunStepRow } from "./repo.js";
import type { AutomationContent, StepNode, TriggerNode } from "./graph.js";
import { edgesFrom, partOf, stepMap, executionOrder } from "./graph.js";
import { resolveField, stringify } from "./template.js";
import type { TplCtx } from "./template.js";
import { compare } from "./conditions.js";
import type { Operator } from "./conditions.js";
import { sendMail } from "./mailer.js";
import { wsOffset, realNowMs } from "./clock.js";
import { pushRunListItem, pushAnnouncement, pushTableEventMsg, pushDrainCount } from "./push.js";
import { Errors } from "./errors.js";
import { parseDecimal } from "./text.js";

export const PORT = CONFIG.port;

// ---- run and step status transitions, decided once ----
export const RUN_TRANSITIONS: Record<string, string[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting", "succeeded", "failed", "cancelled"],
  waiting: ["running", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};
export const STEP_TRANSITIONS: Record<string, string[]> = {
  pending: ["running", "skipped"],
  running: ["succeeded", "failed", "retrying", "waiting", "cancelled"],
  waiting: ["succeeded", "running", "cancelled"],
  retrying: ["running", "cancelled"],
  succeeded: ["running"],
  failed: ["running"],
  skipped: [],
  cancelled: [],
};

export function canRunTransition(from: string, to: string): boolean {
  return (RUN_TRANSITIONS[from] ?? []).includes(to);
}
export function canStepTransition(from: string, to: string): boolean {
  return (STEP_TRANSITIONS[from] ?? []).includes(to);
}

export async function draftContent(d: Db, aid: string): Promise<AutomationContent> {
  const trigger = await stepsRepo.triggerOf(d, aid, null);
  const steps = await stepsRepo.listDraft(d, aid);
  const edges = await edgesRepo.list(d, aid, null);
  return { trigger, steps, edges };
}

export async function versionContent(d: Db, aid: string, version: number): Promise<AutomationContent> {
  const v = await versionsRepo.get(d, aid, version);
  if (!v) throw Errors.notFound();
  return v.content;
}

// ---------------------------------------------------------------- start run
export async function startRun(opts: {
  wsId: string; aid: string; version: number | null; test: boolean; triggerOutput: unknown;
  replayOf?: string | null; reused?: Map<string, { status: string; output: unknown }> | null;
}): Promise<RunRow> {
  const a = await automations.byId(db, opts.aid);
  if (!a) throw Errors.notFound();
  const number = await runsRepo.nextNumber(db, opts.aid);
  const offset = await wsOffset(db, opts.wsId);
  const now = new Date(realNowMs() + offset * 1000);
  const content = opts.version === null ? await draftContent(db, opts.aid) : await versionContent(db, opts.aid, opts.version);
  const run = await runsRepo.create(db, {
    workspace_id: opts.wsId, automation_id: opts.aid, number, status: "queued", test: opts.test,
    version: opts.version, replay_of: opts.replayOf ?? null, owner_port: PORT,
    started_at: now, finished_at: null, trigger_output: opts.triggerOutput, message: null,
  });
  const m = stepMap(content);
  const order = executionOrder(content);
  const recs = order.map((id, i) => {
    const node = m.get(id) as StepNode | TriggerNode;
    return { step_id: id, kind: node.kind, name: node.name, col: node.col, row: node.row, ord: i };
  });
  await runStepsRepo.createAll(db, run.id, recs);
  await runStepsRepo.update(db, run.id, "trigger", {
    status: "succeeded", input: {}, output: opts.triggerOutput ?? {},
    attempts: 1, started_at: now, finished_at: now,
  });
  // replay: mark steps before the chosen one as reused with recorded output
  if (opts.reused) {
    for (const [sid, rec] of opts.reused) {
      await runStepsRepo.update(db, run.id, sid, {
        status: rec.status === "skipped" ? "skipped" : rec.status,
        reused: true, output: rec.output, attempts: 1,
        log: [`Reused output from run #${number - 1}`],
      });
    }
  }
  await setRunStatus(run, "running");
  await pushRunListItem(db, opts.wsId, run.id);
  await pushAnnouncement(opts.wsId, `Run #${number} started`);
  const st = await buildState(run.id);
  await walk(st);
  const fresh = await runsRepo.byId(db, run.id);
  return fresh ?? run;
}

interface LoopFrame { loopId: string; items: unknown[]; index: number } // index counts from 1

interface ExecState {
  run: RunRow;
  paused: boolean;
  resumeFromDue: Date | null;
  content: AutomationContent;
  nodes: Map<string, StepNode | TriggerNode>;
  recs: Map<string, RunStepRow>;
  outputs: Record<string, unknown>;
  ctx: TplCtx;
  offset: number;
  executions: number;
  loopStack: LoopFrame[];
  reused: Set<string>;
  portTaken: Map<string, string>; // step id -> port taken (for branch)
}

async function buildState(runId: string): Promise<ExecState> {
  const run = (await runsRepo.byId(db, runId))!;
  const content = run.version === null ? await draftContent(db, run.automation_id) : await versionContent(db, run.automation_id, run.version!);
  const rows = await runStepsRepo.list(db, runId);
  const recs = new Map(rows.map((r) => [r.step_id, r]));
  const outputs: Record<string, unknown> = {};
  const reused = new Set<string>();
  let executions = 0;
  for (const r of rows) {
    if (r.step_id === "trigger") { outputs.trigger = r.output; continue; }
    if (r.reused) { outputs[r.step_id] = r.output; reused.add(r.step_id); continue; }
    if (r.status === "succeeded" || r.status === "failed") { outputs[r.step_id] = r.output; executions++; }
    if (r.status === "waiting" || r.status === "retrying") executions++;
  }
  const ctx: TplCtx = {
    trigger: (run.trigger_output ?? {}) as Record<string, unknown>,
    steps: outputs,
    loop: null,
    run: { id: run.id },
    log: [],
  };
  return {
    run, content, nodes: stepMap(content), recs, outputs, ctx,
    offset: await wsOffset(db, run.workspace_id),
    executions, loopStack: [], reused, portTaken: new Map(), paused: false, resumeFromDue: null,
  };
}

function wsNow(offset: number): Date {
  return new Date(realNowMs() + offset * 1000);
}

async function setRunStatus(run: RunRow, to: string, finishedAt: Date | null = null, message: string | null = null): Promise<void> {
  await runsRepo.setStatus(db, run.id, to, finishedAt, message);
  run.status = to;
  if (message !== null) run.message = message;
}

// The depth-first walk. Returns when the run is waiting/finished.
async function walk(st: ExecState): Promise<void> {
  const run = st.run;
  if (["succeeded", "failed", "cancelled"].includes(run.status)) return;
  await setRunStatus(run, "running");
  await visitPort(st, "trigger", "out");
  if (["succeeded", "failed", "cancelled", "waiting"].includes(run.status) || st.paused) return;
  // walk complete: everything that could run has run
  await finish(st, "succeeded", null);
}

// Visits every edge of a port in data-order, depth first.
async function visitPort(st: ExecState, fromId: string, port: string): Promise<void> {
  if (isStopped(st)) return;
  const edges = edgesFrom(st.content.edges, fromId, port);
  for (const e of edges) {
    if (isStopped(st)) return;
    await visitStep(st, e.to);
    if (isStopped(st)) return;
  }
}

function isStopped(st: ExecState): boolean {
  return ["succeeded", "failed", "cancelled", "waiting"].includes(st.run.status);
}

async function visitStep(st: ExecState, stepId: string): Promise<void> {
  if (isStopped(st)) return;
  const rec = st.recs.get(stepId);
  const node = st.nodes.get(stepId);
  if (!rec || !node) return;
  if (rec.reused) {
    // A reused step's recorded output feeds the walk; branch port recorded.
    if (node.kind === "branch") recordPortTaken(st, stepId, rec.output);
    return;
  }
  if (rec.status === "skipped" || rec.status === "cancelled") return;

  // step limit: a step execution is one step starting
  if (st.executions >= CONFIG.stepLimit) {
    const msg = `Step limit of ${CONFIG.stepLimit} reached`;
    if (rec.status === "pending") await saveStep(st, stepId, { status: "skipped" });
    await skipAllPending(st);
    const loop = enclosingLoop(st, stepId);
    if (loop) {
      const lrec = st.recs.get(loop);
      if (lrec && lrec.status !== "pending") await saveStep(st, loop, { status: "failed" });
      else if (lrec) await saveStep(st, loop, { status: "skipped" });
    }
    await finish(st, "failed", msg, stepId);
    return;
  }

  await saveStep(st, stepId, { status: "running", started_at: wsNow(st.offset) });
  st.executions++;
  if (node.kind === "loop") {
    await runLoop(st, stepId, node);
    return;
  }
  const outcome = await runWithRetries(st, stepId, node);
  if (outcome.kind === "waiting") return;

  if (outcome.kind === "failed") {
    const errorEdge = st.content.edges.find((e) => e.from === stepId && e.port === "error");
    if (errorEdge) {
      await skipPendingInPart(st, stepId, "out");
      await visitPort(st, stepId, "error");
      if (!isStopped(st) && !st.paused) await finish(st, "succeeded", null);
      return;
    }
    const total = CONFIG.retryCount + 1;
    const msg = `Step ${stepId} failed after ${total} attempts: ${outcome.message}`;
    await skipAllPending(st);
    await finish(st, "failed", msg, stepId);
    return;
  }

  // succeeded
  const out = outcome.output as Record<string, unknown>;
  st.outputs[stepId] = out;
  if (node.kind === "filter") {
    if (out.passed === false) {
      await skipAllPending(st);
      await finish(st, "succeeded", null);
      return;
    }
    await visitPort(st, stepId, "out");
    return;
  }
  if (node.kind === "branch") {
    const port = out.result === true ? "true" : "false";
    recordPortTaken(st, stepId, out);
    const other = port === "true" ? "false" : "true";
    await visitPort(st, stepId, port);
    if (!isStopped(st)) await skipPendingInPart(st, stepId, other);
    return;
  }
  if (node.kind === "loop") {
    await runLoop(st, stepId, node);
    return;
  }
  await visitPort(st, stepId, "out");
}

function recordPortTaken(st: ExecState, stepId: string, out: unknown): void {
  const o = out as { result?: boolean } | null;
  st.portTaken.set(stepId, o?.result === true ? "true" : "false");
}

async function runLoop(st: ExecState, loopId: string, node: StepNode): Promise<void> {
  const f = node.fields as Record<string, unknown>;
  const source = String(f.source ?? "list");
  let items: unknown[];
  if (source === "table") {
    const tableId = String(f.table ?? "");
    const t = await tablesRepo.byId(db, tableId);
    if (!t) {
      await failStepNoRetry(st, loopId, `Table not found: ${tableId}`);
      return;
    }
    const rows = await tablesRepo.rows(db, tableId);
    items = rows.map((r) => ({ ...r.values, _row_id: r.row_id }));
  } else {
    const r = resolveField(String(f.list ?? ""), st.ctx);
    if (!Array.isArray(r.value)) {
      await failStepNoRetry(st, loopId, "Loop source is not a list");
      return;
    }
    items = r.value;
  }
  await saveStep(st, loopId, { output: { count: items.length } });
  st.outputs[loopId] = { count: items.length };
  const frame: LoopFrame = { loopId, items, index: 0 };
  for (let i = 0; i < items.length; i++) {
    if (isStopped(st)) return;
    frame.index = i + 1;
    st.loopStack.push(frame);
    st.ctx.loop = { index: frame.index, item: items[i] };
    await visitPort(st, loopId, "each");
    st.loopStack.pop();
    st.ctx.loop = st.loopStack.length > 0 ? { index: st.loopStack[st.loopStack.length - 1].index, item: st.loopStack[st.loopStack.length - 1].items[st.loopStack[st.loopStack.length - 1].index - 1] } : null;
    if (isStopped(st)) return;
  }
  await saveStep(st, loopId, { status: "succeeded", finished_at: wsNow(st.offset), output: { count: items.length }, log: await currentLog(st, loopId) });
  await visitPort(st, loopId, "done");
}

async function currentLog(st: ExecState, stepId: string): Promise<string[]> {
  const rec = await runStepsRepo.byId(db, st.run.id, stepId);
  return rec?.log ?? [];
}

async function failStepNoRetry(st: ExecState, stepId: string, message: string): Promise<void> {
  const total = CONFIG.retryCount + 1;
  const log = [...(await currentLog(st, stepId))];
  for (let a = 1; a <= total; a++) log.push(`Attempt ${a} of ${total} failed: ${message}`);
  await saveStep(st, stepId, { status: "failed", log, attempts: total, finished_at: wsNow(st.offset) });
  st.recs.get(stepId)!.status = "failed";
  const errorEdge = st.content.edges.find((e) => e.from === stepId && e.port === "error");
  if (errorEdge) {
    await skipPendingInPart(st, stepId, "out");
    await visitPort(st, stepId, "error");
    if (!isStopped(st)) await finish(st, "succeeded", null);
    return;
  }
  await skipAllPending(st);
  await finish(st, "failed", `Step ${stepId} failed after ${total} attempts: ${message}`, stepId);
}

type AttemptOutcome =
  | { kind: "ok"; output: unknown }
  | { kind: "fail"; message: string }
  | { kind: "wait"; dueAt: Date; seconds: number };

// Runs one step with the retry rule: RETRY_COUNT retries, RETRY_DELAY_SECONDS
// apart on the workspace clock.
async function runWithRetries(st: ExecState, stepId: string, node: StepNode, resumeFrom = 0): Promise<{ kind: "succeeded"; output: unknown } | { kind: "failed"; message: string } | { kind: "waiting" }> {
  const total = CONFIG.retryCount + 1;
  let attempt = resumeFrom;
  const rec = st.recs.get(stepId)!;
  const log: string[] = [...(rec.log ?? [])];
  while (true) {
    attempt++;
    st.ctx.log = log;
    const r = await attemptStep(st, stepId, node, log);
    if (r.kind === "wait") {
      // wait step: record waiting, set timer, run stays waiting
      const dueAt = r.dueAt;
      await saveStep(st, stepId, { status: "waiting", due_at: dueAt, output: { waited_seconds: r.seconds } });
      await timersRepo.insert(db, {
        workspace_id: st.run.workspace_id, run_id: st.run.id, step_id: stepId,
        kind: "wait", due_at: dueAt, payload: {}, owner_port: PORT,
      });
      await setRunStatus(st.run, "waiting");
      await pushRunListItem(db, st.run.workspace_id, st.run.id);
      await pushAnnouncement(st.run.workspace_id, `Run #${st.run.number} is waiting at ${rec.name}`);
      return { kind: "waiting" };
    }
    if (r.kind === "ok") {
      log.push(`Attempt ${attempt} of ${total} succeeded`);
      await saveStep(st, stepId, { status: "succeeded", output: r.output, log: [...log], attempts: attempt, finished_at: wsNow(st.offset), input: node.fields });
      st.recs.get(stepId)!.status = "succeeded";
      await pushRunListItem(db, st.run.workspace_id, st.run.id);
      return { kind: "succeeded", output: r.output };
    }
    log.push(`Attempt ${attempt} of ${total} failed: ${r.message}`);
    if (attempt < total) {
      const anchor = st.resumeFromDue ?? wsNow(st.offset);
      const retryAt = new Date(new Date(anchor).getTime() + CONFIG.retryDelaySeconds * 1000);
      await saveStep(st, stepId, { status: "retrying", log: [...log], attempts: attempt, retry_at: retryAt, input: node.fields });
      st.recs.get(stepId)!.status = "retrying";
      await timersRepo.insert(db, {
        workspace_id: st.run.workspace_id, run_id: st.run.id, step_id: stepId,
        kind: "retry", due_at: retryAt, payload: {}, owner_port: PORT,
      });
      await pushRunListItem(db, st.run.workspace_id, st.run.id);
      st.paused = true;
      return { kind: "waiting" };
    }
    await saveStep(st, stepId, { status: "failed", log: [...log], attempts: attempt, finished_at: wsNow(st.offset), input: node.fields, output: null });
    st.recs.get(stepId)!.status = "failed";
    await pushRunListItem(db, st.run.workspace_id, st.run.id);
    return { kind: "failed", message: r.message };
  }
}

async function attemptStep(st: ExecState, stepId: string, node: StepNode, log: string[]): Promise<AttemptOutcome> {
  const f = node.fields as Record<string, unknown>;
  const ctx = st.ctx;
  const now = wsNow(st.offset);
  switch (node.kind) {
    case "set": {
      const values = (f.values ?? {}) as Record<string, string>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(values)) out[k] = resolveField(String(values[k] ?? ""), ctx).value;
      return { kind: "ok", output: out };
    }
    case "filter":
    case "branch": {
      const left = stringify(resolveField(String(f.left ?? ""), ctx).value);
      const right = stringify(resolveField(String(f.right ?? ""), ctx).value);
      const op = String(f.operator ?? "equals") as Operator;
      const res = compare(left, right, op);
      return { kind: "ok", output: node.kind === "filter" ? { passed: res } : { result: res } };
    }
    case "wait": {
      const seconds = Number(f.seconds ?? 0);
      return { kind: "wait", dueAt: new Date(now.getTime() + seconds * 1000), seconds };
    }
    case "send_email": {
      const to = stringify(resolveField(String(f.to ?? ""), ctx).value);
      const subject = stringify(resolveField(String(f.subject ?? ""), ctx).value);
      const body = stringify(resolveField(String(f.body ?? ""), ctx).value);
      const member = await findMemberEmail(st.run.workspace_id, to);
      if (!member) return { kind: "fail", message: `Recipient is not a workspace member: ${to}` };
      const res = await sendMail({ to: member, subject, body, headers: { "X-Switchyard-Run": st.run.id } });
      if (!res.accepted) return { kind: "fail", message: "Mail server did not accept the message" };
      return { kind: "ok", output: { to, subject } };
    }
    case "add_row":
    case "update_row": {
      return await attemptRow(st, node, f, ctx);
    }
    case "call_webhook": {
      const url = stringify(resolveField(String(f.url ?? ""), ctx).value);
      const body = (f.body ?? {}) as Record<string, string>;
      const payload: Record<string, unknown> = {};
      for (const k of Object.keys(body)) payload[k] = resolveField(String(body[k]), ctx).value;
      try {
        const abs = url.startsWith("/") ? CONFIG.publicUrl + url : url;
        const res = await fetch(abs, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        const text = await res.text();
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* keep text */ }
        if (res.status < 200 || res.status >= 300) return { kind: "fail", message: `Webhook answered ${res.status}` };
        return { kind: "ok", output: { status: res.status, body: parsed } };
      } catch {
        return { kind: "fail", message: "Webhook could not be reached" };
      }
    }
    default:
      return { kind: "fail", message: "Unknown step kind" };
  }
}

async function attemptRow(st: ExecState, node: StepNode, f: Record<string, unknown>, ctx: TplCtx): Promise<AttemptOutcome> {
  const tableId = String(f.table ?? "");
  const t = await tablesRepo.byId(db, tableId);
  if (!t) return { kind: "fail", message: `Table not found: ${tableId}` };
  const values = (f.values ?? {}) as Record<string, string>;
  const out: Record<string, unknown> = {};
  for (const col of t.columns) {
    if (values[col.name] === undefined) continue;
    const r = resolveField(String(values[col.name]), ctx);
    if (col.type === "number") {
      const num = typeof r.value === "number" ? r.value : parseDecimal(stringify(r.value));
      if (num === null) return { kind: "fail", message: `Column ${col.name} must be a number` };
      out[col.name] = num;
    } else {
      out[col.name] = stringify(r.value);
    }
  }
  if (node.kind === "add_row") {
    const row = await tablesRepo.insertRow(db, tableId, out);
    pushTableEventMsg(st.run.workspace_id, tableId);
    return { kind: "ok", output: { ...row.values, _row_id: row.row_id } };
  }
  const rowId = stringify(resolveField(String(f.row_id ?? ""), ctx).value);
  const okUp = await tablesRepo.updateRow(db, tableId, rowId, out);
  if (!okUp) return { kind: "fail", message: `Row ${rowId} not found` };
  const rows = await tablesRepo.rows(db, tableId);
  const row = rows.find((x) => x.row_id === rowId);
  pushTableEventMsg(st.run.workspace_id, tableId);
  return { kind: "ok", output: { ...(row?.values ?? {}), _row_id: rowId } };
}

async function findMemberEmail(wsId: string, to: string): Promise<string | null> {
  const r = await db.query(
    "SELECT u.email FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND lower(u.email)=lower($2) LIMIT 1",
    [wsId, to.trim()]
  );
  return (r.rows[0]?.email as string) ?? null;
}

async function saveStep(st: ExecState, stepId: string, patch: Partial<RunStepRow>): Promise<void> {
  await runStepsRepo.update(db, st.run.id, stepId, patch);
  const rec = st.recs.get(stepId);
  if (rec) Object.assign(rec, patch);
}

async function skipAllPending(st: ExecState): Promise<void> {
  for (const [id, rec] of st.recs) {
    if (rec.status === "pending") {
      await saveStep(st, id, { status: "skipped" });
      rec.status = "skipped";
    }
  }
}

async function skipPendingInPart(st: ExecState, fromId: string, port: string): Promise<void> {
  for (const id of partOf(st.content, fromId, port)) {
    const rec = st.recs.get(id);
    if (rec && rec.status === "pending") {
      await saveStep(st, id, { status: "skipped" });
      rec.status = "skipped";
    }
  }
}

function enclosingLoop(st: ExecState, stepId: string): string | null {
  for (const s of st.content.steps) {
    if (s.kind === "loop" && partOf(st.content, s.id, "each").includes(stepId)) return s.id;
  }
  return null;
}

async function finish(st: ExecState, status: "succeeded" | "failed" | "cancelled", message: string | null, stepId?: string): Promise<void> {
  const at = wsNow(st.offset);
  await setRunStatus(st.run, status, at, message);
  await pushRunListItem(db, st.run.workspace_id, st.run.id);
  let sentence: string;
  if (status === "succeeded") sentence = `Run #${st.run.number} succeeded`;
  else if (status === "failed") {
    const rec = stepId ? st.recs.get(stepId) : undefined;
    const name = rec?.name ?? stepId ?? "";
    sentence = `Run #${st.run.number} failed at ${name}`;
  } else sentence = `Run #${st.run.number} was cancelled`;
  await pushAnnouncement(st.run.workspace_id, sentence);
  await pushDrainCount(db, st.run.workspace_id, st.run.automation_id);
}

// ---- cancel ----
export async function cancelRun(runId: string): Promise<void> {
  const run = (await runsRepo.byId(db, runId))!;
  const recs = await runStepsRepo.list(db, runId);
  for (const r of recs) {
    if (r.status === "waiting" || r.status === "retrying") {
      await runStepsRepo.update(db, runId, r.step_id, { status: "cancelled", finished_at: new Date() });
    } else if (r.status === "pending") {
      await runStepsRepo.update(db, runId, r.step_id, { status: "skipped" });
    }
  }
  await timersRepo.cancelRunTimers(db, runId);
  const st = await buildState(runId);
  await setRunStatus(run, "cancelled", new Date(Date.now() + st.offset * 1000), run.message);
  await pushRunListItem(db, run.workspace_id, runId);
  await pushAnnouncement(run.workspace_id, `Run #${run.number} was cancelled`);
  await pushDrainCount(db, run.workspace_id, run.automation_id);
}

// ---- timer firing (wait and retry) ----
export async function fireTimer(timerId: number): Promise<void> {
  const r = await db.query("SELECT * FROM timers WHERE id=$1", [timerId]);
  const t = r.rows[0] as { id: number; run_id: string; step_id: string; kind: string; due_at: Date } | undefined;
  if (!t) return;
  await timersRepo.markFired(db, timerId);
  const run = await runsRepo.byId(db, t.run_id);
  if (!run) return;
  if (["succeeded", "failed", "cancelled"].includes(run.status)) return;
  const rec = await runStepsRepo.byId(db, t.run_id, t.step_id);
  if (!rec) return;

  if (t.kind === "wait") {
    // A wait timer that fires while the step was cancelled leaves it alone.
    if (rec.status !== "waiting") return;
    const total = CONFIG.retryCount + 1;
    const log = [...rec.log, `Attempt ${rec.attempts || 1} of ${total} succeeded`];
    await runStepsRepo.update(db, t.run_id, t.step_id, {
      status: "succeeded", finished_at: new Date(), log, output: rec.output ?? { waited_seconds: null },
    });
    await setRunStatus(run, "running");
  } else if (t.kind === "retry") {
    if (rec.status !== "retrying") return;
    await runStepsRepo.update(db, t.run_id, t.step_id, { status: "running", retry_at: null });
    await setRunStatus(run, "running");
  }
  await pushRunListItem(db, run.workspace_id, run.id);
  const st = await buildState(t.run_id);
  // the next retry is due exactly one delay after the timer that just fired
  if (t.kind === "retry") st.resumeFromDue = t.due_at as Date;
  // resume the walk from the resumed step's outgoing port
  await resumeWalk(st, t.step_id, t.kind);
}

async function resumeWalk(st: ExecState, stepId: string, kind: string): Promise<void> {
  const node = st.nodes.get(stepId);
  const rec = st.recs.get(stepId);
  if (!node || !rec) return;
  await setRunStatus(st.run, "running");
  st.ctx.steps = st.outputs;

  if (kind === "retry") {
    // Continue the retry loop from the next attempt
    const outcome = await runWithRetries(st, stepId, node as StepNode, rec.attempts);
    if (outcome.kind === "waiting") return;
    await afterStepOutcome(st, stepId, node as StepNode, outcome);
    return;
  }
  // wait finished: continue downstream
  await afterSuccess(st, stepId, node as StepNode, rec.output);
}

async function afterStepOutcome(st: ExecState, stepId: string, node: StepNode, outcome: { kind: "succeeded"; output: unknown } | { kind: "failed"; message: string }): Promise<void> {
  if (outcome.kind === "failed") {
    const errorEdge = st.content.edges.find((e) => e.from === stepId && e.port === "error");
    if (errorEdge) {
      await skipPendingInPart(st, stepId, "out");
      await visitPort(st, stepId, "error");
      if (!isStopped(st) && !st.paused) await finish(st, "succeeded", null);
      return;
    }
    const total = CONFIG.retryCount + 1;
    await skipAllPending(st);
    await finish(st, "failed", `Step ${stepId} failed after ${total} attempts: ${outcome.message}`, stepId);
    return;
  }
  await afterSuccess(st, stepId, node, outcome.output);
}

async function afterSuccess(st: ExecState, stepId: string, node: StepNode, output: unknown): Promise<void> {
  st.outputs[stepId] = output;
  const out = output as Record<string, unknown>;
  if (node.kind === "filter") {
    if (out.passed === false) {
      await skipAllPending(st);
      await finish(st, "succeeded", null);
      return;
    }
    await visitPort(st, stepId, "out");
  } else if (node.kind === "branch") {
    const port = out.result === true ? "true" : "false";
    recordPortTaken(st, stepId, out);
    await visitPort(st, stepId, port);
    if (!isStopped(st)) await skipPendingInPart(st, stepId, port === "true" ? "false" : "true");
  } else {
    await visitPort(st, stepId, "out");
  }
  if (!isStopped(st) && !st.paused) await finish(st, "succeeded", null);
}
