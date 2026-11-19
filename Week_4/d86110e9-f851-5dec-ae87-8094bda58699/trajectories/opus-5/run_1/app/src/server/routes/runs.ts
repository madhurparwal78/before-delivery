import { query } from '../db';
import { ApiError, badRequest, messages, notFound } from '../errors';
import { loadAutomation, stepsInsideLoops } from '../automations';
import { cancelRun, createRun, reusePrefix } from '../engine/runs';
import { isRunFinished } from '../engine/rules';
import { listItem, loadRun, loadSteps, orderSteps, runDetail, type RunRecord } from '../engine/view';
import { liveVersion } from '../triggers';
import { isObject } from '../util';
import type { Ctx, Reply, Route } from '../http';
import type { RunStatus } from '../../shared/types';

const STATUSES: RunStatus[] = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'];

async function startRun(ctx: Ctx): Promise<Reply> {
  const automation = await loadAutomation(ctx.workspace.id, ctx.params.aid);
  if (automation === null) throw notFound();
  const test = ctx.body.test === true;
  if (ctx.body.input !== undefined && !isObject(ctx.body.input)) throw badRequest(messages.runInputObject);
  if (test) {
    const input = isObject(ctx.body.input) ? ctx.body.input : automation.draft.trigger.sample;
    const started = await createRun({
      workspaceId: ctx.workspace.id,
      automationId: automation.id,
      version: null,
      content: automation.draft,
      triggerOutput: input,
      test: true,
    });
    return { status: 201, json: started };
  }
  const live = await liveVersion(automation.id);
  if (live === null) throw new ApiError(409, messages.publishBeforeRunning);
  if (automation.trigger_kind !== 'manual') throw new ApiError(409, messages.manualOnly);
  const started = await createRun({
    workspaceId: ctx.workspace.id,
    automationId: automation.id,
    version: live.version,
    content: live.content,
    triggerOutput: isObject(ctx.body.input) ? ctx.body.input : {},
    test: false,
  });
  return { status: 201, json: started };
}

async function listRuns(ctx: Ctx): Promise<Reply> {
  const status = ctx.url.searchParams.get('status');
  const automationId = ctx.url.searchParams.get('automation');
  const includeTests = ctx.url.searchParams.get('test') === 'true';
  if (status !== null && status !== '' && !STATUSES.includes(status as RunStatus)) {
    throw badRequest(messages.unknownStatus(status));
  }
  if (automationId !== null && automationId !== '') {
    const automation = await loadAutomation(ctx.workspace.id, automationId);
    if (automation === null) throw notFound();
  }
  const rows = await query<RunRecord & { automation_name: string }>(
    `select r.*, a.name as automation_name from runs r join automations a on a.id = r.automation_id
       where r.workspace_id = $1
         and ($2::text is null or r.status = $2)
         and ($3::text is null or r.automation_id = $3)
         and ($4::boolean or r.test = false)
       order by r.started_at desc, r.number desc limit 100`,
    [
      ctx.workspace.id,
      status === null || status === '' ? null : status,
      automationId === null || automationId === '' ? null : automationId,
      includeTests,
    ],
  );
  return { status: 200, json: { runs: rows.map((row) => listItem(row, row.automation_name)) } };
}

async function requireRun(ctx: Ctx): Promise<RunRecord> {
  const run = await loadRun(ctx.params.rid, ctx.workspace.id);
  if (run === null) throw notFound();
  return run;
}

async function readRun(ctx: Ctx): Promise<Reply> {
  return { status: 200, json: await runDetail(await requireRun(ctx)) };
}

async function cancel(ctx: Ctx): Promise<Reply> {
  const run = await requireRun(ctx);
  if (isRunFinished(run.status)) throw new ApiError(409, messages.runFinished(run.number));
  await cancelRun(run);
  const updated = await requireRun(ctx);
  return { status: 200, json: await runDetail(updated) };
}

async function replay(ctx: Ctx): Promise<Reply> {
  const run = await requireRun(ctx);
  if (run.status !== 'failed') throw new ApiError(409, messages.onlyFailedReplay);
  const fromStep = typeof ctx.body.from_step === 'string' ? ctx.body.from_step : '';
  const steps = await loadSteps(run.id);
  const executed = orderSteps(steps).filter((step) => step.order_index !== null);
  const chosen = executed.find((step) => step.step_id === fromStep);
  const failed = executed.find((step) => step.step_id === run.failed_step);
  if (chosen === undefined) throw badRequest(messages.replayAtOrBefore);
  if (failed !== undefined && (chosen.order_index as number) > (failed.order_index as number)) {
    throw badRequest(messages.replayAtOrBefore);
  }
  if (stepsInsideLoops(run.content).has(fromStep)) throw badRequest(messages.replayInLoop);
  const started = await createRun({
    workspaceId: run.workspace_id,
    automationId: run.automation_id,
    version: run.version,
    content: run.content,
    triggerOutput: run.trigger_output,
    test: run.test,
    replayOf: run.id,
    reuse: reusePrefix(run, steps, fromStep),
  });
  return { status: 201, json: started };
}

export const runRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/workspaces/:ws/automations/:aid/runs',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: startRun,
  },
  { method: 'GET', path: '/api/workspaces/:ws/runs', auth: 'session', workspace: 'ws', handler: listRuns },
  { method: 'GET', path: '/api/workspaces/:ws/runs/:rid', auth: 'session', workspace: 'ws', handler: readRun },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/runs/:rid/cancel',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: cancel,
  },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/runs/:rid/replay',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: replay,
  },
];
