import { findAutomation } from '../automations.js';
import { workspaceNow } from '../clock.js';
import { db } from '../db.js';
import { cancelRun, startReplay, startRun } from '../engine.js';
import { refuse } from '../errors.js';
import type { Ctx, Route } from '../http.js';
import { isObject } from '../json.js';
import { msg } from '../messages.js';
import { loadRun, type RunRow } from '../runStore.js';
import { runDetail, runItem } from '../runView.js';
import { ALL_RUN_STATUSES } from '../status.js';

const LIST_LIMIT = 100;

async function requireRun(ctx: Ctx): Promise<void> {
  const run = await loadRun(db, ctx.params.rid ?? '');
  if (run === null || run.workspace_id !== ctx.workspaceId) throw refuse.notFound();
}

async function loaded(ctx: Ctx): Promise<RunRow> {
  return (await loadRun(db, ctx.params.rid ?? '')) as RunRow;
}

export const runRoutes: Route[] = [
  {
    method: 'POST', path: '/api/workspaces/:ws/automations/:aid/runs', access: 'write', body: 'optional-json',
    async check(ctx) {
      if ((await findAutomation(db, ctx.workspaceId, ctx.params.aid ?? '')) === null) throw refuse.notFound();
    },
    async handle(ctx) {
      const automation = (await findAutomation(db, ctx.workspaceId, ctx.params.aid ?? '')) as NonNullable<Awaited<ReturnType<typeof findAutomation>>>;
      const test = ctx.body.test === true;
      if (!test && automation.trigger_kind !== 'manual') throw refuse.conflict(msg.manualOnly);
      if (ctx.body.input !== undefined && !isObject(ctx.body.input)) throw refuse.invalid(msg.inputNotObject);
      const triggerOutput = ctx.body.input ?? (test ? automation.draft.trigger.sample : {});
      const started = await startRun({ workspaceId: ctx.workspaceId, automation, test, triggerOutput, at: await workspaceNow(ctx.workspaceId) });
      return { status: 201, body: started };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/runs',
    async handle(ctx) {
      const automationId = ctx.query.get('automation');
      const status = ctx.query.get('status');
      if (automationId && (await findAutomation(db, ctx.workspaceId, automationId)) === null) throw refuse.notFound();
      if (status && !(ALL_RUN_STATUSES as readonly string[]).includes(status)) throw refuse.invalid(msg.unknownStatus(status));
      const { rows } = await db.query<RunRow & { automation_name: string }>(
        `SELECT r.*, a.name AS automation_name FROM runs r JOIN automations a ON a.id = r.automation_id
         WHERE r.workspace_id = $1 AND ($2::text IS NULL OR r.status = $2) AND ($3::text IS NULL OR r.automation_id = $3)
           AND ($4::boolean OR NOT r.test)
         ORDER BY r.started_at DESC, r.number DESC LIMIT ${LIST_LIMIT}`,
        [ctx.workspaceId, status || null, automationId || null, ctx.query.get('test') === 'true'],
      );
      return { status: 200, body: { runs: rows.map((row) => runItem(row, row.automation_name)) } };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/runs/:rid', check: requireRun,
    async handle(ctx) {
      return { status: 200, body: await runDetail(db, await loaded(ctx)) };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/runs/:rid/cancel', check: requireRun, access: 'write',
    async handle(ctx) {
      const run = await cancelRun(ctx.workspaceId, ctx.params.rid ?? '');
      return { status: 200, body: await runDetail(db, run) };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/runs/:rid/replay', check: requireRun, access: 'write', body: 'json',
    async handle(ctx) {
      const from = typeof ctx.body.from_step === 'string' ? ctx.body.from_step : '';
      const started = await startReplay(ctx.workspaceId, await loaded(ctx), from, await workspaceNow(ctx.workspaceId));
      return { status: 201, body: started };
    },
  },
];
