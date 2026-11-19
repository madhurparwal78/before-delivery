// Configuration endpoints: rules, schedules, SLA definitions, boards, users,
// groups, knowledge, filters, reports, dashboards, workflows.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, operatorOnly } from '../errors.js';
import { clock } from '../db.js';
import { ExpressionError, parse as parseExpr } from '../../express/expression.js';
import { FilterTooComplex, parseFilter, compose } from '../../express/filter.js';

export async function config(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  // Knowledge
  if (path === '/api/knowledge/articles' && method === 'GET') return knowledgeList(route);
  if (path === '/api/knowledge/suggest' && method === 'GET') return knowledgeSuggest(route);
  if (path === '/api/knowledge/articles' && method === 'POST') return knowledgeCreate(route, user);
  const articleMatch = /^\/api\/knowledge\/articles\/(ART-\d+)$/.exec(path);
  if (articleMatch && method === 'GET') return knowledgeRead(route, user, articleMatch[1]);
  if (articleMatch && method === 'PUT') return knowledgeUpdate(route, user, articleMatch[1]);
  const articleAction = /^\/api\/knowledge\/articles\/(ART-\d+)\/(submit|approve|retire|vote)$/.exec(path);
  if (articleAction && method === 'POST') return knowledgeAction(route, user, articleAction[1], articleAction[2]);

  // Filters
  if (path === '/api/filters' && method === 'GET') return filtersList(route);
  if (path === '/api/filters' && method === 'POST') return filtersCreate(route, user);
  if (path === '/api/filters/parse' && method === 'POST') return filtersParse(route);
  if (path === '/api/filters/compose' && method === 'POST') return filtersCompose(route);

  // Reports and dashboards
  if (path === '/api/reports/aggregate' && method === 'POST') return reportAggregate(route, user);
  const dashMatch = /^\/api\/dashboards\/([a-z0-9-]+)$/.exec(path);
  if (dashMatch && method === 'GET') return dashboardRead(route, user, dashMatch[1]);

  // Workflows and runs
  if (path === '/api/workflows' && method === 'GET') return workflowsList(route, user);
  if (path === '/api/workflows' && method === 'POST') return workflowCreate(route, user);
  const wfMatch = /^\/api\/workflows\/(\d+)(\/draft|\/publish|\/test-run)?$/.exec(path);
  if (wfMatch && method === 'PUT' && wfMatch[2] === '/draft') return workflowDraft(route, user, Number(wfMatch[1]));
  if (wfMatch && method === 'POST' && wfMatch[2] === '/publish') return workflowPublish(route, user, Number(wfMatch[1]));
  if (wfMatch && method === 'POST' && wfMatch[2] === '/test-run') return workflowTestRun(route, user, Number(wfMatch[1]));
  const runMatch = /^\/api\/runs\/(\d+)$/.exec(path);
  if (runMatch && method === 'GET') return runRead(route, user, Number(runMatch[1]));
  const retryMatch = /^\/api\/runs\/(\d+)\/retry$/.exec(path);
  if (retryMatch && method === 'POST') return runRetry(route, user, Number(retryMatch[1]));

  // Admin kinds
  const kind = adminKind(path);
  if (kind) {
    if (method === 'GET' && path === kind.list) return adminList(route, kind.table);
    if (method === 'POST' && path === kind.list) return adminCreate(route, user, kind.table);
    const one = kind.onePattern.exec(path);
    if (one && method === 'PUT') return adminUpdate(route, user, kind.table, one[1]);
  }

  // Schedules
  if (path === '/api/schedules' && method === 'GET') return scheduleList(route);
  if (path === '/api/schedules' && method === 'POST') return scheduleCreate(route, user);
  const schedMatch = /^\/api\/schedules\/([^/]+)$/.exec(path);
  if (schedMatch && method === 'PUT') return scheduleUpdate(route, user, schedMatch[1]);

  // SLA definitions
  if (path === '/api/sla-definitions' && method === 'GET') return slaList(route);
  if (path === '/api/sla-definitions' && method === 'POST') return slaCreate(route, user);
  const slaOne = /^\/api\/sla-definitions\/([^/]+)$/.exec(path);
  if (slaOne && method === 'PUT') return slaUpdate(route, user, slaOne[1]);

  // Boards
  if (path === '/api/boards' && method === 'GET') return boardList(route);
  if (path === '/api/boards' && method === 'POST') return boardCreate(route, user);
  const boardOne = /^\/api\/boards\/([^/]+)$/.exec(path);
  if (boardOne && method === 'PUT') return boardUpdate(route, user, boardOne[1]);

  // Groups and users
  if (path === '/api/groups' && method === 'GET') return groupList(route);
  if (path === '/api/groups' && method === 'POST') return groupCreate(route, user);
  const groupOne = /^\/api\/groups\/([^/]+)$/.exec(path);
  if (groupOne && method === 'PATCH') return groupUpdate(route, user, groupOne[1]);
  if (path === '/api/users' && method === 'POST') return userCreate(route, user);
  const userOne = /^\/api\/users\/([^/]+)$/.exec(path);
  if (userOne && method === 'PATCH') return userUpdate(route, user, userOne[1]);
  const delegateMatch = /^\/api\/users\/([^/]+)\/delegate$/.exec(path);
  if (delegateMatch && method === 'PUT') return userDelegate(route, user, delegateMatch[1]);

  // Impersonation and audit log
  if (path === '/api/impersonate' && method === 'POST') return impersonate(route, user);
  if (path === '/api/impersonate' && method === 'DELETE') return stopImpersonate(route, user);
  if (path === '/api/audit-log' && method === 'GET') return auditLog(route, user);
  if (path === '/api/session/workspace' && method === 'PUT') return setWorkspace(route, user);

  return false;
}

interface AdminKind { list: string; table: string; onePattern: RegExp }

function adminKind(path: string): AdminKind | null {
  const kinds: Array<[string, string]> = [
    ['/api/business-rules', 'business_rules'],
    ['/api/access-rules', 'access_rules'],
    ['/api/assignment-rules', 'assignment_rules'],
    ['/api/form-policies', 'form_policies'],
    ['/api/freeze-windows', 'freeze_windows'],
    ['/api/escalation-policies', 'escalation_policies'],
    ['/api/rotations', 'rotations'],
  ];
  for (const [list, table] of kinds) {
    if (path === list || path.startsWith(list + '/')) {
      return { list, table, onePattern: new RegExp(`^${list}/([^/]+)$`) };
    }
  }
  return null;
}

async function adminList(route: RouteContext, table: string): Promise<boolean> {
  const ws = workspaceOf(route);
  const hasWorkspace = await tableHasWorkspace(route.ctx.db, table);
  const res = hasWorkspace
    ? await route.ctx.db.query(`SELECT * FROM ${table} WHERE workspace = $1 ORDER BY name`, [ws])
    : await route.ctx.db.query(`SELECT * FROM ${table} ORDER BY name`);
  sendJson(route.res, 200, { records: res.rows });
  return true;
}

/** The session workspace; test holds configuration being prepared. */
function workspaceOf(route: RouteContext): 'live' | 'test' {
  return route.session?.workspace === 'test' ? 'test' : 'live';
}

async function tableHasWorkspace(db: RouteContext['ctx']['db'], table: string): Promise<boolean> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = 'workspace'`,
    [table],
  );
  return Number(res.rows[0].n) > 0;
}

async function adminCreate(route: RouteContext, user: SessionUser, table: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  if (typeof body.condition === 'string' && typeof body.table === 'string') {
    await validateTableCondition(body.condition, body.table);
  } else if (typeof body.condition === 'string') {
    await validateCondition(body.condition);
  }
  const { columns, params } = buildInsert(table, body);
  const hasWorkspace = await tableHasWorkspace(route.ctx.db, table);
  if (hasWorkspace) {
    columns.push('"workspace"');
    params.push(workspaceOf(route));
  }
  const res = await route.ctx.db.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${params.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    params,
  );
  // A captured kind created in the test workspace records in the open set.
  if (workspaceOf(route) === 'test') await captureInOpenSet(route, table, String(body.name ?? ''));
  sendJson(route.res, 201, { record: res.rows[0] });
  return true;
}

async function adminUpdate(route: RouteContext, user: SessionUser, table: string, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  if (typeof body.condition === 'string' && typeof body.table === 'string') {
    await validateTableCondition(body.condition, body.table);
  } else if (typeof body.condition === 'string') {
    await validateCondition(body.condition);
  }
  const { sets, params } = buildUpdate(table, body);
  if (!sets.length) {
    const res = await route.ctx.db.query(`SELECT * FROM ${table} WHERE name = $1`, [name]);
    if (!res.rows.length) throw notFound();
    sendJson(route.res, 200, { record: res.rows[0] });
    return true;
  }
  const res = await route.ctx.db.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE name = $${params.length + 1} RETURNING *`,
    [...params, name],
  );
  if (!res.rows.length) throw notFound();
  await captureInOpenSet(route, table, name);
  sendJson(route.res, 200, { record: res.rows[0] });
  return true;
}

/** Captured kinds record their latest content in the open set. */
async function captureInOpenSet(route: RouteContext, table: string, name: string): Promise<void> {
  const captured: Record<string, string> = {
    business_rules: 'business_rule',
    access_rules: 'access_rule',
    assignment_rules: 'assignment_rule',
    form_policies: 'form_policy',
    sla_definitions: 'sla_definition',
    schedules: 'schedule',
    catalog_items: 'catalog_item',
    inbox_rules: 'inbox_rule',
  };
  const kind = captured[table];
  if (!kind || !name) return;

  const open = await route.ctx.db.query(
    `SELECT id FROM config_sets WHERE state IN ('open', 'exported') ORDER BY id DESC LIMIT 1`,
  );
  if (!open.rows.length) return;

  const content = await latestContent(route, table, name);
  const row = await route.ctx.db.query(`SELECT * FROM ${table} WHERE name = $1`, [name]);
  if (!row.rows.length) return;

  const items = await loadSetItems(route.ctx.db, Number(open.rows[0].id));
  const entry = { kind, name, deleted: false, content };
  const existing = items.findIndex(i => i.kind === kind && i.name === name);
  if (existing >= 0) items[existing] = entry;
  else items.push(entry);
  await route.ctx.db.query(`UPDATE config_sets SET items = $2 WHERE id = $1`, [Number(open.rows[0].id), JSON.stringify(items)]);
}

async function loadSetItems(db: RouteContext['ctx']['db'], setId: number): Promise<Array<{ kind: string; name: string; deleted: boolean; content: unknown }>> {
  const res = await db.query(`SELECT items FROM config_sets WHERE id = $1`, [setId]);
  if (!res.rows.length) return [];
  return (res.rows[0].items ?? []) as Array<{ kind: string; name: string; deleted: boolean; content: unknown }>;
}

/** The capture body of a captured kind: its create body. */
async function latestContent(route: RouteContext, table: string, name: string): Promise<unknown> {
  const row = await route.ctx.db.query(`SELECT * FROM ${table} WHERE name = $1`, [name]);
  if (!row.rows.length) return null;
  const record = row.rows[0] as Record<string, unknown>;
  const mapping = columnMap(table);
  const content: Record<string, unknown> = { name };
  for (const [key, column] of Object.entries(mapping)) {
    if (column === 'name') continue;
    let value = record[column];
    if (['actions', 'targets', 'members', 'hours', 'levels'].includes(key) && typeof value === 'string') {
      try { value = JSON.parse(value); } catch { /* keep as stored */ }
    }
    content[key] = value ?? null;
  }
  if (table === 'workflows') {
    const versions = await route.ctx.db.query(`SELECT version, steps FROM workflow_versions WHERE workflow = $1 AND NOT withdrawn ORDER BY version DESC LIMIT 1`, [record.id]);
    content.published = versions.rows.length ? { version: Number(versions.rows[0].version), steps: versions.rows[0].steps } : null;
    content.draft = record.draft;
  }
  return content;
}

function buildInsert(table: string, body: Record<string, unknown>): { columns: string[]; params: unknown[] } {
  const map = columnMap(table);
  const columns: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(map)) {
    if (!(key in body)) continue;
    columns.push(`"${column}"`);
    params.push(valueFor(table, key, body[key]));
  }
  return { columns, params };
}

function buildUpdate(table: string, body: Record<string, unknown>): { sets: string[]; params: unknown[] } {
  const map = columnMap(table);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(map)) {
    if (!(key in body)) continue;
    params.push(valueFor(table, key, body[key]));
    sets.push(`"${column}" = $${params.length}`);
  }
  return { sets, params };
}

function valueFor(table: string, key: string, value: unknown): unknown {
  if (['actions', 'targets', 'members', 'hours', 'levels'].includes(key)) return JSON.stringify(value);
  if (key === 'start' || key === 'end') return value === null ? null : new Date(String(value));
  if (key === 'scope') {
    // scope: "all" or {items: [...]}
    if (value === 'all') return 'all';
    const items = (value as { items?: string[] })?.items ?? [];
    return items.length ? 'items' : 'all';
  }
  void table;
  return value;
}

function columnMap(table: string): Record<string, string> {
  const maps: Record<string, Record<string, string>> = {
    business_rules: { name: 'name', table: 'table', when: 'when', order: 'order', operations: 'operations', condition: 'condition', actions: 'actions', active: 'active' },
    access_rules: { name: 'name', type: 'type', table: 'table', field: 'field', operation: 'operation', roles: 'roles', condition: 'condition', active: 'active' },
    assignment_rules: { name: 'name', order: 'order', table: 'table', condition: 'condition', group: 'group', active: 'active' },
    form_policies: { name: 'name', table: 'table', catalog_item: 'catalog_item', order: 'order', condition: 'condition', actions: 'actions' },
    freeze_windows: { name: 'name', start: 'start', end: 'end', time_zone: 'time_zone', scope: 'scope_kind' },
    escalation_policies: { name: 'name', levels: 'levels' },
    rotations: { name: 'name', time_zone: 'time_zone', handover_weekday: 'handover_weekday', handover_time: 'handover_time', members: 'members', anchor_date: 'anchor_date' },
  };
  return maps[table] ?? {};
}

export async function validateCondition(text: string): Promise<void> {
  try {
    parseExpr(text);
  } catch (e) {
    if (e instanceof ExpressionError) {
      throw new ApiError(422, 'expression_error', e.message);
    }
    throw e;
  }
}

/** Validate a condition against its table's known paths. */
export async function validateTableCondition(text: string, table: string): Promise<void> {
  try {
    const tree = parseExpr(text);
    const { knownPath } = await import('../recordengine.js');
    if (!['incident', 'problem', 'change', 'request_item', 'task'].includes(table)) return;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.kind === 'path' && !knownPath(table as never, String((n as { parts: string[] }).parts.join('.')))) {
        throw new ExpressionError((n as { column: number }).column, `unknown field "${(n as { parts: string[] }).parts.join('.')}"`);
      }
      for (const value of Object.values(n)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(tree);
  } catch (e) {
    if (e instanceof ExpressionError) {
      throw new ApiError(422, 'expression_error', e.message);
    }
    throw e;
  }
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'not', 'from', 'this', 'that', 'are', 'was', 'has', 'have', 'you', 'your', 'can', 'cannot']);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

interface ScoredArticle { row: Record<string, unknown>; score: number; number: string; published: number }

/** Published, in-audience, unexpired articles scored by the published formula.
 *  An article is unexpired when valid_until is empty or not before today's
 *  date in the business time zone. */
async function scoreArticles(db: RouteContext['ctx']['db'], q: string, now: number): Promise<ScoredArticle[]> {
  const res = await db.query(
    `SELECT number, title, keywords, body, helpful_yes, helpful_no, valid_until, audience_roles, audience_departments, published_at FROM articles WHERE state = 'published'`,
  );
  const { dateStr } = await import('../../shared/time.js');
  const today = dateStr(now, String(process.env.BUSINESS_TIME_ZONE ?? 'Europe/Berlin'));
  const queryTokens = tokens(q);
  const scored: ScoredArticle[] = [];
  for (const row of res.rows) {
    // Expired articles are excluded from search and suggestions.
    if (row.valid_until && String(row.valid_until) < today) continue;
    const titleTokens = new Set(tokens(String(row.title)));
    const keywordTokens = new Set(((row.keywords ?? []) as string[]).flatMap(k => tokens(k)));
    const bodyTokens = new Set(tokens(String(row.body)));
    const T = queryTokens.filter(t => titleTokens.has(t)).length;
    const K = queryTokens.filter(t => keywordTokens.has(t)).length;
    const B = queryTokens.filter(t => bodyTokens.has(t)).length;
    if (T + K + B < 1) continue;
    const net = Math.max(Number(row.helpful_yes) - Number(row.helpful_no), 0);
    const score = 5 * T + 2 * K + B + Math.min(net, 5);
    const published = row.published_at ? new Date(row.published_at as Date).getTime() : 0;
    scored.push({ row, score, number: String(row.number), published });
  }
  scored.sort((a, b) => b.score - a.score || b.published - a.published || (a.number < b.number ? -1 : 1));
  return scored;
}

async function knowledgeList(route: RouteContext): Promise<boolean> {
  const q = route.url.searchParams.get('q') ?? '';
  const scored = await scoreArticles(route.ctx.db, q, clock.nowMs());
  sendJson(route.res, 200, {
    articles: scored.map(s => ({ number: s.number, title: s.row.title, score: s.score, valid_until: s.row.valid_until ?? null })),
  });
  return true;
}

async function knowledgeSuggest(route: RouteContext): Promise<boolean> {
  const text = route.url.searchParams.get('text') ?? '';
  const scored = await scoreArticles(route.ctx.db, text, clock.nowMs());
  sendJson(route.res, 200, {
    articles: scored.slice(0, 3).map(s => ({ number: s.number, title: s.row.title, score: s.score, valid_until: s.row.valid_until ?? null })),
  });
  return true;
}

async function knowledgeCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const body = route.body as { title: string; body: string; keywords?: string[]; valid_until?: string; audience?: { roles?: string[]; departments?: string[] } };
  const { allocateNamedNumber } = await import('../recordengine.js');
  const number = await allocateNamedNumber(route.ctx.db, 'article');
  await route.ctx.db.query(
    `INSERT INTO articles(number, title, body, keywords, state, valid_until, helpful_yes, helpful_no, audience_roles, audience_departments, author)
     VALUES ($1,$2,$3,$4,'draft',$5,0,0,$6,$7,$8)`,
    [number, body.title, body.body, body.keywords ?? [], body.valid_until ?? null, body.audience?.roles ?? [], body.audience?.departments ?? [], user.username],
  );
  sendJson(route.res, 201, { article: { number } });
  return true;
}

async function knowledgeRead(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT * FROM articles WHERE number = $1`, [number]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  const roles = (row.audience_roles ?? []) as string[];
  const departments = (row.audience_departments ?? []) as string[];
  if (roles.length && !roles.some(r => user.roles.includes(r as never))) throw notFound();
  if (departments.length && !departments.includes(user.department)) throw notFound();
  sendJson(route.res, 200, {
    article: {
      number: row.number, version: row.version, title: row.title, body: row.body,
      keywords: row.keywords, state: row.state, valid_until: row.valid_until,
      helpful_yes: row.helpful_yes, helpful_no: row.helpful_no,
      audience: { roles, departments },
    },
  });
  return true;
}

async function knowledgeUpdate(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const body = route.body as { title: string; body: string; keywords?: string[]; valid_until?: string; audience?: { roles?: string[]; departments?: string[] } };
  await route.ctx.db.query(
    `UPDATE articles SET title = $2, body = $3, keywords = $4, valid_until = $5, audience_roles = $6, audience_departments = $7 WHERE number = $1`,
    [number, body.title, body.body, body.keywords ?? [], body.valid_until ?? null, body.audience?.roles ?? [], body.audience?.departments ?? []],
  );
  sendJson(route.res, 200, { article: { number } });
  return true;
}

async function knowledgeAction(route: RouteContext, user: SessionUser, number: string, action: string): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT state FROM articles WHERE number = $1`, [number]);
  if (!res.rows.length) throw notFound();
  const state = String(res.rows[0].state);
  const next = (from: string, to: string): void => {
    if (state !== from) throw new ApiError(422, 'illegal_transition', `Cannot move article from ${from} to ${to}.`);
  };
  if (action === 'submit') {
    next('draft', 'in_review');
    await route.ctx.db.query(`UPDATE articles SET state = 'in_review' WHERE number = $1`, [number]);
  } else if (action === 'approve') {
    if (!user.roles.includes('operator')) throw operatorOnly();
    next('in_review', 'published');
    await route.ctx.db.query(`UPDATE articles SET state = 'published', published_at = now() WHERE number = $1`, [number]);
  } else if (action === 'retire') {
    if (!user.roles.includes('operator')) throw operatorOnly();
    if (state !== 'published') throw new ApiError(422, 'illegal_transition', `Cannot move article from ${state} to retired.`);
    await route.ctx.db.query(`UPDATE articles SET state = 'retired' WHERE number = $1`, [number]);
  } else if (action === 'vote') {
    await route.ctx.db.query(
      `INSERT INTO article_votes(article, username, helpful) VALUES ($1,$2,$3)
       ON CONFLICT (article, username) DO UPDATE SET helpful = $3`,
      [number, user.username, Boolean(route.body.helpful)],
    );
    const counts = await route.ctx.db.query(
      `SELECT count(*) FILTER (WHERE helpful) AS yes, count(*) FILTER (WHERE NOT helpful) AS no FROM article_votes WHERE article = $1`,
      [number],
    );
    await route.ctx.db.query(`UPDATE articles SET helpful_yes = $2, helpful_no = $3 WHERE number = $1`, [number, Number(counts.rows[0].yes), Number(counts.rows[0].no)]);
    sendJson(route.res, 200, { helpful_yes: Number(counts.rows[0].yes), helpful_no: Number(counts.rows[0].no) });
    return true;
  }
  sendJson(route.res, 200, { article: { number } });
  return true;
}

async function filtersList(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT id, name, "table", filter, shared FROM filters ORDER BY name`);
  sendJson(route.res, 200, { filters: res.rows });
  return true;
}

async function filtersCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  const body = route.body;
  const res = await route.ctx.db.query(
    `INSERT INTO filters(name, "table", filter, shared, owner) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [body.name, body.table, body.filter, Boolean(body.shared), user.username],
  );
  sendJson(route.res, 201, { filter: { id: res.rows[0].id, ...body } });
  return true;
}

async function filtersParse(route: RouteContext): Promise<boolean> {
  const body = route.body;
  try {
    const known = await knownFields(route, String(body.table));
    const { builder, filter } = parseFilter(String(body.filter ?? ''), known);
    sendJson(route.res, 200, { builder, filter });
  } catch (e) {
    if (e instanceof FilterTooComplex) throw new ApiError(422, 'filter_too_complex', e.message);
    throw e;
  }
  return true;
}

async function filtersCompose(route: RouteContext): Promise<boolean> {
  const body = route.body;
  const builder = body.builder as { connector: string; groups: Array<{ connector: string; conditions: Array<{ path: string }> }> };
  const known = await knownFields(route, String(body.table));
  for (const group of builder.groups ?? []) {
    for (const c of group.conditions ?? []) {
      if (!known(c.path)) throw new ApiError(422, 'unknown_field', `Unknown field "${c.path}".`);
    }
  }
  const filter = compose(builder as never);
  sendJson(route.res, 200, { filter });
  return true;
}

export async function knownFields(route: RouteContext, table: string): Promise<(path: string) => boolean> {
  const { knownPath } = await import('../recordengine.js');
  if (!['incident', 'problem', 'change', 'request_item', 'task'].includes(table)) return () => false;
  return (path: string) => knownPath(table as never, path);
}

async function reportAggregate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician') || user.roles.includes('manager'))) throw forbidden();
  const body = route.body;
  const { aggregate } = await import('./aggregate.js');
  const result = await aggregate(route, user, String(body.table), String(body.filter ?? ''), body.group_by ? String(body.group_by) : null);
  sendJson(route.res, 200, result);
  return true;
}

async function dashboardRead(route: RouteContext, user: SessionUser, id: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician') || user.roles.includes('manager'))) throw forbidden();
  const res = await route.ctx.db.query(`SELECT id, name, widgets FROM dashboards WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const { computeWidgets } = await import('./aggregate.js');
  const widgets = await computeWidgets(route, user, res.rows[0].widgets);
  sendJson(route.res, 200, { dashboard: { id, name: res.rows[0].name, time_zone: user.time_zone, widgets } });
  return true;
}

async function workflowsList(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw forbidden();
  const res = await route.ctx.db.query(`SELECT id, name, kind, draft FROM workflows ORDER BY name`);
  const out: unknown[] = [];
  for (const row of res.rows) {
    const versions = await route.ctx.db.query(
      `SELECT version FROM workflow_versions WHERE workflow = $1 AND NOT withdrawn ORDER BY version`,
      [row.id],
    );
    out.push({ id: row.id, name: row.name, kind: row.kind, draft: row.draft, versions: versions.rows.map((v: Record<string, unknown>) => Number(v.version)) });
  }
  sendJson(route.res, 200, { workflows: out });
  return true;
}

async function workflowCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  const res = await route.ctx.db.query(
    `INSERT INTO workflows(name, kind, inputs, outputs, draft) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [body.name, body.kind ?? 'flow', JSON.stringify(body.inputs ?? []), JSON.stringify(body.outputs ?? []), JSON.stringify([])],
  );
  sendJson(route.res, 201, { workflow: { id: res.rows[0].id, name: body.name, kind: body.kind ?? 'flow', draft: [], versions: [] } });
  return true;
}

async function workflowDraft(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const steps = route.body.steps ?? [];
  const { validateSteps } = await import('../workflows.js');
  const error = validateSteps(steps as never);
  if (error) throw new ApiError(422, 'validation', error);
  const row = await route.ctx.db.query(`UPDATE workflows SET draft = $2 WHERE id = $1 RETURNING id, name, kind, draft`, [id, JSON.stringify(steps)]);
  if (!row.rows.length) throw notFound();
  const versions = await route.ctx.db.query(`SELECT version FROM workflow_versions WHERE workflow = $1 AND NOT withdrawn ORDER BY version`, [id]);
  sendJson(route.res, 200, {
    workflow: { id, name: row.rows[0].name, kind: row.rows[0].kind, draft: steps, versions: versions.rows.map((v: Record<string, unknown>) => Number(v.version)) },
  });
  return true;
}

async function workflowPublish(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const row = await route.ctx.db.query(`SELECT name, draft FROM workflows WHERE id = $1`, [id]);
  if (!row.rows.length) throw notFound();
  const name = String(row.rows[0].name);
  const draft = row.rows[0].draft as unknown[];
  const { findSubflowCycle, validateSteps } = await import('../workflows.js');
  const error = validateSteps(draft as never);
  if (error) throw new ApiError(422, 'validation', error);

  const latest = new Map<string, never[]>();
  const all = await route.ctx.db.query(`
    SELECT w.name, (
      SELECT v.steps FROM workflow_versions v
      WHERE v.workflow = w.id AND NOT v.withdrawn
      ORDER BY v.version DESC LIMIT 1
    ) AS steps FROM workflows w`);
  for (const w of all.rows) {
    if (w.steps) latest.set(String(w.name), w.steps as never[]);
  }
  latest.set(name, draft as never[]);
  const cycle = findSubflowCycle(name, latest);
  if (cycle) throw new ApiError(422, 'subflow_cycle', `This subflow calls itself: ${cycle.join(' -> ')}.`);

  const nextRes = await route.ctx.db.query(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM workflow_versions WHERE workflow = $1`, [id]);
  const version = Number(nextRes.rows[0].v);
  await route.ctx.db.query(`INSERT INTO workflow_versions(workflow, version, steps, published_at) VALUES ($1,$2,$3,$4)`, [id, version, JSON.stringify(draft), new Date()]);
  sendJson(route.res, 201, { version });
  return true;
}

async function workflowTestRun(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const record = String(route.body.record ?? '');
  const { startRun } = await import('../runengine.js');
  const runId = await startRun(route.ctx, id, null, record, true);
  sendJson(route.res, 201, { run: { id: runId } });
  return true;
}

async function runRead(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const res = await route.ctx.db.query(`SELECT * FROM runs WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  const wf = await route.ctx.db.query(`SELECT name FROM workflows WHERE id = $1`, [row.workflow]);
  sendJson(route.res, 200, {
    run: {
      id: row.id,
      workflow: wf.rows.length ? String(wf.rows[0].name) : null,
      version: row.version,
      record: row.record,
      status: row.status,
      steps: row.steps,
    },
  });
  return true;
}

async function runRetry(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const { retryRun } = await import('../runengine.js');
  const run = await retryRun(route.ctx, id);
  sendJson(route.res, 202, { run });
  return true;
}

async function scheduleList(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT name, time_zone, hours, holidays FROM schedules ORDER BY name`);
  sendJson(route.res, 200, { schedules: res.rows });
  return true;
}

async function scheduleCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(`INSERT INTO schedules(name, time_zone, hours, holidays) VALUES ($1,$2,$3,$4)`, [body.name, body.time_zone, JSON.stringify(body.hours), body.holidays ?? []]);
  sendJson(route.res, 201, { schedule: body });
  return true;
}

async function scheduleUpdate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(`UPDATE schedules SET time_zone = $2, hours = $3, holidays = $4 WHERE name = $1`, [name, body.time_zone, JSON.stringify(body.hours), body.holidays ?? []]);
  sendJson(route.res, 200, { schedule: { name, ...body } });
  return true;
}

async function slaList(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT name, "table", start_expr, pause_expr, stop_expr, schedule, targets FROM sla_definitions ORDER BY name`);
  sendJson(route.res, 200, {
    sla_definitions: res.rows.map((r: Record<string, unknown>) => ({
      name: r.name, table: r.table, start: r.start_expr, pause: r.pause_expr, stop: r.stop_expr, schedule: r.schedule, targets: r.targets,
    })),
  });
  return true;
}

async function slaCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await validateCondition(String(body.start));
  await validateCondition(String(body.pause));
  await validateCondition(String(body.stop));
  await route.ctx.db.query(
    `INSERT INTO sla_definitions(name, "table", start_expr, pause_expr, stop_expr, schedule, targets) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [body.name, body.table, body.start, body.pause, body.stop, body.schedule, JSON.stringify(body.targets)],
  );
  sendJson(route.res, 201, { sla_definition: body });
  return true;
}

async function slaUpdate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await validateCondition(String(body.start));
  await validateCondition(String(body.pause));
  await validateCondition(String(body.stop));
  await route.ctx.db.query(
    `UPDATE sla_definitions SET "table" = $2, start_expr = $3, pause_expr = $4, stop_expr = $5, schedule = $6, targets = $7 WHERE name = $1`,
    [name, body.table, body.start, body.pause, body.stop, body.schedule, JSON.stringify(body.targets)],
  );
  sendJson(route.res, 200, { sla_definition: { name, ...body } });
  return true;
}

async function boardList(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT name, rule, n, threshold_percent, window_hours, members FROM boards ORDER BY name`);
  sendJson(route.res, 200, { boards: res.rows });
  return true;
}

async function boardCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(
    `INSERT INTO boards(name, rule, n, threshold_percent, window_hours, members) VALUES ($1,$2,$3,$4,$5,$6)`,
    [body.name, body.rule, body.n ?? null, body.threshold_percent ?? null, body.window_hours ?? 48, JSON.stringify(body.members ?? [])],
  );
  sendJson(route.res, 201, { board: body });
  return true;
}

async function boardUpdate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(
    `UPDATE boards SET rule = $2, n = $3, threshold_percent = $4, window_hours = $5, members = $6 WHERE name = $1`,
    [name, body.rule, body.n ?? null, body.threshold_percent ?? null, body.window_hours ?? 48, JSON.stringify(body.members ?? [])],
  );
  sendJson(route.res, 200, { board: { name, ...body } });
  return true;
}

async function groupList(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT name, members, escalation_policy FROM groups ORDER BY name`);
  sendJson(route.res, 200, { groups: res.rows });
  return true;
}

async function groupCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(`INSERT INTO groups(name, members, escalation_policy) VALUES ($1,$2,$3)`, [body.name, body.members ?? [], body.escalation_policy ?? null]);
  sendJson(route.res, 201, { group: body });
  return true;
}

async function groupUpdate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(`UPDATE groups SET members = $2, escalation_policy = $3 WHERE name = $1`, [name, body.members ?? [], body.escalation_policy ?? null]);
  sendJson(route.res, 200, { group: { name, ...body } });
  return true;
}

async function userCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  const { hashPassword } = await import('../seeddata.js');
  await route.ctx.db.query(
    `INSERT INTO people(username, display_name, department, roles, password_hash, time_zone, active, digest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'immediate')`,
    [body.username, body.display_name, body.department, body.roles ?? [], hashPassword(String(body.password ?? '')), body.time_zone ?? 'Europe/Berlin', body.active ?? true],
  );
  sendJson(route.res, 201, { user: { username: body.username } });
  return true;
}

async function userUpdate(route: RouteContext, user: SessionUser, username: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  const sets: string[] = [];
  const params: unknown[] = [username];
  const add = (key: string, column: string, value: unknown): void => {
    if (!(key in body)) return;
    params.push(value);
    sets.push(`"${column}" = $${params.length}`);
  };
  add('display_name', 'display_name', body.display_name);
  add('department', 'department', body.department);
  add('roles', 'roles', body.roles);
  add('time_zone', 'time_zone', body.time_zone);
  add('out_of_office', 'out_of_office', body.out_of_office);
  add('capacity', 'capacity', body.capacity);
  add('active', 'active', body.active);
  add('digest', 'digest', body.digest);
  if (sets.length) {
    await route.ctx.db.query(`UPDATE people SET ${sets.join(', ')} WHERE username = $1`, params);
  }
  const res = await route.ctx.db.query(
    `SELECT username, display_name, roles, department, time_zone, out_of_office, capacity, active, digest FROM people WHERE username = $1`,
    [username],
  );
  if (!res.rows.length) throw notFound();
  sendJson(route.res, 200, { user: res.rows[0] });
  return true;
}

async function userDelegate(route: RouteContext, user: SessionUser, username: string): Promise<boolean> {
  if (user.username !== username && !user.roles.includes('operator')) throw forbidden();
  const body = route.body;
  if (body.delegate === null || body.delegate === undefined) {
    await route.ctx.db.query(`UPDATE people SET delegate = NULL, delegate_from = NULL, delegate_to = NULL WHERE username = $1`, [username]);
  } else {
    await route.ctx.db.query(
      `UPDATE people SET delegate = $2, delegate_from = $3, delegate_to = $4 WHERE username = $1`,
      [username, body.delegate, body.from ? new Date(String(body.from)) : null, body.to ? new Date(String(body.to)) : null],
    );
  }
  const res = await route.ctx.db.query(`SELECT username, delegate, delegate_from, delegate_to FROM people WHERE username = $1`, [username]);
  sendJson(route.res, 200, { user: res.rows[0] });
  return true;
}

async function impersonate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const username = String(route.body.username ?? '');
  const target = await route.ctx.db.query(`SELECT username, display_name FROM people WHERE username = $1 AND active`, [username]);
  if (!target.rows.length) throw notFound();
  await route.ctx.db.query(`UPDATE sessions SET impersonating = $2 WHERE token = $1`, [route.session!.token, username]);
  await route.ctx.db.query(
    `INSERT INTO impersonation_log(actor, target, kind, at) VALUES ($1,$2,'impersonation_started',$3)`,
    [user.username, username, new Date()],
  );
  sendJson(route.res, 200, { impersonating: { username, display_name: String(target.rows[0].display_name) } });
  return true;
}

async function stopImpersonate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!route.session?.impersonating) throw notFound();
  await route.ctx.db.query(`UPDATE sessions SET impersonating = NULL WHERE token = $1`, [route.session.token]);
  await route.ctx.db.query(
    `INSERT INTO impersonation_log(actor, target, kind, at) VALUES ($1,$2,'impersonation_stopped',$3)`,
    [route.session.user.username, route.session.impersonating.username, new Date()],
  );
  route.res.writeHead(204);
  route.res.end();
  return true;
}

async function auditLog(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const res = await route.ctx.db.query(`SELECT at, kind, actor, target FROM impersonation_log ORDER BY at DESC, id DESC`);
  sendJson(route.res, 200, {
    entries: res.rows.map((r: Record<string, unknown>) => ({
      at: new Date(r.at as Date).toISOString(),
      kind: String(r.kind),
      actor: String(r.actor),
      target: String(r.target),
    })),
  });
  return true;
}

async function setWorkspace(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const workspace = route.body.workspace === 'test' ? 'test' : 'live';
  await route.ctx.db.query(`UPDATE sessions SET workspace = $2 WHERE token = $1`, [route.session!.token, workspace]);
  sendJson(route.res, 200, { workspace });
  return true;
}
