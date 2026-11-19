/**
 * Rules, schedules, SLA definitions, workflows, runs, knowledge and the inbox.
 */

import { iso, now, nowMs } from '../clock';
import { query, transaction } from '../db';
import { ApiError, conflict, notFound, validation } from '../errors';
import { validateExpression } from '../expr/interpret';
import { tableNames, type TableName } from '../domain/fields';
import { inboxEvents } from '../domain/inbox';
import {
  articleTransitions,
  distinctTokens,
  inAudience,
  rankArticles,
  scoreArticle,
  type Article,
} from '../domain/knowledge';
import { isRoleKey } from '../domain/roles';
import { isValidZone, localDate } from '../domain/zone';
import { requireCaller, requireOperator, requireRoles, type RequestContext } from '../http/context';
import { Engine, type Caller } from '../services/engine';
import { publish, publishToUser } from '../services/live';
import { unreadCount } from '../services/notify';
import { pathChecker } from '../services/scope';
import { loadArticles, loadInboxRules, loadSchedules, loadSlaDefinitions } from '../services/store';
import {
  advanceRun,
  latestVersion,
  loadRun,
  loadWorkflows,
  retryRun,
  runJson,
  startRun,
  subflowCycle,
  type StepJson,
} from '../services/workflow';
import { nextNumber } from '../db';
import { numberPrefixes } from '../services/recordops';
import { created, ok, route } from './router';
import { recordChange } from '../services/configsets';

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  return { engine: await Engine.load(caller.workspace), caller };
}

function asTable(name: unknown): TableName {
  const text = String(name ?? '');
  if (!(tableNames as readonly string[]).includes(text)) {
    throw validation('Table is not a table.', { table: 'Table is not a table.' });
  }
  return text as TableName;
}

route('GET', '/api/business-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  return ok({
    business_rules: engine.businessRules.map((r) => ({
      name: r.name,
      table: r.table,
      when: r.when,
      order: r.order,
      operations: r.operations,
      condition: r.condition,
      actions: r.actions,
      active: r.active,
    })),
  });
});

async function upsertBusinessRule(
  workspace: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  const table = asTable(body.table);
  const condition = String(body.condition ?? 'true');
  validateExpression(condition, pathChecker(table));
  const when = String(body.when ?? 'before');
  const actions = Array.isArray(body.actions) ? body.actions : [];
  if (when !== 'before' && actions.some((a) => a !== null && typeof a === 'object' && 'abort' in a)) {
    throw validation('Only before rules can abort.');
  }
  await query(
    `INSERT INTO business_rule (name, table_name, when_run, run_order, operations, condition_expr,
                                actions, active, workspace)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
     ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, when_run = $3, run_order = $4,
       operations = $5::jsonb, condition_expr = $6, actions = $7::jsonb, active = $8`,
    [
      name,
      table,
      when,
      Number(body.order ?? 100),
      JSON.stringify(body.operations ?? ['insert', 'update']),
      condition,
      JSON.stringify(actions),
      body.active !== false,
      workspace,
    ],
  );
  await recordChange(workspace, 'business_rule', name, { name, ...body });
}

route('POST', '/api/business-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await upsertBusinessRule(engine.workspace, name, context.body);
  return created({ business_rule: { name, ...context.body } });
});

route('PUT', '/api/business-rules/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await upsertBusinessRule(engine.workspace, params.name, context.body);
  return ok({ business_rule: { name: params.name, ...context.body } });
});

route('GET', '/api/access-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  return ok({
    access_rules: engine.accessRules.map((r) => ({
      name: r.name,
      type: r.type,
      table: r.table,
      field: r.field,
      operation: r.operation,
      roles: r.roles,
      condition: r.condition,
      active: r.active,
    })),
  });
});

async function upsertAccessRule(
  workspace: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  const table = asTable(body.table);
  const condition = body.condition === null || body.condition === undefined ? null : String(body.condition);
  if (condition !== null) validateExpression(condition, pathChecker(table));
  const type = String(body.type ?? 'row');
  if (!['table', 'row', 'field'].includes(type)) {
    throw validation('Type must be table, row or field.', { type: 'Type must be table, row or field.' });
  }
  const roles = Array.isArray(body.roles) ? body.roles.map(String) : [];
  for (const role of roles) {
    if (!isRoleKey(role)) throw validation(`"${role}" is not a role.`, { roles: `"${role}" is not a role.` });
  }
  await query(
    `INSERT INTO access_rule (name, rule_type, table_name, field, operation, roles, condition_expr,
                              active, workspace)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     ON CONFLICT (workspace, name) DO UPDATE SET rule_type = $2, table_name = $3, field = $4,
       operation = $5, roles = $6::jsonb, condition_expr = $7, active = $8`,
    [
      name,
      type,
      table,
      body.field ?? null,
      String(body.operation ?? 'read'),
      JSON.stringify(roles),
      condition,
      body.active !== false,
      workspace,
    ],
  );
  await recordChange(workspace, 'access_rule', name, { name, ...body });
}

route('POST', '/api/access-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await upsertAccessRule(engine.workspace, name, context.body);
  for (const role of (context.body.roles as string[]) ?? []) {
    for (const person of engine.people.values()) {
      if (person.roles.includes(role as never)) {
        publishToUser(person.username, { topic: 'session', event: 'access', data: { reason: 'rules' } });
      }
    }
  }
  return created({ access_rule: { name, ...context.body } });
});

route('PUT', '/api/access-rules/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await upsertAccessRule(engine.workspace, params.name, context.body);
  for (const person of engine.people.values()) {
    publishToUser(person.username, { topic: 'session', event: 'access', data: { reason: 'rules' } });
  }
  return ok({ access_rule: { name: params.name, ...context.body } });
});

route('GET', '/api/assignment-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  return ok({
    assignment_rules: engine.assignmentRules.map((r) => ({
      name: r.name,
      order: r.order,
      table: r.table,
      condition: r.condition,
      group: r.group,
      active: r.active,
    })),
  });
});

route('POST', '/api/assignment-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  const table = asTable(context.body.table);
  const condition = String(context.body.condition ?? 'true');
  validateExpression(condition, pathChecker(table));
  await query(
    `INSERT INTO assignment_rule (name, run_order, table_name, condition_expr, group_name, active, workspace)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace, name) DO UPDATE SET run_order = $2, table_name = $3, condition_expr = $4,
       group_name = $5, active = $6`,
    [
      name,
      Number(context.body.order ?? 100),
      table,
      condition,
      String(context.body.group ?? ''),
      context.body.active !== false,
      engine.workspace,
    ],
  );
  await recordChange(engine.workspace, 'assignment_rule', name, { name, ...context.body });
  return created({ assignment_rule: { name, ...context.body } });
});

const deskRoles = ['operator', 'technician'] as const;

route('GET', '/api/schedules', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const schedules = await loadSchedules(engine.workspace);
  return ok({
    schedules: schedules.map((s) => ({
      name: s.name,
      time_zone: s.timeZone,
      hours: s.hours,
      holidays: s.holidays,
    })),
  });
});

async function upsertSchedule(
  workspace: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  const zone = String(body.time_zone ?? 'Europe/Berlin');
  if (!isValidZone(zone)) throw validation('Time zone is not a zone.', { time_zone: 'Time zone is not a zone.' });
  await query(
    `INSERT INTO business_schedule (name, time_zone, hours, holidays, workspace)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (name) DO UPDATE SET time_zone = $2, hours = $3::jsonb, holidays = $4::jsonb`,
    [name, zone, JSON.stringify(body.hours ?? {}), JSON.stringify(body.holidays ?? []), workspace],
  );
  await recordChange(workspace, 'schedule', name, { name, ...body });
}

route('POST', '/api/schedules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await upsertSchedule(engine.workspace, name, context.body);
  return created({ schedule: { name, ...context.body } });
});

route('PUT', '/api/schedules/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await upsertSchedule(engine.workspace, params.name, context.body);
  return ok({ schedule: { name: params.name, ...context.body } });
});

route('GET', '/api/sla-definitions', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const definitions = await loadSlaDefinitions(engine.workspace);
  return ok({
    sla_definitions: definitions.map((d) => ({
      name: d.name,
      table: d.table,
      start: d.start,
      pause: d.pause,
      stop: d.stop,
      schedule: d.schedule,
      targets: d.targets,
    })),
  });
});

async function upsertSlaDefinition(
  workspace: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  const table = asTable(body.table);
  const checker = pathChecker(table);
  for (const key of ['start', 'pause', 'stop']) {
    validateExpression(String(body[key] ?? 'true'), checker);
  }
  await query(
    `INSERT INTO sla_definition (name, table_name, start_expr, pause_expr, stop_expr, schedule,
                                 targets, workspace)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, start_expr = $3, pause_expr = $4,
       stop_expr = $5, schedule = $6, targets = $7::jsonb`,
    [
      name,
      table,
      String(body.start ?? 'true'),
      String(body.pause ?? 'false'),
      String(body.stop ?? 'false'),
      String(body.schedule ?? 'Office hours'),
      JSON.stringify(body.targets ?? {}),
      workspace,
    ],
  );
  await recordChange(workspace, 'sla_definition', name, { name, ...body });
}

route('POST', '/api/sla-definitions', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await upsertSlaDefinition(engine.workspace, name, context.body);
  return created({ sla_definition: { name, ...context.body } });
});

route('PUT', '/api/sla-definitions/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await upsertSlaDefinition(engine.workspace, params.name, context.body);
  return ok({ sla_definition: { name: params.name, ...context.body } });
});

route('GET', '/api/workflows', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const flows = await loadWorkflows(engine.workspace);
  return ok({
    workflows: flows.map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind,
      inputs: f.inputs,
      outputs: f.outputs,
      draft: f.draft,
      versions: f.versions,
    })),
  });
});

route('POST', '/api/workflows', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await query(
    `INSERT INTO workflow (id, name, kind, inputs, outputs, draft, workspace)
     VALUES ($1, $1, $2, $3::jsonb, $4::jsonb, '[]'::jsonb, $5)
     ON CONFLICT (workspace, id) DO UPDATE SET kind = $2, inputs = $3::jsonb, outputs = $4::jsonb`,
    [
      name,
      String(context.body.kind ?? 'flow'),
      JSON.stringify(context.body.inputs ?? []),
      JSON.stringify(context.body.outputs ?? []),
      engine.workspace,
    ],
  );
  const flows = await loadWorkflows(engine.workspace);
  const flow = flows.find((f) => f.id === name);
  await recordChange(engine.workspace, 'workflow', name, { name, ...context.body });
  return created({
    workflow: flow
      ? { id: flow.id, name: flow.name, kind: flow.kind, draft: flow.draft, versions: flow.versions }
      : null,
  });
});

route('PUT', '/api/workflows/:id/draft', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const flows = await loadWorkflows(engine.workspace);
  const flow = flows.find((f) => f.id === params.id);
  if (!flow) throw notFound();
  const steps = Array.isArray(context.body.steps) ? (context.body.steps as StepJson[]) : [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.id || seen.has(step.id)) throw validation('Every step needs its own id.', { steps: 'Every step needs its own id.' });
    seen.add(step.id);
  }
  await query(`UPDATE workflow SET draft = $2::jsonb WHERE workspace = $1 AND id = $3`, [
    engine.workspace,
    JSON.stringify(steps),
    params.id,
  ]);
  await recordChange(engine.workspace, 'workflow', params.id, { name: params.id, draft: steps });
  const updated = (await loadWorkflows(engine.workspace)).find((f) => f.id === params.id);
  return ok({ workflow: updated ?? null });
});

route('POST', '/api/workflows/:id/publish', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const flows = await loadWorkflows(engine.workspace);
  const flow = flows.find((f) => f.id === params.id);
  if (!flow) throw notFound();
  const chain = await subflowCycle(engine.workspace, params.id, flow.draft);
  if (chain) {
    throw new ApiError(422, 'subflow_cycle', `This subflow calls itself: ${chain.join(' -> ')}.`);
  }
  const next = ((await latestVersion(engine.workspace, params.id)) ?? 0) + 1;
  await query(
    `INSERT INTO workflow_version (workflow_id, version, steps, created_at, workspace)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [params.id, next, JSON.stringify(flow.draft), now(), engine.workspace],
  );
  await recordChange(engine.workspace, 'workflow', params.id, {
    name: params.id,
    draft: flow.draft,
    published: { version: next, steps: flow.draft },
  });
  publish({ topic: `workflow:${params.id}`, event: 'published', data: { version: next } });
  return created({ version: next });
});

route('POST', '/api/workflows/:id/test-run', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const flows = await loadWorkflows(engine.workspace);
  const flow = flows.find((f) => f.id === params.id);
  if (!flow) throw notFound();
  const number = String(context.body.record ?? '');
  const run = await startRun(engine, params.id, number, { simulated: true, draft: flow.draft });
  return created({ run: runJson(run) });
});

route('GET', '/api/runs/:id', async (context, params) => {
  await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const run = await loadRun(params.id);
  if (!run) throw notFound();
  return ok({ run: runJson(run) });
});

route('POST', '/api/runs/:id/retry', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const run = await loadRun(params.id);
  if (!run) throw notFound();
  const after = await retryRun(engine, run);
  return { status: 202, body: { run: runJson(after) } };
});

route('GET', '/api/knowledge/articles', async (context) => {
  const { engine, caller } = await engineFor(context);
  const q = context.url.searchParams.get('q') ?? '';
  const today = localDate(engine.businessZone, engine.at);
  const visible = (await loadArticles())
    .filter((a) => a.state === 'published')
    .filter((a) => inAudience(a, caller.roles, caller.department))
    .filter((a) => a.validUntil === null || a.validUntil >= today);
  return ok({
    articles: rankArticles(visible, q).map(({ article, score }) => ({
      number: article.number,
      title: article.title,
      score,
      valid_until: article.validUntil,
    })),
  });
});

route('GET', '/api/knowledge/suggest', async (context) => {
  const { engine, caller } = await engineFor(context);
  const text = context.url.searchParams.get('text') ?? '';
  const today = localDate(engine.businessZone, engine.at);
  const visible = (await loadArticles())
    .filter((a) => a.state === 'published')
    .filter((a) => inAudience(a, caller.roles, caller.department))
    .filter((a) => a.validUntil === null || a.validUntil >= today);
  return ok({
    articles: rankArticles(visible, text)
      .slice(0, 3)
      .map(({ article, score }) => ({
        number: article.number,
        title: article.title,
        score,
        valid_until: article.validUntil,
      })),
  });
});

route('GET', '/api/knowledge/articles/:number', async (context, params) => {
  const { caller } = await engineFor(context);
  const articles = await loadArticles();
  const versions = articles.filter((a) => a.number === params.number);
  const article = versions.find((a) => a.state === 'published') ?? versions[versions.length - 1];
  if (!article) throw notFound();
  if (!inAudience(article, caller.roles, caller.department)) throw notFound();
  return ok({
    article: {
      number: article.number,
      version: article.version,
      title: article.title,
      body: article.body,
      keywords: article.keywords,
      state: article.state,
      valid_until: article.validUntil,
      helpful_yes: article.helpfulYes,
      helpful_no: article.helpfulNo,
      audience: { roles: article.audienceRoles, departments: article.audienceDepartments },
    },
  });
});

route('POST', '/api/knowledge/articles', async (context) => {
  const caller = requireRoles(context, [...deskRoles]);
  const number = await transaction((client) => nextNumber(client, numberPrefixes.article));
  const audience = (context.body.audience ?? { roles: [], departments: [] }) as Record<string, unknown>;
  await query(
    `INSERT INTO knowledge_article (number, version, title, body, keywords, state, valid_until,
                                    audience, author)
     VALUES ($1, 1, $2, $3, $4::jsonb, 'draft', $5, $6::jsonb, $7)`,
    [
      number,
      String(context.body.title ?? ''),
      String(context.body.body ?? ''),
      JSON.stringify(context.body.keywords ?? []),
      context.body.valid_until ?? null,
      JSON.stringify(audience),
      caller.username,
    ],
  );
  return created({ article: { number, version: 1, state: 'draft' } });
});

route('PUT', '/api/knowledge/articles/:number', async (context, params) => {
  const caller = requireRoles(context, [...deskRoles]);
  const articles = await loadArticles();
  const versions = articles.filter((a) => a.number === params.number);
  if (versions.length === 0) throw notFound();
  const latest = versions[versions.length - 1];
  // Editing a published article creates a new draft version.
  const version = latest.state === 'published' ? latest.version + 1 : latest.version;
  await query(
    `INSERT INTO knowledge_article (number, version, title, body, keywords, state, valid_until,
                                    audience, author)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6, $7::jsonb, $8)
     ON CONFLICT (number, version) DO UPDATE SET title = $3, body = $4, keywords = $5::jsonb,
       valid_until = $6, audience = $7::jsonb`,
    [
      params.number,
      version,
      String(context.body.title ?? latest.title),
      String(context.body.body ?? latest.body),
      JSON.stringify(context.body.keywords ?? latest.keywords),
      context.body.valid_until ?? latest.validUntil,
      JSON.stringify(
        context.body.audience ?? { roles: latest.audienceRoles, departments: latest.audienceDepartments },
      ),
      caller.username,
    ],
  );
  return ok({ article: { number: params.number, version, state: 'draft' } });
});

async function moveArticle(number: string, to: Article['state']): Promise<Article> {
  const articles = await loadArticles();
  const versions = articles.filter((a) => a.number === number);
  if (versions.length === 0) throw notFound();
  const article = versions[versions.length - 1];
  if (!articleTransitions[article.state].includes(to)) {
    throw new ApiError(
      422,
      'illegal_transition',
      `Cannot move article from ${article.state} to ${to}.`,
    );
  }
  await query(
    `UPDATE knowledge_article SET state = $3, published_at = CASE WHEN $3 = 'published' THEN $4 ELSE published_at END
     WHERE number = $1 AND version = $2`,
    [number, article.version, to, now()],
  );
  return { ...article, state: to };
}

route('POST', '/api/knowledge/articles/:number/submit', async (context, params) => {
  requireRoles(context, [...deskRoles]);
  const article = await moveArticle(params.number, 'in_review');
  return ok({ article: { number: article.number, version: article.version, state: article.state } });
});

route('POST', '/api/knowledge/articles/:number/approve', async (context, params) => {
  requireOperator(context);
  const article = await moveArticle(params.number, 'published');
  return ok({ article: { number: article.number, version: article.version, state: article.state } });
});

route('POST', '/api/knowledge/articles/:number/retire', async (context, params) => {
  requireOperator(context);
  const article = await moveArticle(params.number, 'retired');
  return ok({ article: { number: article.number, version: article.version, state: article.state } });
});

route('PUT', '/api/knowledge/articles/:number/vote', async (context, params) => {
  const caller = requireCaller(context);
  const articles = await loadArticles();
  const versions = articles.filter((a) => a.number === params.number);
  const article = versions.find((a) => a.state === 'published') ?? versions[versions.length - 1];
  if (!article) throw notFound();
  if (!inAudience(article, caller.roles, caller.department)) throw notFound();
  const helpful = context.body.helpful === true;
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO knowledge_vote (number, version, username, helpful) VALUES ($1, $2, $3, $4)
       ON CONFLICT (number, version, username) DO UPDATE SET helpful = $4`,
      [article.number, article.version, caller.username, helpful],
    );
    const counts = await client.query<{ yes: string; no: string }>(
      `SELECT count(*) FILTER (WHERE helpful) AS yes, count(*) FILTER (WHERE NOT helpful) AS no
       FROM knowledge_vote WHERE number = $1 AND version = $2`,
      [article.number, article.version],
    );
    await client.query(
      `UPDATE knowledge_article SET helpful_yes = $3, helpful_no = $4 WHERE number = $1 AND version = $2`,
      [article.number, article.version, Number(counts.rows[0].yes), Number(counts.rows[0].no)],
    );
  });
  const after = (await loadArticles()).find(
    (a) => a.number === article.number && a.version === article.version,
  );
  return ok({ helpful_yes: after?.helpfulYes ?? 0, helpful_no: after?.helpfulNo ?? 0 });
});

route('GET', '/api/inbox', async (context) => {
  const caller = requireCaller(context);
  const rows = await query<{
    id: string;
    event: string;
    text: string;
    number: string | null;
    at: Date;
    read: boolean;
  }>(
    `SELECT id, event, text, number, at, read FROM inbox_item
     WHERE username = $1 AND NOT pending_digest ORDER BY id DESC`,
    [caller.username],
  );
  return ok({
    items: rows.map((r) => ({
      id: Number(r.id),
      event: r.event,
      text: r.text,
      record: r.number,
      at: iso(r.at),
      read: r.read,
    })),
    unread: rows.filter((r) => !r.read).length,
  });
});

route('POST', '/api/inbox/:id/read', async (context, params) => {
  const caller = requireCaller(context);
  await query(`UPDATE inbox_item SET read = TRUE WHERE id = $1 AND username = $2`, [
    Number(params.id),
    caller.username,
  ]);
  const unread = await transaction((client) => unreadCount(client, caller.username));
  publish({ topic: 'inbox', event: 'unread', data: { username: caller.username, unread } });
  return ok({ unread });
});

route('POST', '/api/inbox/read-all', async (context) => {
  const caller = requireCaller(context);
  await query(`UPDATE inbox_item SET read = TRUE WHERE username = $1`, [caller.username]);
  publish({ topic: 'inbox', event: 'unread', data: { username: caller.username, unread: 0 } });
  return ok({ unread: 0 });
});

route('PUT', '/api/inbox/settings', async (context) => {
  const caller = requireCaller(context);
  const digest = context.body.digest === 'daily' ? 'daily' : 'immediate';
  await query(`UPDATE person SET digest = $2 WHERE username = $1`, [caller.username, digest]);
  return ok({ digest });
});

route('GET', '/api/inbox-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const rules = await loadInboxRules(engine.workspace);
  return ok({ rules });
});

route('PUT', '/api/inbox-rules', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const rules = Array.isArray(context.body.rules) ? context.body.rules : [];
  await transaction(async (client) => {
    await client.query(`DELETE FROM inbox_rule WHERE workspace = $1`, [engine.workspace]);
    for (const rule of rules as Record<string, unknown>[]) {
      const event = String(rule.event ?? '');
      if (!(inboxEvents as readonly string[]).includes(event)) {
        throw validation(`"${event}" is not an event.`, { event: `"${event}" is not an event.` });
      }
      await client.query(
        `INSERT INTO inbox_rule (event, roles, enabled, workspace) VALUES ($1, $2::jsonb, $3, $4)`,
        [event, JSON.stringify(rule.roles ?? []), rule.enabled !== false, engine.workspace],
      );
    }
  });
  await recordChange(engine.workspace, 'inbox_rule', 'rules', { rules });
  return ok({ rules });
});

export { advanceRun, distinctTokens, scoreArticle, nowMs, conflict };
