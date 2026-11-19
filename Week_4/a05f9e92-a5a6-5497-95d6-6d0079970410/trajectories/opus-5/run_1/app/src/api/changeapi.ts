/**
 * Change risk, approvals, votes, the calendar, boards, freeze windows and the
 * approvals a person owes.
 */

import { iso, nowMs } from '../clock';
import { query, transaction } from '../db';
import { conflict, notFound, validation } from '../errors';
import { isOpenState } from '../domain/transitions';
import {
  addDays,
  daysInMonth,
  localDate,
  monthName,
  parseDisplayTime,
  startOfLocalDate,
  weekdayName,
} from '../domain/zone';
import { requireCaller, requireOperator, requireRoles, type RequestContext } from '../http/context';
import {
  activeDelegateOf,
  castVote,
  loadSteps,
  riskOf,
  settleStep,
  stepJson,
} from '../services/changes';
import { Engine, type Caller } from '../services/engine';
import { loadBoards, loadFreezeWindows, type RecordRow } from '../services/store';
import { created, ok, route } from './router';

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  return { engine: await Engine.load(caller.workspace), caller };
}

const changeViewers = ['operator', 'technician', 'approver'] as const;

route('GET', '/api/records/:number/risk', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, [...changeViewers]);
  const record = engine.requireVisible(caller, params.number);
  if (record.table !== 'change') throw notFound();
  const risk = riskOf(engine, record);
  return ok({
    score: risk.score,
    band: risk.band,
    inputs: {
      criticality: risk.inputs.criticality,
      people_total: risk.inputs.peopleTotal,
      people_band: risk.inputs.peopleBand,
      backout_tested: risk.inputs.backoutTested,
      in_business_hours: risk.inputs.inBusinessHours,
      failed_changes_90d: risk.inputs.failedChanges90d,
      duration_hours: risk.inputs.durationHours,
    },
  });
});

route('GET', '/api/records/:number/approvals', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, [...changeViewers]);
  const record = engine.requireVisible(caller, params.number);
  const steps = await loadSteps(record.number);
  return ok({ steps: steps.map((step) => stepJson(engine, step)) });
});

route('POST', '/api/records/:number/steps/:step/votes', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  const decision = context.body.decision === 'reject' ? 'reject' : 'approve';
  const onBehalfOf = context.body.on_behalf_of === null || context.body.on_behalf_of === undefined
    ? null
    : String(context.body.on_behalf_of);
  const result = await castVote(
    engine,
    caller,
    record.number,
    Number(params.step),
    decision,
    String(context.body.comment ?? ''),
    onBehalfOf,
  );
  const refreshed = await Engine.load(engine.workspace);
  const steps = await loadSteps(record.number);
  const step = steps.find((s) => s.step === Number(params.step));
  return created({
    vote: {
      voter: result.voter,
      voted_by: result.votedBy,
      decision,
      at: iso(new Date(result.at)),
    },
    step: step ? stepJson(refreshed, step) : null,
  });
});

route('POST', '/api/records/:number/steps/:step/close', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireOperator(context);
  const record = engine.requireVisible(caller, params.number);
  const steps = await loadSteps(record.number);
  const step = steps.find((s) => s.step === Number(params.step));
  if (!step) throw notFound();
  if (step.status === 'approved' || step.status === 'rejected') {
    throw conflict('vote_closed', `This vote closed at ${iso(new Date(step.closesAt ?? nowMs()))}.`);
  }
  await transaction((client) => settleStep(client, engine, record, step, nowMs(), true));
  const after = (await loadSteps(record.number)).find((s) => s.step === Number(params.step));
  const refreshed = await Engine.load(engine.workspace);
  return ok({ step: after ? stepJson(refreshed, after) : null });
});

/** The change calendar cuts days in the business time zone, ends exclusive. */
route('GET', '/api/changes/calendar', async (context) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, [...changeViewers]);
  const month = context.url.searchParams.get('month') ?? localDate(engine.businessZone, engine.at).slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw validation('A month looks like YYYY-MM.', { month: 'A month looks like YYYY-MM.' });
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const zone = engine.businessZone;
  const counted = ['assessed', 'peer_review', 'board_vote', 'approved', 'implementing', 'done'];
  const changes = [...engine.records.values()].filter(
    (r) => r.table === 'change' && counted.includes(r.state) && engine.visible(caller, r),
  );
  const freezes = await loadFreezeWindows();

  const days: Record<string, unknown>[] = [];
  for (let day = 1; day <= daysInMonth(year, monthNumber); day += 1) {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const from = startOfLocalDate(zone, date);
    const to = startOfLocalDate(zone, addDays(date, 1));
    days.push({
      date,
      weekday: weekdayName(date),
      month_name: monthName(monthNumber),
      changes: changes
        .filter((change) => overlapsDay(change, from, to))
        .map((change) => ({
          number: change.number,
          title: String(change.fields.title ?? ''),
          planned_start: change.fields.planned_start ?? null,
          planned_end: change.fields.planned_end ?? null,
        })),
      freezes: freezes
        .filter((freeze) => freeze.start < to && from < freeze.end)
        .map((freeze) => freeze.name)
        .sort(),
    });
  }
  return ok({ month, days });
});

function overlapsDay(change: RecordRow, from: number, to: number): boolean {
  const start = Date.parse(String(change.fields.planned_start ?? ''));
  const end = Date.parse(String(change.fields.planned_end ?? ''));
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start < to && from < end;
}

route('GET', '/api/boards', async (context) => {
  requireCaller(context);
  const boards = await loadBoards('live');
  return ok({
    boards: boards.map((b) => ({
      name: b.name,
      rule: b.rule,
      n: b.n,
      threshold_percent: b.thresholdPercent,
      window_hours: b.windowHours,
      members: b.members,
    })),
  });
});

route('POST', '/api/boards', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await upsertBoard(engine.workspace, name, context.body);
  return created({ board: { name, ...context.body } });
});

route('PUT', '/api/boards/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await upsertBoard(engine.workspace, params.name, context.body);
  return ok({ board: { name: params.name, ...context.body } });
});

async function upsertBoard(
  workspace: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO board (name, rule, n, threshold_percent, window_hours, members, workspace)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (workspace, name) DO UPDATE SET rule = $2, n = $3, threshold_percent = $4,
       window_hours = $5, members = $6::jsonb`,
    [
      name,
      String(body.rule ?? 'any'),
      body.n === null || body.n === undefined ? null : Number(body.n),
      body.threshold_percent === null || body.threshold_percent === undefined
        ? null
        : Number(body.threshold_percent),
      Number(body.window_hours ?? 48),
      JSON.stringify(body.members ?? []),
      workspace,
    ],
  );
}

route('GET', '/api/boards/:name/agenda', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, [...changeViewers]);
  const boards = await loadBoards(engine.workspace);
  const board = boards.find((b) => b.name === params.name);
  if (!board) throw notFound();
  const members = new Set(board.members.map((m) => m.username));
  const items: Record<string, unknown>[] = [];
  for (const record of engine.records.values()) {
    if (record.table !== 'change' || !engine.visible(caller, record)) continue;
    const steps = await loadSteps(record.number);
    const open = steps.find(
      (s) => s.status === 'open' && s.voters.some((v) => members.has(v.username)),
    );
    if (!open) continue;
    items.push({
      number: record.number,
      title: String(record.fields.title ?? ''),
      planned_start: record.fields.planned_start ?? null,
      step: stepJson(engine, open),
    });
  }
  items.sort((a, b) => {
    const as = String(a.planned_start ?? '');
    const bs = String(b.planned_start ?? '');
    if (as !== bs) return as < bs ? -1 : 1;
    return String(a.number) < String(b.number) ? -1 : 1;
  });
  return ok({ items });
});

route('GET', '/api/freeze-windows', async (context) => {
  requireCaller(context);
  const freezes = await loadFreezeWindows();
  return ok({
    freeze_windows: freezes.map((f) => ({
      name: f.name,
      start: iso(new Date(f.start)),
      end: iso(new Date(f.end)),
      time_zone: f.timeZone,
      scope: f.scope,
    })),
  });
});

route('POST', '/api/freeze-windows', async (context) => {
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  const zone = String(context.body.time_zone ?? 'Europe/Berlin');
  // A freeze form's start and end are read in the zone typed in the same form.
  const start = readTime(String(context.body.start ?? ''), zone);
  const end = readTime(String(context.body.end ?? ''), zone);
  if (name === '' || start === null || end === null || end <= start) {
    throw validation('A freeze window needs a name and a start before its end.', {
      name: 'A freeze window needs a name and a start before its end.',
    });
  }
  await query(
    `INSERT INTO freeze_window (name, start_at, end_at, time_zone, scope)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (name) DO UPDATE SET start_at = $2, end_at = $3, time_zone = $4, scope = $5::jsonb`,
    [name, new Date(start), new Date(end), zone, JSON.stringify(context.body.scope ?? 'all')],
  );
  return created({
    freeze_window: {
      name,
      start: iso(new Date(start)),
      end: iso(new Date(end)),
      time_zone: zone,
      scope: context.body.scope ?? 'all',
    },
  });
});

function readTime(text: string, zone: string): number | null {
  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) return direct;
  return parseDisplayTime(zone, text);
}

/** Approval cards: change steps and catalog approvals, by closing time. */
route('GET', '/api/approvals', async (context) => {
  const { engine, caller } = await engineFor(context);
  const out: Record<string, unknown>[] = [];
  for (const record of engine.records.values()) {
    if (record.table !== 'change') continue;
    const steps = await loadSteps(record.number);
    for (const step of steps) {
      if (step.status !== 'open') continue;
      const forMe = step.voters.some(
        (v) => v.username === caller.username && v.decision === null,
      );
      const asDelegate = step.voters.some(
        (v) => v.decision === null && activeDelegateOf(engine, v.username, engine.at) === caller.username,
      );
      if (!forMe && !asDelegate) continue;
      out.push({
        kind: 'change_step',
        id: `${record.number}:${step.step}`,
        record: record.number,
        title: String(record.fields.title ?? ''),
        closes_at: step.closesAt === null ? null : iso(new Date(step.closesAt)),
        step: stepJson(engine, step),
      });
    }
  }
  const itemRows = await query<{
    id: string;
    number: string;
    approvers: string[];
    rule: string;
    decision: string | null;
  }>(`SELECT id, number, approvers, rule, decision FROM item_approval WHERE decision IS NULL`);
  for (const row of itemRows) {
    if (!(row.approvers ?? []).includes(caller.username)) continue;
    const item = engine.records.get(row.number);
    if (!item) continue;
    const catalogItem = engine.catalogItems.get(String(item.fields.item ?? ''));
    out.push({
      kind: 'request_item',
      id: row.id,
      record: row.number,
      title: catalogItem?.name ?? String(item.fields.item ?? ''),
      closes_at: null,
      step: null,
    });
  }
  out.sort((a, b) => {
    const ac = a.closes_at === null ? 1 : 0;
    const bc = b.closes_at === null ? 1 : 0;
    if (ac !== bc) return ac - bc;
    if (a.closes_at !== null && b.closes_at !== null && a.closes_at !== b.closes_at) {
      return String(a.closes_at) < String(b.closes_at) ? -1 : 1;
    }
    return String(a.record) < String(b.record) ? -1 : 1;
  });
  return ok({ approvals: out });
});

export { isOpenState };
