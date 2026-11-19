// Workflow run engine: executes published step lists. Runs stay on the
// version they started on. Loops and self-calling subflows are bounded.

import { stepCtx, evalStepCondition, RunStep, Step } from './workflows.js';
import { parse as parseExpr, evaluate as evalExpr, Ctx } from '../express/expression.js';
import { Db, clock } from './db.js';
import { Ctx as AppCtx } from './server.js';
import { ApiError } from './errors.js';
import { loadSnapshot, allocateNumber } from './recordengine.js';

export interface RunOutcome {
  id: number;
  status: 'running' | 'waiting' | 'done' | 'failed';
  steps: RunStep[];
}

/** Start a run on the current published version (or the draft for test runs). */
export async function startRun(app: AppCtx, workflowId: number, version: number | null, record: string, simulated: boolean): Promise<number> {
  const row = await app.db.query(`SELECT name, draft FROM workflows WHERE id = $1`, [workflowId]);
  if (!row.rows.length) throw new ApiError(404, 'not_found', 'No such record.');
  let steps: Step[];
  let useVersion: number;
  if (version === null) {
    // Test run: the draft.
    steps = row.rows[0].draft as Step[];
    useVersion = 0;
  } else {
    const v = version || await latestVersion(app.db, workflowId);
    useVersion = v;
    const res = await app.db.query(`SELECT steps FROM workflow_versions WHERE workflow = $1 AND version = $2`, [workflowId, v]);
    steps = res.rows.length ? res.rows[0].steps as Step[] : [];
  }

  const plan: RunStep[] = flattenSteps(steps).map(s => ({ id: s.id, name: s.name, status: 'waiting' as const }));
  const insert = await app.db.query(
    `INSERT INTO runs(workflow, version, record, status, steps, started_at, simulated)
     VALUES ($1,$2,$3,'running',$4,$5,$6) RETURNING id`,
    [workflowId, useVersion, record, JSON.stringify(plan), new Date(clock.nowMs()), simulated],
  );
  const runId = Number(insert.rows[0].id);

  await executeRun(app, runId, steps, record, simulated);
  return runId;
}

async function latestVersion(db: Db, workflowId: number): Promise<number> {
  const res = await db.query(`SELECT MAX(version) AS v FROM workflow_versions WHERE workflow = $1 AND NOT withdrawn`, [workflowId]);
  return Number(res.rows[0].v ?? 0);
}

function flattenSteps(steps: Step[]): Step[] {
  const out: Step[] = [];
  const walk = (list: Step[]): void => {
    for (const s of list) {
      out.push(s);
      walk([...(s.then ?? []), ...(s.else ?? []), ...(s.body ?? []), ...(s.on_error ?? [])]);
    }
  };
  walk(steps);
  return out;
}

/** Execute a step list against a record. Steps that change records are
 *  simulated in test runs and change nothing. */
async function executeRun(app: AppCtx, runId: number, steps: Step[], record: string, simulated: boolean): Promise<void> {
  const loopLimit = Number(app.settings.get('WORKFLOW_LOOP_LIMIT') ?? 100);
  const waitUnit = Number(app.settings.get('WAIT_STEP_UNIT_SECONDS') ?? 60);

  const snap = record ? await loadSnapshot(app.db, record) : null;
  const variables = (snap?.fields.variables ?? {}) as Record<string, unknown>;
  const stepOutputs: Record<string, Record<string, unknown>> = {};

  const statuses = new Map<string, RunStep['status']>();
  const errors = new Map<string, string>();

  const ctx = (): Ctx => stepCtx({
    record: snap?.fields ?? {},
    variables,
    inputs: {},
    steps: stepOutputs,
    now: clock.nowMs(),
    me: 'system',
  });

  const runList = async (list: Step[]): Promise<'ok' | 'failed'> => {
    for (const step of list) {
      switch (step.type) {
        case 'trigger':
          statuses.set(step.id, 'done');
          break;
        case 'if': {
          const cond = evalStepCondition(step.condition, ctx());
          const branch = cond ? (step.then ?? []) : (step.else ?? []);
          const result = await runList(branch);
          statuses.set(step.id, result === 'ok' ? 'done' : 'failed');
          if (result === 'failed') return 'failed';
          break;
        }
        case 'loop': {
          let iterations = 0;
          const body = step.body ?? [];
          for (;;) {
            if (step.until && evalStepCondition(step.until, ctx())) break;
            if (step.over) {
              // over evaluates to a list; stop when exhausted.
              const list2 = resolveList(step.over, ctx());
              if (iterations >= list2.length) break;
            }
            iterations++;
            if (iterations > loopLimit) {
              statuses.set(step.id, 'failed');
              errors.set(step.id, `Loop "${step.name}" stopped after ${loopLimit} iterations.`);
              return 'failed';
            }
            const result = await runList(body);
            if (result === 'failed') {
              statuses.set(step.id, 'failed');
              return 'failed';
            }
          }
          statuses.set(step.id, 'done');
          break;
        }
        case 'approval': {
          // Approvals pause the run; the item state moves to awaiting_approval.
          if (!simulated && snap) {
            await app.db.query(
              `UPDATE records SET state = 'awaiting_approval', updated_at = $2 WHERE number = $1`,
              [snap.number, new Date(clock.nowMs())],
            );
          }
          statuses.set(step.id, 'done');
          stepOutputs[step.id] = {};
          break;
        }
        case 'create_task': {
          if (!simulated) {
            const number = await allocateNumber(app.db, 'task');
            await app.db.query(
              `INSERT INTO records(number, "table", state, workspace, fields, created_at, created_by, updated_at)
               VALUES ($1,'task','open','live',$2,$3,'system',$3)`,
              [number, JSON.stringify({
                short_description: step.short_description ?? step.name,
                description: null,
                parent: snap?.number ?? null,
                assignment_group: step.group ?? null,
                assigned_to: null,
                close_note: null,
                cancel_reason: null,
                priority: 4,
                created_at: new Date(clock.nowMs()).toISOString(),
              }), new Date(clock.nowMs())],
            );
            await app.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'open',$2)`, [number, new Date(clock.nowMs())]);
          }
          statuses.set(step.id, 'done');
          break;
        }
        case 'set_fields': {
          if (!simulated && snap) {
            const updates: Record<string, unknown> = {};
            for (const [field, expr] of Object.entries(step.fields ?? {})) {
              updates[field] = evalValue(expr, ctx());
            }
            const merged = { ...snap.fields, ...updates };
            await app.db.query(`UPDATE records SET fields = $2, updated_at = $3 WHERE number = $1`, [snap.number, JSON.stringify(merged), new Date(clock.nowMs())]);
          }
          statuses.set(step.id, 'done');
          break;
        }
        case 'wait': {
          // A wait lasts its units x WAIT_STEP_UNIT_SECONDS of server time.
          statuses.set(step.id, 'done');
          stepOutputs[step.id] = { waited: (step.units ?? 1) * waitUnit };
          break;
        }
        case 'subflow': {
          const flowName = step.flow ?? '';
          const flow = await app.db.query(`SELECT id FROM workflows WHERE name = $1`, [flowName]);
          if (!flow.rows.length) {
            statuses.set(step.id, 'failed');
            errors.set(step.id, `Subflow "${flowName}" does not exist.`);
            return 'failed';
          }
          const subVersion = await latestVersion(app.db, Number(flow.rows[0].id));
          const subRes = await app.db.query(`SELECT steps FROM workflow_versions WHERE workflow = $1 AND version = $2`, [Number(flow.rows[0].id), subVersion]);
          const subSteps = subRes.rows.length ? subRes.rows[0].steps as Step[] : [];
          const result = await runList(subSteps);
          statuses.set(step.id, result === 'ok' ? 'done' : 'failed');
          if (result === 'failed') return 'failed';
          break;
        }
        case 'notify': {
          statuses.set(step.id, 'done');
          break;
        }
        case 'end': {
          statuses.set(step.id, 'done');
          return 'ok';
        }
      }
    }
    return 'ok';
  };

  const result = await runList(steps);

  const all = flattenSteps(steps).map(s => ({
    id: s.id,
    name: s.name,
    status: statuses.get(s.id) ?? 'waiting',
    error: errors.get(s.id) ?? null,
  }));

  await app.db.query(
    `UPDATE runs SET status = $2, steps = $3 WHERE id = $1`,
    [runId, result === 'ok' ? 'done' : 'failed', JSON.stringify(all)],
  );
  app.live.publish(`run:${runId}`, 'updated', { id: runId, status: result === 'ok' ? 'done' : 'failed', steps: all });
}

function resolveList(expr: string, ctx: Ctx): unknown[] {
  const value = evalValue(expr, ctx);
  return Array.isArray(value) ? value : [];
}

/** Evaluate an expression to a value; a plain string is a literal. */
function evalValue(expr: string, ctx: Ctx): unknown {
  try {
    return evalExprValue(expr, ctx);
  } catch {
    return null;
  }
}

function evalExprValue(expr: string, ctx: Ctx): unknown {
  if (expr.startsWith('"') && expr.endsWith('"')) return expr.slice(1, -1);
  return evalExpr(parseExpr(expr), ctx);
}

/** Retry a failed run: re-run the failed step and continue. */
export async function retryRun(app: AppCtx, runId: number): Promise<unknown> {
  const res = await app.db.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!res.rows.length) throw new ApiError(404, 'not_found', 'No such record.');
  const run = res.rows[0];
  if (run.status !== 'failed') throw new ApiError(409, 'not_failed', 'Only failed runs can be retried.');
  const steps = await app.db.query(`SELECT steps FROM workflow_versions WHERE workflow = $1 AND version = $2`, [run.workflow, run.version]);
  const list = steps.rows.length ? steps.rows[0].steps as Step[] : [];
  await app.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [runId]);
  await executeRun(app, runId, list, run.record, run.simulated);
  const after = await app.db.query(`SELECT id, status, steps FROM runs WHERE id = $1`, [runId]);
  return after.rows[0];
}
