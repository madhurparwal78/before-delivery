import { randomUUID } from 'node:crypto';
import { nowMs } from '../clock.js';
import { one, query } from '../db.js';
import { fail } from '../errors.js';
import { route, type Ctx, type ResolvedResource } from '../http.js';
import { currentSeq, publish } from '../live.js';
import { streamByName } from '../store.js';
import {
  groupsOf,
  maintenanceOf,
  nextWindowStart,
  rulesOf,
  ruleRowOf,
  snoozedAt,
  sortDays,
  windowCovers,
  type GroupRow,
  type MaintenanceRow,
  type RuleRow,
  type RuleSpec,
} from '../domain/alerts.js';
import { caseMoveAllowed, CASE_STATUSES, type CaseStatus } from '../domain/cases.js';
import { isKnownZone } from '../domain/tz.js';

const MEASURES = ['count', 'avg', 'max', 'min', 'sum'];
const COMPARISONS = ['>', '>=', '<', '<='];
const FILTER_OPS = ['eq', 'ne', 'exists', 'gt', 'gte', 'lt', 'lte'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export async function serializeRule(
  rule: RuleRow,
  windows: MaintenanceRow[],
): Promise<Record<string, unknown>> {
  const groups = await groupsOf(rule.id);
  const at = nowMs();
  const ruleWindows = windows.filter((window) => window.ruleId === rule.id);
  const inMaintenance = ruleWindows.some((window) => windowCovers(window, at));
  const history = await query(
    `select check_no, group_name, at_ms, from_state, to_state from rule_history
     where rule_id = $1 order by id asc`,
    [rule.id],
  );
  return {
    id: rule.id,
    name: rule.name,
    ...rule.spec,
    groups: groups.map((group) => serializeGroup(group, inMaintenance)),
    last_check: rule.lastCheck,
    history: history.map((row) => ({
      check: Number(row.check_no),
      group: String(row.group_name),
      at: new Date(Number(row.at_ms)).toISOString(),
      from: String(row.from_state),
      to: String(row.to_state),
    })),
  };
}

export function serializeGroup(group: GroupRow, inMaintenance: boolean): Record<string, unknown> {
  return {
    group: group.group,
    state: group.state,
    flapping: group.flapping,
    snoozed: snoozedAt(group, nowMs()),
    snoozed_until: group.snoozedUntilMs === null ? null : new Date(group.snoozedUntilMs).toISOString(),
    in_maintenance: inMaintenance,
    acknowledged_by: group.acknowledgedBy,
  };
}

async function ruleResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from rules where id = $1 and space_id = $2`, [params.id, space.id]);
  return row === null ? null : { value: row };
}

async function caseResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from cases where space_id = $1 and number = $2`, [
    space.id,
    Number(params.number),
  ]);
  return row === null ? null : { value: row };
}

async function inboxResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from inbox where id = $1 and space_id = $2`, [params.id, space.id]);
  return row === null ? null : { value: row };
}

async function ruleById(ctx: Ctx, id: string): Promise<RuleRow> {
  const row = await one(`select * from rules where id = $1 and space_id = $2`, [id, ctx.space.id]);
  if (!row) throw fail.notFound();
  return ruleRowOf(row);
}

export function registerAlertRoutes(): void {
  route({
    method: 'GET',
    path: '/api/rules',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rules = await rulesOf(ctx.space.id);
      const windows = await maintenanceOf(ctx.space.id);
      const body = [];
      for (const rule of rules) body.push(await serializeRule(rule, windows));
      return { status: 200, body: { rules: body } };
    },
  });

  route({
    method: 'GET',
    path: '/api/rules/:id',
    auth: 'session',
    resource: ruleResource,
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rule = await ruleById(ctx, ctx.params.id);
      const windows = await maintenanceOf(ctx.space.id);
      return { status: 200, body: await serializeRule(rule, windows) };
    },
  });

  route({
    method: 'POST',
    path: '/api/rules',
    auth: 'session',
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const name = String(ctx.body.name ?? '');
      const taken = await one(`select 1 from rules where space_id = $1 and name = $2`, [
        ctx.space.id,
        name,
      ]);
      if (taken) throw fail.nameTaken({ name: 'That name is already used.' });
      const spec = await validateRule(ctx);
      const id = randomUUID();
      await query(`insert into rules (id, space_id, name, spec) values ($1, $2, $3, $4)`, [
        id,
        ctx.space.id,
        name,
        JSON.stringify(spec),
      ]);
      return {
        status: 201,
        body: { id, name, ...spec, groups: [], seq: await currentSeq(ctx.space.id) },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/rules/:id/groups/:group/snooze',
    auth: 'session',
    resource: ruleResource,
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const rule = await ruleById(ctx, ctx.params.id);
      const groups = await groupsOf(rule.id);
      const group = groups.find((item) => item.group === ctx.params.group);
      if (!group) throw fail.notFound();
      const choice = String(ctx.body.for ?? '');
      if (!['1h', '1d', 'recovered'].includes(choice)) {
        throw fail.invalid({ for: 'Choose 1 hour, 1 day or until recovered.' });
      }
      const until =
        choice === '1h' ? nowMs() + 3600000 : choice === '1d' ? nowMs() + 86400000 : null;
      await query(
        `update rule_groups set snoozed_until_ms = $3, snooze_recovered = $4 where rule_id = $1 and group_name = $2`,
        [rule.id, group.group, until, choice === 'recovered'],
      );
      const updated = (await groupsOf(rule.id)).find((item) => item.group === group.group)!;
      const windows = (await maintenanceOf(ctx.space.id)).filter((window) => window.ruleId === rule.id);
      const body = serializeGroup(updated, windows.some((window) => windowCovers(window, nowMs())));
      const seq = await publish(ctx.space.id, 'alert', {
        rule: rule.id,
        rule_name: rule.name,
        group: group.group,
        ...body,
      });
      return { status: 200, body: { ...body, seq } };
    },
  });

  route({
    method: 'POST',
    path: '/api/rules/:id/groups/:group/ack',
    auth: 'session',
    resource: ruleResource,
    space: true,
    role: 'editor',
    body: 'none',
    handler: async (ctx) => {
      const rule = await ruleById(ctx, ctx.params.id);
      const groups = await groupsOf(rule.id);
      const group = groups.find((item) => item.group === ctx.params.group);
      if (!group) throw fail.notFound();
      const username = ctx.caller.kind === 'session' ? ctx.caller.user.username : '';
      await query(
        `update rule_groups set acknowledged_by = coalesce(acknowledged_by, $3) where rule_id = $1 and group_name = $2`,
        [rule.id, group.group, username],
      );
      await query(
        `update inbox set acknowledged_by = coalesce(acknowledged_by, $3)
         where rule_id = $1 and group_name = $2 and acknowledged_by is null`,
        [rule.id, group.group, username],
      );
      const updated = (await groupsOf(rule.id)).find((item) => item.group === group.group)!;
      const windows = (await maintenanceOf(ctx.space.id)).filter((window) => window.ruleId === rule.id);
      const body = serializeGroup(updated, windows.some((window) => windowCovers(window, nowMs())));
      const seq = await publish(ctx.space.id, 'alert', {
        rule: rule.id,
        rule_name: rule.name,
        group: group.group,
        acknowledged: true,
        ...body,
      });
      return { status: 200, body: { ...body, seq } };
    },
  });

  route({
    method: 'GET',
    path: '/api/maintenance',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const windows = await maintenanceOf(ctx.space.id);
      const rules = await rulesOf(ctx.space.id);
      return {
        status: 200,
        body: {
          windows: windows.map((window) => ({
            id: window.id,
            name: window.name,
            time_zone: window.timeZone,
            days: window.days,
            start: window.start,
            duration_ms: window.durationMs,
            rule: window.ruleId,
            rule_name: rules.find((rule) => rule.id === window.ruleId)?.name ?? '',
            next_start: new Date(nextWindowStart(window, nowMs())).toISOString(),
          })),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/maintenance',
    auth: 'session',
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const name = String(ctx.body.name ?? '');
      const zone = String(ctx.body.time_zone ?? '');
      const days = Array.isArray(ctx.body.days) ? (ctx.body.days as string[]) : [];
      const start = String(ctx.body.start ?? '');
      const durationMs = Number(ctx.body.duration_ms);
      const ruleId = String(ctx.body.rule ?? '');
      const fields: Record<string, string> = {};
      if (name === '') fields.name = 'Enter a name.';
      if (!isKnownZone(zone)) fields.time_zone = `Unknown time zone ${zone}.`;
      if (days.length === 0 || days.some((day) => !DAYS.includes(day))) {
        fields.days = 'Choose at least one day.';
      }
      if (!/^\d{2}:\d{2}$/.test(start)) fields.start = 'Enter a start as HH:MM.';
      if (!Number.isInteger(durationMs) || durationMs <= 0) {
        fields.duration_ms = 'Enter a whole number of milliseconds.';
      }
      const rule = await one(`select id from rules where id = $1 and space_id = $2`, [
        ruleId,
        ctx.space.id,
      ]);
      if (!rule) fields.rule = 'Choose a rule.';
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const id = randomUUID();
      await query(
        `insert into maintenance (id, space_id, name, time_zone, days, start, duration_ms, rule_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, ctx.space.id, name, zone, JSON.stringify(sortDays(days)), start, durationMs, ruleId],
      );
      const window = (await maintenanceOf(ctx.space.id)).find((item) => item.id === id)!;
      const seq = await publish(ctx.space.id, 'alert', { maintenance: id, name });
      return {
        status: 201,
        body: {
          id,
          name,
          time_zone: zone,
          days: sortDays(days),
          start,
          duration_ms: durationMs,
          rule: ruleId,
          next_start: new Date(nextWindowStart(window, nowMs())).toISOString(),
          seq,
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/inbox',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(
        `select i.id, i.rule_id, i.rule_name, i.group_name, i.text, i.at_ms, i.acknowledged_by
         from inbox i where i.space_id = $1 order by i.at_ms desc, i.id desc`,
        [ctx.space.id],
      );
      return {
        status: 200,
        body: {
          items: rows.map((row) => ({
            id: String(row.id),
            rule: String(row.rule_id),
            rule_name: String(row.rule_name),
            group: String(row.group_name),
            text: String(row.text),
            at: new Date(Number(row.at_ms)).toISOString(),
            acknowledged_by: row.acknowledged_by === null ? null : String(row.acknowledged_by),
          })),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/inbox/:id/ack',
    auth: 'session',
    resource: inboxResource,
    space: true,
    role: 'editor',
    body: 'none',
    handler: async (ctx) => {
      const username = ctx.caller.kind === 'session' ? ctx.caller.user.username : '';
      const row = await one(`select * from inbox where id = $1 and space_id = $2`, [
        ctx.params.id,
        ctx.space.id,
      ]);
      if (!row) throw fail.notFound();
      const updated = await one(
        `update inbox set acknowledged_by = coalesce(acknowledged_by, $2) where id = $1 returning *`,
        [ctx.params.id, username],
      );
      const item = {
        id: String(updated?.id),
        rule: String(updated?.rule_id),
        group: String(updated?.group_name),
        text: String(updated?.text),
        at: new Date(Number(updated?.at_ms)).toISOString(),
        acknowledged_by: String(updated?.acknowledged_by),
      };
      const seq = await publish(ctx.space.id, 'inbox', { item });
      return { status: 200, body: { ...item, seq } };
    },
  });

  route({
    method: 'GET',
    path: '/api/cases',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(
        `select number, title, status from cases where space_id = $1 order by number desc`,
        [ctx.space.id],
      );
      return {
        status: 200,
        body: {
          cases: rows.map((row) => ({
            number: Number(row.number),
            title: String(row.title),
            status: String(row.status),
          })),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/cases',
    auth: 'session',
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const title = String(ctx.body.title ?? '');
      if (title.trim() === '') throw fail.invalid({ title: 'Enter a case title.' });
      const created = await one<{ number: number }>(
        `insert into cases (space_id, number, title, status, created_ms)
         values ($1, (select coalesce(max(number), 0) + 1 from cases where space_id = $1), $2, 'open', $3)
         returning number`,
        [ctx.space.id, title, nowMs()],
      );
      const number = Number(created?.number);
      const seq = await publish(ctx.space.id, 'case', { number, title, status: 'open' });
      return { status: 201, body: { number, title, status: 'open', seq } };
    },
  });

  route({
    method: 'GET',
    path: '/api/cases/:number',
    auth: 'session',
    resource: caseResource,
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      return { status: 200, body: await caseBody(ctx, Number(ctx.params.number)) };
    },
  });

  route({
    method: 'PATCH',
    path: '/api/cases/:number',
    auth: 'session',
    resource: caseResource,
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const number = Number(ctx.params.number);
      const row = await one(`select * from cases where space_id = $1 and number = $2`, [
        ctx.space.id,
        number,
      ]);
      if (!row) throw fail.notFound();
      const from = String(row.status) as CaseStatus;
      const to = String(ctx.body.status ?? '') as CaseStatus;
      if (!CASE_STATUSES.includes(to)) throw fail.invalid({ status: 'Choose a case status.' });
      if (!caseMoveAllowed(from, to)) throw fail.caseFlow(from, to);
      const changed = await query(
        `update cases set status = $3 where space_id = $1 and number = $2 and status = $4`,
        [ctx.space.id, number, to, from],
      );
      if (changed.length === 0) {
        const current = await one(`select status from cases where space_id = $1 and number = $2`, [
          ctx.space.id,
          number,
        ]);
        const latest = String(current?.status) as CaseStatus;
        if (latest !== to) throw fail.caseFlow(latest, to);
      }
      const body = await caseBody(ctx, number);
      const seq = await publish(ctx.space.id, 'case', { number, status: to, title: body.title });
      return { status: 200, body: { ...body, seq } };
    },
  });

  route({
    method: 'POST',
    path: '/api/cases/:number/items',
    auth: 'session',
    resource: caseResource,
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const number = Number(ctx.params.number);
      const row = await one(`select id from cases where space_id = $1 and number = $2`, [
        ctx.space.id,
        number,
      ]);
      if (!row) throw fail.notFound();
      const caseId = Number(row.id);
      if (ctx.body.rule !== undefined && ctx.body.group !== undefined) {
        const rule = await ruleById(ctx, String(ctx.body.rule));
        await query(
          `insert into case_items (case_id, kind, payload, at_ms) values ($1, 'group', $2, $3)`,
          [
            caseId,
            JSON.stringify({ rule: rule.id, rule_name: rule.name, group: String(ctx.body.group) }),
            nowMs(),
          ],
        );
      } else if (ctx.body.inbox_item !== undefined) {
        const item = await one(`select * from inbox where id = $1 and space_id = $2`, [
          String(ctx.body.inbox_item),
          ctx.space.id,
        ]);
        if (!item) throw fail.notFound();
        await query(
          `insert into case_items (case_id, kind, payload, at_ms) values ($1, 'inbox', $2, $3)`,
          [caseId, JSON.stringify({ id: String(item.id), text: String(item.text) }), nowMs()],
        );
      } else if (ctx.body.trace_id !== undefined) {
        const trace = await one(`select trace_id from traces where trace_id = $1 and space_id = $2`, [
          String(ctx.body.trace_id),
          ctx.space.id,
        ]);
        if (!trace) throw fail.notFound();
        await query(
          `insert into case_items (case_id, kind, payload, at_ms) values ($1, 'trace', $2, $3)`,
          [caseId, JSON.stringify({ trace_id: String(trace.trace_id) }), nowMs()],
        );
      } else {
        throw fail.invalid({ item: 'Send a group, an inbox item or a trace id.' });
      }
      const body = await caseBody(ctx, number);
      const seq = await publish(ctx.space.id, 'case', { number, items: body.items });
      return { status: 201, body: { ...body, seq } };
    },
  });
}

async function caseBody(ctx: Ctx, number: number): Promise<Record<string, unknown>> {
  const row = await one(`select * from cases where space_id = $1 and number = $2`, [
    ctx.space.id,
    number,
  ]);
  if (!row) throw fail.notFound();
  const items = await query(
    `select kind, payload from case_items where case_id = $1 order by id asc`,
    [Number(row.id)],
  );
  return {
    number,
    title: String(row.title),
    status: String(row.status),
    items: items.map((item) => ({ kind: String(item.kind), ...(item.payload as object) })),
  };
}

async function validateRule(ctx: Ctx): Promise<RuleSpec> {
  const fields: Record<string, string> = {};
  const name = String(ctx.body.name ?? '');
  if (name.trim() === '') fields.name = 'Enter a rule name.';
  const streamName = String(ctx.body.stream ?? '');
  const stream = await streamByName(ctx.space.id, streamName);
  if (!stream) fields.stream = 'Choose a stream.';
  const measure = String(ctx.body.measure ?? 'count');
  if (!MEASURES.includes(measure)) fields.measure = 'Choose a measure.';
  const measureField =
    ctx.body.measure_field === undefined || ctx.body.measure_field === null || ctx.body.measure_field === ''
      ? null
      : String(ctx.body.measure_field);
  if (measure !== 'count' && measureField === null) {
    fields.measure_field = 'Enter a number field.';
  }
  const groupBy =
    ctx.body.group_by === undefined || ctx.body.group_by === null || ctx.body.group_by === ''
      ? null
      : String(ctx.body.group_by);
  const windowMs = Number(ctx.body.window_ms);
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    fields.window_ms = 'Enter a whole number of milliseconds.';
  }
  const comparison = String(ctx.body.comparison ?? '');
  if (!COMPARISONS.includes(comparison)) fields.comparison = 'Choose a comparison.';
  const threshold = Number(ctx.body.threshold);
  if (!Number.isFinite(threshold)) fields.threshold = 'Enter a number.';
  const filterInput = ctx.body.filter as { field?: unknown; op?: unknown; value?: unknown } | null;
  let filter: RuleSpec['filter'] = null;
  if (filterInput !== null && filterInput !== undefined && filterInput.field !== undefined && filterInput.field !== '') {
    if (typeof filterInput.field !== 'string' || !FILTER_OPS.includes(String(filterInput.op))) {
      fields.filter = 'A filter needs a field and an operator.';
    } else {
      filter = {
        field: filterInput.field,
        op: String(filterInput.op) as RuleSpec['filter'] extends null ? never : 'eq',
        value: filterInput.value,
      };
    }
  }
  const frequencyInput = ctx.body.frequency as { kind?: unknown; every_ms?: unknown } | undefined;
  let frequency: RuleSpec['frequency'] = { kind: 'change' };
  if (frequencyInput !== undefined && frequencyInput !== null) {
    const kind = String(frequencyInput.kind);
    if (kind === 'change' || kind === 'check') {
      frequency = { kind };
    } else if (kind === 'throttle') {
      const every = Number(frequencyInput.every_ms);
      if (!Number.isInteger(every) || every <= 0) {
        fields['frequency.every_ms'] = 'Enter a whole number of milliseconds.';
      } else {
        frequency = { kind: 'throttle', every_ms: every };
      }
    } else {
      fields.frequency = 'Choose an action frequency.';
    }
  }
  if (Object.keys(fields).length > 0) throw fail.invalid(fields);
  return {
    stream: streamName,
    filter,
    measure: measure as RuleSpec['measure'],
    measure_field: measureField,
    group_by: groupBy,
    window_ms: windowMs,
    comparison: comparison as RuleSpec['comparison'],
    threshold,
    frequency,
  };
}
