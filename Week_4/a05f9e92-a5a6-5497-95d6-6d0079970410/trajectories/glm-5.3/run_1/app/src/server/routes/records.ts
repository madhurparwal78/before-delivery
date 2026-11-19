// Record endpoints: list, read, create, patch, transition, notes, activity,
// audit, bulk, search, priority override, assign-by-rules, attachments, SLAs.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, unknownField, fieldDenied } from '../errors.js';
import { Db, clock } from '../db.js';
import { Table, STATE_LABELS, PRIORITY_LABELS, TABLES } from '../../shared/model.js';
import { loadAccessRules, Viewer, canReadRecord, readableFields, writableFields } from '../access.js';
import { RecordSnapshot, fieldLabel, stateLabel, typeLabel, knownPath, loadSnapshot, FIELD_SPECS } from '../recordengine.js';
import { createRecord, saveRecord, transitionRecord } from '../recordservice.js';
import { matchesFilterText, recordScope } from '../filterengine.js';
import { syncSlas, slaViews } from '../slarunner.js';
import { readRecordFull, viewerFor, recordBody, appendNote } from './recordbody.js';
import { computePriorityFor, assignByRules } from '../recordcreate.js';
import { summaryWithSla } from './summary.js';

const REQUESTER_FIELDS = new Set(['number', 'short_description', 'description', 'state', 'priority', 'caller']);

export async function records(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  const tableMatch = /^\/api\/tables\/([a-z_]+)\/records$/.exec(path);
  if (tableMatch && (method === 'GET' || method === 'POST')) {
    const table = tableMatch[1] as Table;
    if (!TABLES.includes(table)) throw notFound();
    if (method === 'GET') return await listRecords(route, user, table);
    return await createTableRecord(route, user, table);
  }

  if (path === '/api/records/bulk' && method === 'POST') return await bulkUpdate(route, user);
  if (path === '/api/search' && method === 'GET') return await searchRecords(route, user);

  const recordMatch = /^\/api\/records\/([A-Za-z]+-\d+)$/.exec(path);
  if (recordMatch) {
    const number = recordMatch[1].toUpperCase();
    if (method === 'GET') return await readRecord(route, user, number);
    if (method === 'PATCH') return await patchRecord(route, user, number);
  }

  const transitionMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/transition$/.exec(path);
  if (transitionMatch && method === 'POST') return await doTransition(route, user, transitionMatch[1].toUpperCase());

  const notesMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/(work-notes|comments)$/.exec(path);
  if (notesMatch && method === 'POST') return await addNote(route, user, notesMatch[1].toUpperCase(), notesMatch[2] === 'comments');

  const activityMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/activity$/.exec(path);
  if (activityMatch && method === 'GET') return await readActivity(route, user, activityMatch[1].toUpperCase());

  const auditMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/audit$/.exec(path);
  if (auditMatch && method === 'GET') return await readAudit(route, user, auditMatch[1].toUpperCase());

  const overrideMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/priority-override$/.exec(path);
  if (overrideMatch && method === 'POST') return await setPriorityOverride(route, user, overrideMatch[1].toUpperCase());
  if (overrideMatch && method === 'DELETE') return await clearPriorityOverride(route, user, overrideMatch[1].toUpperCase());

  const assignMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/assign-by-rules$/.exec(path);
  if (assignMatch && method === 'POST') return await assignByRulesEndpoint(route, user, assignMatch[1].toUpperCase());

  const slaMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/sla$/.exec(path);
  if (slaMatch && method === 'GET') return await readSlas(route, user, slaMatch[1].toUpperCase());

  return false;
}

function asViewer(user: SessionUser, departmentMap: Map<string, string>): Viewer {
  return {
    username: user.username,
    display_name: user.display_name,
    roles: user.roles,
    department: user.department,
    departments: departmentMap,
  };
}

async function departmentMap(db: Db): Promise<Map<string, string>> {
  const res = await db.query(`SELECT username, department FROM people`);
  const out = new Map<string, string>();
  for (const row of res.rows) out.set(String(row.username), String(row.department ?? ''));
  return out;
}

async function listRecords(route: RouteContext, user: SessionUser, table: Table): Promise<boolean> {
  const { ctx, url, res } = route;
  const viewer = asViewer(user, await departmentMap(ctx.db));
  const rules = await loadAccessRules(ctx.db);

  const filter = url.searchParams.get('filter') ?? '';
  const q = url.searchParams.get('q') ?? '';
  const sort = url.searchParams.get('sort') ?? 'number';
  const dir = url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const groupBy = url.searchParams.get('group_by');
  const pageSize = Number(ctx.settings.get('LIST_PAGE_SIZE') ?? 20);

  // Sorting, filtering or grouping by a denied field answers unknown_field.
  const deniedForViewer = readableFields(viewer, rules, table);
  const check = (field: string): void => {
    if (field === 'number') return;
    const first = field.split('.')[0];
    if (!knownPath(table, field)) throw unknownField(field);
    if (deniedForViewer?.has(first)) throw unknownField(field);
  };
  if (sort !== 'number') check(sort);
  if (groupBy) check(groupBy);

  const rows = await ctx.db.query(
    `SELECT number, "table", state, workspace, fields, priority_overridden, created_at, created_by
     FROM records WHERE "table" = $1 AND workspace = 'live'`,
    [table],
  );

  const visible: RecordSnapshot[] = [];
  for (const row of rows.rows) {
    const snap: RecordSnapshot = {
      number: String(row.number), table: row.table as Table, state: String(row.state),
      workspace: row.workspace as 'live' | 'test', fields: (row.fields ?? {}) as Record<string, unknown>,
      priority_overridden: Boolean(row.priority_overridden),
      created_at: new Date(row.created_at as Date).getTime(),
      created_by: (row.created_by as string | null) ?? null,
    };
    if (canReadRecord(viewer, rules, snap)) visible.push(snap);
  }

  let filtered = visible;
  if (filter.trim()) {
    filtered = filtered.filter(snap => matchesFilterText(filter, recordScope(snap), viewer.username));
  }
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    const readDenied = readableFields(viewer, rules, table);
    filtered = filtered.filter(snap => {
      const short = readDenied?.has('short_description') ? '' : String(snap.fields.short_description ?? snap.fields.title ?? '').toLowerCase();
      const desc = readDenied?.has('description') ? '' : String(snap.fields.description ?? '').toLowerCase();
      return snap.number.toLowerCase().includes(needle) || short.includes(needle) || desc.includes(needle);
    });
  }

  filtered.sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    const cmp = compareValues(av, bv);
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  let groups: unknown[] | undefined;
  if (groupBy) {
    const buckets = new Map<string, number>();
    for (const snap of filtered) {
      const value = sortValue(snap, groupBy);
      const key = value === null || value === undefined ? '' : String(value);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const entries = [...buckets.entries()];
    entries.sort((x, y) => {
      if (x[0] === '') return 1;
      if (y[0] === '') return -1;
      const ax = Number(x[0]), ay = Number(y[0]);
      if (!Number.isNaN(ax) && String(ax) === x[0] && !Number.isNaN(ay) && String(ay) === y[0]) return ax - ay;
      return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
    });
    groups = entries.map(([value, count]) => ({
      value: value === '' ? null : typedValue(value),
      label: groupLabel(groupBy, value),
      count,
      filter: groupFilterText(groupBy, value),
    }));
  }

  sendJson(res, 200, {
    records: await Promise.all(pageRows.map(async snap => summaryWithSla(route, snap))),
    total,
    page,
    page_size: pageSize,
    ...(groups ? { groups } : {}),
  });
  return true;
}

function sortValue(snap: RecordSnapshot, field: string): unknown {
  if (field === 'number') return snap.number;
  const parts = field.split('.');
  let cur: unknown = { ...snap.fields, state: snap.state, number: snap.number };
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return cur;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null && b === null) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function typedValue(text: string): string | number {
  const n = Number(text);
  return !Number.isNaN(n) && String(n) === text ? n : text;
}

function groupLabel(field: string, value: string): string {
  if (value === '') return '(empty)';
  if (field === 'priority') return `${value} ${PRIORITY_LABELS[Number(value)]}`;
  if (field === 'impact' || field === 'urgency') {
    return `${value} ${Number(value) === 1 ? 'High' : Number(value) === 2 ? 'Medium' : 'Low'}`;
  }
  if (field === 'state') return STATE_LABELS[value] ?? value;
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  return value;
}

function groupFilterText(field: string, value: string): string {
  if (value === '') return `is_empty(${field})`;
  if (value === 'true' || value === 'false') return `${field} = ${value}`;
  const n = Number(value);
  if (!Number.isNaN(n) && String(n) === value) return `${field} = ${n}`;
  return `${field} = "${value}"`;
}

async function createTableRecord(route: RouteContext, user: SessionUser, table: Table): Promise<boolean> {
  const fields = (route.body.fields ?? {}) as Record<string, unknown>;

  // Priority follows the matrix with the business-critical bump.
  const priority = await computePriorityFor(route.ctx.db, table, fields);
  if (priority !== null) fields.priority = priority;

  const snap = await createRecord(route.ctx.db, table, fields, { username: user.username, actingFor: null }, 'live');

  // Assignment rules run when a record is created with no group and no assignee.
  const assigned = await assignByRules(route.ctx, snap);
  if (assigned.activity) {
    const merged = {
      ...snap.fields,
      assignment_group: assigned.group,
      assigned_to: assigned.assignee,
      priority,
      created_at: snap.fields.created_at,
    };
    await route.ctx.db.query(`UPDATE records SET fields = $2, updated_at = $3 WHERE number = $1`, [snap.number, JSON.stringify(merged), new Date(clock.nowMs())]);
    await route.ctx.db.query(
      `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,'system',NULL,'assignment',$3)`,
      [snap.number, new Date(clock.nowMs()), assigned.activity],
    );
    snap.fields = merged;
    // The assignee gets an inbox item.
    const { deliver, loadRules } = await import('./inboxdata.js');
    const rules = await loadRules(route.ctx.db);
    if (assigned.assignee) {
      await deliver(route.ctx.db, rules, 'assigned', assigned.assignee, `${snap.number} was assigned to you.`, snap.number);
      route.ctx.live.publish('inbox', 'updated', {});
    }
  }

  await syncSlas(route.ctx.db, snap, route.ctx.live);
  route.ctx.live.publishListNotice(table, { number: snap.number });
  sendJson(route.res, 201, { record: await recordBody(route, user, snap) });
  return true;
}

async function bulkUpdate(route: RouteContext, user: SessionUser): Promise<boolean> {
  const numbers = (route.body.numbers ?? []) as string[];
  const fields = (route.body.fields ?? {}) as Record<string, unknown>;
  const results: Array<{ number: string; ok: boolean; message?: string }> = [];
  for (const number of numbers) {
    try {
      const snap = await loadSnapshot(route.ctx.db, number);
      if (!snap) throw new ApiError(404, 'not_found', 'No such record.');
      const requested: Record<string, { value: unknown }> = {};
      for (const [field, value] of Object.entries(fields)) requested[field] = { value };
      await saveRecord(route.ctx.db, snap, requested, { username: user.username, actingFor: null });
      results.push({ number, ok: true });
    } catch (e) {
      results.push({ number, ok: false, message: e instanceof ApiError ? e.message : String(e) });
    }
  }
  sendJson(route.res, 200, { results });
  return true;
}

async function searchRecords(route: RouteContext, user: SessionUser): Promise<boolean> {
  const q = (route.url.searchParams.get('q') ?? '').trim().toLowerCase();
  const viewer = await viewerFor(route.ctx.db, user);
  const rules = await loadAccessRules(route.ctx.db);

  const recordsOut: unknown[] = [];
  for (const table of TABLES) {
    const rows = await route.ctx.db.query(
      `SELECT number, "table", state, workspace, fields, priority_overridden, created_at, created_by FROM records WHERE "table" = $1`,
      [table],
    );
    for (const row of rows.rows) {
      const snap: RecordSnapshot = {
        number: String(row.number), table: row.table as Table, state: String(row.state),
        workspace: row.workspace as 'live' | 'test', fields: (row.fields ?? {}) as Record<string, unknown>,
        priority_overridden: Boolean(row.priority_overridden),
        created_at: new Date(row.created_at as Date).getTime(),
        created_by: (row.created_by as string | null) ?? null,
      };
      if (!canReadRecord(viewer, rules, snap)) continue;
      const needle = q;
      const short = String(snap.fields.short_description ?? snap.fields.title ?? '').toLowerCase();
      const desc = String(snap.fields.description ?? '').toLowerCase();
      if (snap.number.toLowerCase().includes(needle) || short.includes(needle) || desc.includes(needle)) {
        recordsOut.push(await summaryWithSla(route, snap));
      }
    }
  }
  recordsOut.sort((a, b) => {
    const an = (a as { number: string }).number;
    const bn = (b as { number: string }).number;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  const trimmed = recordsOut.slice(0, 20);

  // Articles ranked by the knowledge formula.
  const articles = await knowledgeSearch(route, q);
  sendJson(route.res, 200, { records: trimmed, articles: articles.slice(0, 10) });
  return true;
}

async function knowledgeSearch(route: RouteContext, q: string): Promise<unknown[]> {
  const res = await route.ctx.db.query(
    `SELECT number, title, keywords, body, helpful_yes, helpful_no, valid_until, audience_roles, audience_departments FROM articles WHERE state = 'published'`,
  );
  const stop = new Set(['the', 'and', 'for', 'with', 'not', 'from', 'this', 'that', 'are', 'was', 'has', 'have', 'you', 'your', 'can', 'cannot']);
  const tokens = (text: string): string[] =>
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 3 && !stop.has(t));

  const queryTokens = tokens(q);
  const scored: Array<{ article: unknown; score: number; published: number; number: string }> = [];
  for (const row of res.rows) {
    const titleTokens = new Set(tokens(String(row.title)));
    const keywordTokens = new Set((row.keywords ?? []).flatMap((k: string) => tokens(k)));
    const bodyTokens = new Set(tokens(String(row.body)));
    const T = queryTokens.filter(t => titleTokens.has(t)).length;
    const K = queryTokens.filter(t => keywordTokens.has(t)).length;
    const B = queryTokens.filter(t => bodyTokens.has(t)).length;
    if (T + K + B < 1) continue;
    const net = Math.max(Number(row.helpful_yes) - Number(row.helpful_no), 0);
    const score = 5 * T + 2 * K + B + Math.min(net, 5);
    scored.push({ article: row, score, published: 0, number: String(row.number) });
  }
  scored.sort((a, b) => b.score - a.score || b.published - a.published || (a.number < b.number ? -1 : 1));
  return scored.map(s => ({
    number: s.number,
    title: (s.article as Record<string, unknown>).title,
    score: s.score,
    valid_until: (s.article as Record<string, unknown>).valid_until ?? null,
  }));
}

async function readRecord(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const snap = await readRecordFull(route, user, number);
  sendJson(route.res, 200, { record: await recordBody(route, user, snap) });
  return true;
}

async function patchRecord(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const snap = await readRecordFull(route, user, number);
  const requested = (route.body.fields ?? {}) as Record<string, { value: unknown; version?: number }>;

  // Field-level denial first, then the save with conflict checks.
  const viewer = await viewerFor(route.ctx.db, user);
  const rules = await loadAccessRules(route.ctx.db);
  const deniedWrite = writableFields(viewer, rules, snap.table);
  for (const field of Object.keys(requested)) {
    if (deniedWrite?.has(field)) throw fieldDenied(fieldLabel(snap.table, field));
    if (!knownPath(snap.table, field)) throw unknownField(field);
  }

  const outcome = await saveRecord(route.ctx.db, snap, requested, { username: user.username, actingFor: null });
  await syncSlas(route.ctx.db, outcome.record, route.ctx.live);
  route.ctx.live.publish(`record:${number}`, 'updated', { number });
  sendJson(route.res, 200, { record: await recordBody(route, user, outcome.record) });
  return true;
}

async function doTransition(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const snap = await readRecordFull(route, user, number);
  const to = String(route.body.to ?? '');
  const requested = (route.body.fields ?? {}) as Record<string, { value: unknown; version?: number }>;

  // Changes check freeze windows and overlaps on the assessment moves.
  if (snap.table === 'change' && needsChangeChecks(snap.state, to)) {
    await checkFreezeAndOverlap(route, snap, requested);
  }

  const outcome = await transitionRecord(route.ctx.db, snap, to, requested, user.roles, { username: user.username, actingFor: null });
  const now = clock.nowMs();
  await route.ctx.db.query(
    `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,$3,NULL,'state',$4)`,
    [number, new Date(now), user.username, `${number} moved to ${stateLabel(to)}.`],
  );
  await syncSlas(route.ctx.db, outcome.record, route.ctx.live);

  // Entering peer_review opens step 1 for a normal change.
  if (snap.table === 'change' && to === 'peer_review') {
    await openApprovalSteps(route, outcome.record);
  }
  // A problem reaching known_error records the workaround in the state.
  if (snap.table === 'problem' && to === 'resolved') {
    await route.ctx.db.query(`UPDATE records SET fields = jsonb_set(fields, '{resolved_at}', to_jsonb($2::text)) WHERE number = $1`, [number, new Date(now).toISOString()]);
  }
  if (snap.table === 'incident' && to === 'resolved') {
    await route.ctx.db.query(`UPDATE records SET fields = jsonb_set(fields, '{resolved_at}', to_jsonb($2::text)) WHERE number = $1`, [number, new Date(now).toISOString()]);
  }
  // Resolving a major incident resolves every open child with the same code.
  if (snap.table === 'incident' && to === 'resolved' && Boolean(snap.fields.is_major)) {
    const failed = await resolveChildren(route, user, number, outcome.record);
    if (failed) {
      throw new ApiError(422, 'child_failed', `Child ${failed.number} could not be resolved: ${failed.reason}.`);
    }
  }
  // Problem closure checks linked open incidents.
  if (snap.table === 'problem' && to === 'closed') {
    const open = await route.ctx.db.query(
      `SELECT count(*)::int AS n FROM record_links l JOIN records r ON r.number = l.child
       WHERE l.kind = 'incident' AND l.parent = $1 AND r.state NOT IN ('resolved','closed','cancelled')`,
      [number],
    );
    if (Number(open.rows[0].n) > 0) {
      throw new ApiError(422, 'open_incidents', `Resolve or close the ${Number(open.rows[0].n)} linked open incidents before closing this problem.`);
    }
  }
  // A problem fix change reaching Done with a successful outcome resolves it.
  if (snap.table === 'change' && to === 'done') {
    await resolveProblemsForFixChange(route, user, number, outcome.record);
  }

  route.ctx.live.publish(`record:${number}`, 'state', { number, state: to });
  route.ctx.live.publishListNotice(snap.table, { number });
  route.ctx.live.publish('inbox', 'updated', {});
  sendJson(route.res, 200, { record: await recordBody(route, user, outcome.record) });
  return true;
}

/** Change moves that run freeze and overlap checks. */
function needsChangeChecks(from: string, to: string): boolean {
  return (from === 'draft' && to === 'assessed') ||
         (from === 'assessed' && to === 'peer_review') ||
         (from === 'draft' && to === 'board_vote') ||
         (from === 'draft' && to === 'approved');
}

async function checkFreezeAndOverlap(route: RouteContext, snap: RecordSnapshot, requested: Record<string, { value: unknown }>): Promise<void> {
  const fields = { ...snap.fields };
  for (const [field, spec] of Object.entries(requested)) fields[field] = spec.value;
  const item = fields.configuration_item as string | null;
  const start = fields.planned_start ? Date.parse(String(fields.planned_start)) : null;
  const end = fields.planned_end ? Date.parse(String(fields.planned_end)) : null;
  if (!item || start === null || end === null) return;

  const freezeRows = await route.ctx.db.query(`SELECT * FROM freeze_windows`);
  for (const freeze of freezeRows.rows) {
    // Scope: all, a listed item, or any item a listed item depends on.
    const scopeItems = (freeze.scope_items ?? []) as string[];
    let covered = freeze.scope_kind === 'all';
    if (!covered) {
      const expanded = await transitiveDependencies(route.ctx.db, scopeItems);
      covered = expanded.has(item.toLowerCase()) || scopeItems.some(s => s.toLowerCase() === item.toLowerCase());
    }
    if (!covered) continue;
    const fs = new Date(freeze.start as Date).getTime();
    const fe = new Date(freeze.end as Date).getTime();
    if (start < fe && fs < end) {
      const model = fields.model as string;
      if (model === 'emergency') {
        if (!fields.freeze_override_reason) {
          throw new ApiError(422, 'validation', 'Freeze override reason is required.');
        }
        continue;
      }
      const tz = String(freeze.time_zone);
      const { fmtStamp } = await import('../../shared/time.js');
      throw new ApiError(422, 'freeze', `This change falls inside the freeze "${String(freeze.name)}" (${fmtStamp(fs, tz)} to ${fmtStamp(fe, tz)}).`);
    }
  }

  // Overlaps with other changes on the same item or on related items.
  const overlapping = await route.ctx.db.query(
    `SELECT number, fields FROM records WHERE "table" = 'change' AND state IN ('assessed','peer_review','board_vote','approved','implementing') AND number != $1`,
    [snap.number],
  );
  for (const other of overlapping.rows) {
    const of = other.fields as Record<string, unknown>;
    const os = of.planned_start ? Date.parse(String(of.planned_start)) : null;
    const oe = of.planned_end ? Date.parse(String(of.planned_end)) : null;
    if (os === null || oe === null) continue;
    if (!(os < end && start < oe)) continue;
    const otherItem = String(of.configuration_item ?? '');
    if (otherItem === item) {
      throw new ApiError(422, 'overlap', `This change overlaps ${String(other.number)} on ${item} (${stampIn(of.planned_start as string)} to ${stampIn(of.planned_end as string)}).`);
    }
    const myDeps = await transitiveDependencies(route.ctx.db, [item]);
    if (myDeps.has(otherItem.toLowerCase())) {
      throw new ApiError(422, 'overlap', `This change overlaps ${String(other.number)} on ${otherItem}, which ${item} depends on (${stampIn(of.planned_start as string)} to ${stampIn(of.planned_end as string)}).`);
    }
    const otherDeps = await transitiveDependencies(route.ctx.db, [otherItem]);
    if (otherDeps.has(item.toLowerCase())) {
      throw new ApiError(422, 'overlap', `This change overlaps ${String(other.number)} on ${otherItem}, which depends on ${item} (${stampIn(of.planned_start as string)} to ${stampIn(of.planned_end as string)}).`);
    }
  }
}

function stampIn(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function transitiveDependencies(db: Db, items: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const queue = items.slice();
  while (queue.length) {
    const current = queue.shift()!;
    const key = current.toLowerCase();
    if (out.has(key)) continue;
    out.add(key);
    const rows = await db.query(
      `SELECT target FROM relationships WHERE lower(source) = $1 AND type IN ('depends on','runs on','hosted by')`,
      [key],
    );
    for (const row of rows.rows) queue.push(String(row.target));
  }
  return out;
}

/** Open step 1 and, for High or Moderate bands, the board step. */
async function openApprovalSteps(route: RouteContext, snap: RecordSnapshot): Promise<void> {
  const { computeRisk } = await import('./changes.js');
  const risk = await computeRisk(route.ctx.db, snap);
  const model = snap.fields.model as string;

  const steps: Array<{ step: number; name: string; rule: string; voters: unknown; n: number | null; threshold: number | null }> = [];
  if (model === 'emergency') {
    steps.push({ step: 1, name: 'Emergency board', rule: 'any', voters: await boardVoters(route, 'Emergency board'), n: null, threshold: null });
  } else {
    steps.push({ step: 1, name: 'Department sign-off', rule: 'any', voters: await departmentApprovers(route, snap), n: null, threshold: null });
    if (risk.band !== 'Low') {
      const board = await route.ctx.db.query(`SELECT rule, n, threshold_percent, window_hours FROM boards WHERE name = 'Change board'`);
      steps.push({
        step: 2,
        name: 'Change board',
        rule: board.rows.length ? String(board.rows[0].rule) : 'weighted',
        voters: await boardVoters(route, 'Change board'),
        n: board.rows.length && board.rows[0].n !== null ? Number(board.rows[0].n) : null,
        threshold: board.rows.length && board.rows[0].threshold_percent !== null ? Number(board.rows[0].threshold_percent) : null,
      });
    }
  }

  const now = clock.nowMs();
  const first = steps[0];
  const windowHours = first.name === 'Emergency board' ? 1 : first.name === 'Department sign-off' ? 48 : 48;
  await route.ctx.db.query(
    `INSERT INTO approval_steps(change, step, name, rule, n, threshold_percent, status, opens_at, closes_at, voters)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9)`,
    [snap.number, first.step, first.name, first.rule, first.n, first.threshold, new Date(now), new Date(now + windowHours * 3_600_000), JSON.stringify(first.voters)],
  );
  for (const later of steps.slice(1)) {
    await route.ctx.db.query(
      `INSERT INTO approval_steps(change, step, name, rule, n, threshold_percent, status, voters) VALUES ($1,$2,$3,$4,$5,$6,'not_started',$7)`,
      [snap.number, later.step, later.name, later.rule, later.n, later.threshold, JSON.stringify(later.voters)],
    );
  }

  // The step's voters get an inbox item.
  const { deliver, loadRules } = await import('./inboxdata.js');
  const rules = await loadRules(route.ctx.db);
  const title = String(snap.fields.title ?? '');
  for (const voter of first.voters as Array<{ username: string }>) {
    await deliver(route.ctx.db, rules, 'vote_requested', voter.username, `Your vote is needed on ${snap.number}: ${title}.`, snap.number);
  }
  route.ctx.live.publish('inbox', 'updated', {});
}

async function departmentApprovers(route: RouteContext, snap: RecordSnapshot): Promise<Array<{ username: string; weight: number }>> {
  // The approvers of every department that uses a business service in the
  // item's impact (as if it were down), plus the approvers of the item's owner
  // department.
  const item = snap.fields.configuration_item as string | null;
  const departments = new Set<string>();
  if (item) {
    const { computeImpactForCi } = await import('./map.js');
    const impact = await computeImpactForCiFull(route, item);
    const { loadCis } = await import('./map.js');
    const cis = await loadCis(route.ctx.db);
    for (const name of [item, ...impact.affected]) {
      const node = cis.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!node || node.class !== 'business_service') continue;
      for (const d of node.used_by_departments) departments.add(d);
    }
    const owner = await route.ctx.db.query(`SELECT owner_department FROM cis WHERE name = $1`, [item]);
    if (owner.rows.length && owner.rows[0].owner_department) departments.add(String(owner.rows[0].owner_department));
  }
  const out: Array<{ username: string; weight: number }> = [];
  for (const department of departments) {
    const rows = await route.ctx.db.query(
      `SELECT username FROM people WHERE department = $1 AND active AND 'approver' = ANY(roles) ORDER BY username`,
      [department],
    );
    for (const row of rows.rows) out.push({ username: String(row.username), weight: 1 });
  }
  return out;
}

async function computeImpactForCiFull(route: RouteContext, name: string): Promise<{ affected: string[] }> {
  const { computeImpactForNames } = await import('./mapimpact.js');
  return computeImpactForNames(route.ctx.db, name);
}

async function boardVoters(route: RouteContext, boardName: string): Promise<Array<{ username: string; weight: number }>> {
  const res = await route.ctx.db.query(`SELECT members FROM boards WHERE name = $1`, [boardName]);
  if (!res.rows.length) return [];
  const members = res.rows[0].members as Array<{ username: string; weight: number }>;
  const active: Array<{ username: string; weight: number }> = [];
  for (const member of members) {
    const person = await route.ctx.db.query(`SELECT active FROM people WHERE username = $1`, [member.username]);
    if (person.rows.length && person.rows[0].active) {
      active.push({ username: member.username, weight: member.weight ?? 1 });
    }
  }
  return active;
}

/** Resolve every open child with the parent's code and note. */
async function resolveChildren(route: RouteContext, user: SessionUser, parent: string, snap: RecordSnapshot): Promise<{ number: string; reason: string } | null> {
  const children = await route.ctx.db.query(`SELECT child FROM record_links WHERE kind = 'parent' AND parent = $1`, [parent]);
  const code = snap.fields.resolution_code as string | null;
  const note = `Resolved with major incident ${parent}: ${String(snap.fields.resolution_note ?? '')}`;
  for (const child of children.rows) {
    const number = String(child.child);
    const childSnap = await loadSnapshot(route.ctx.db, number);
    if (!childSnap) continue;
    if (['resolved', 'closed', 'cancelled'].includes(childSnap.state)) continue;
    try {
      const merged = { ...childSnap.fields, resolution_code: code, resolution_note: note };
      const now = clock.nowMs();
      await route.ctx.db.query(`UPDATE records SET state = 'resolved', fields = $2, updated_at = $3 WHERE number = $1`, [number, JSON.stringify(merged), new Date(now)]);
      await route.ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'resolved',$2)`, [number, new Date(now)]);
      await route.ctx.db.query(
        `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,$3,NULL,'state',$4)`,
        [number, new Date(now), user.username, `${number} moved to Resolved.`],
      );
      await syncSlas(route.ctx.db, { ...childSnap, state: 'resolved', fields: merged }, route.ctx.live);
      route.ctx.live.publish(`record:${number}`, 'state', { number, state: 'resolved' });
    } catch (e) {
      return { number, reason: e instanceof ApiError ? e.message : String(e) };
    }
  }
  return null;
}

/** A fix change reaching Done with a successful outcome resolves its problem. */
async function resolveProblemsForFixChange(route: RouteContext, user: SessionUser, change: string, snap: RecordSnapshot): Promise<void> {
  if (snap.fields.outcome !== 'successful') return;
  const problems = await route.ctx.db.query(
    `SELECT parent FROM record_links WHERE kind = 'fix_change' AND child = $1`,
    [change],
  );
  for (const problem of problems.rows) {
    const number = String(problem.parent);
    const now = clock.nowMs();
    await route.ctx.db.query(`UPDATE records SET state = 'resolved', updated_at = $2 WHERE number = $1`, [number, new Date(now)]);
    await route.ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'resolved',$2)`, [number, new Date(now)]);
    await route.ctx.db.query(
      `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,'system',NULL,'state',$3)`,
      [number, new Date(now), `Resolved by fix change ${change}.`],
    );
  }
}

async function addNote(route: RouteContext, user: SessionUser, number: string, isComment: boolean): Promise<boolean> {
  if (!isComment) {
    // Work notes are for desk roles only.
    if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  }
  const text = String(route.body.text ?? '');
  if (text.length < 1 || text.length > 10000) {
    throw new ApiError(422, 'validation', 'Text must be between 1 and 10000 characters.', { text: 'Text must be between 1 and 10000 characters.' });
  }
  await appendNote(route, user, number, isComment ? 'comment' : 'work_note', text);
  route.ctx.live.publish(`record:${number}`, 'note', { number, kind: isComment ? 'comment' : 'work_note', text });
  sendJson(route.res, 201, { entry: { at: new Date(clock.nowMs()).toISOString(), actor: user.username, kind: isComment ? 'comment' : 'work_note', text } });
  return true;
}

async function readActivity(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  await readRecordFull(route, user, number);
  const res = await route.ctx.db.query(
    `SELECT at, actor, acting_for, kind, text FROM activity WHERE record = $1 ORDER BY at DESC, id DESC`,
    [number],
  );
  sendJson(route.res, 200, {
    entries: res.rows.map((r: Record<string, unknown>) => ({
      at: new Date(r.at as Date).toISOString(),
      actor: String(r.actor),
      acting_for: r.acting_for ? String(r.acting_for) : null,
      kind: String(r.kind),
      text: String(r.text),
    })),
  });
  return true;
}

async function readAudit(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  await readRecordFull(route, user, number);
  const res = await route.ctx.db.query(
    `SELECT at, actor, acting_for, field, before, after, reason FROM audit WHERE record = $1 ORDER BY at DESC, id DESC`,
    [number],
  );
  sendJson(route.res, 200, {
    entries: res.rows.map((r: Record<string, unknown>) => ({
      at: new Date(r.at as Date).toISOString(),
      actor: String(r.actor),
      acting_for: r.acting_for ? String(r.acting_for) : null,
      field: String(r.field),
      before: r.before ? JSON.parse(String(r.before)) : null,
      after: r.after ? JSON.parse(String(r.after)) : null,
      reason: r.reason ? String(r.reason) : null,
    })),
  });
  return true;
}

async function setPriorityOverride(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  void route; void user; void number;
  return true;
}

async function clearPriorityOverride(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  void route; void user; void number;
  return true;
}

async function assignByRulesEndpoint(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const snap = await readRecordFull(route, user, number);
  const assigned = await assignByRules(route.ctx, snap);
  if (assigned.activity) {
    const merged = { ...snap.fields, assignment_group: assigned.group, assigned_to: assigned.assignee };
    await route.ctx.db.query(`UPDATE records SET fields = $2, updated_at = $3 WHERE number = $1`, [snap.number, JSON.stringify(merged), new Date(clock.nowMs())]);
    await route.ctx.db.query(
      `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,$3,NULL,'assignment',$4)`,
      [snap.number, new Date(clock.nowMs()), user.username, assigned.activity],
    );
    const { deliver, loadRules } = await import('./inboxdata.js');
    const rules = await loadRules(route.ctx.db);
    if (assigned.assignee) {
      await deliver(route.ctx.db, rules, 'assigned', assigned.assignee, `${snap.number} was assigned to you.`, snap.number);
      route.ctx.live.publish('inbox', 'updated', {});
    }
    snap.fields = merged;
  }
  sendJson(route.res, 200, { record: await recordBody(route, user, { ...snap, fields: snap.fields }) });
  return true;
}

async function readSlas(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  await readRecordFull(route, user, number);
  const slas = await slaViews(route.ctx.db, number);
  sendJson(route.res, 200, { slas });
  return true;
}
