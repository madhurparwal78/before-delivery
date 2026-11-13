import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, nextIid } from './common.js';
import { ROLE_LEVEL, effectiveAccess, groupAccess } from '../domain/access.js';
import { parseDurationMs, zoneDate, dayFloor } from '../core/util.js';

// ---- quick actions ----

export interface QuickAction {
  action: string;
  args: string;
  raw: string;
}

export function parseQuickActions(body: string): { text: string; actions: QuickAction[] } {
  const lines = body.split('\n');
  const kept: string[] = [];
  const actions: QuickAction[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(/^(\/[a-z]+)(?:\s+(.*))?$/);
    if (m) {
      actions.push({ action: m[1], args: m[2] ?? '', raw: trimmed });
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join('\n'), actions };
}

export function normalizeDuration(text: string): { ms: number } | { error: string } {
  const t = text.trim();
  const m = t.match(/^(?:(\d+)mo)?\s*(?:(\d+)w)?\s*(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/);
  if (!m || t === '') return { error: `Invalid duration: ${text}` };
  const mo = m[1] ? parseInt(m[1], 10) : 0;
  const w = m[2] ? parseInt(m[2], 10) : 0;
  const d = m[3] ? parseInt(m[3], 10) : 0;
  const h = m[4] ? parseInt(m[4], 10) : 0;
  const mi = m[5] ? parseInt(m[5], 10) : 0;
  if (mo + w + d + h + mi === 0) return { error: `Invalid duration: ${text}` };
  const hours = mo * 160 + w * 40 + d * 8 + h + mi / 60;
  return { ms: Math.round(hours * 3_600_000) };
}

export function formatDuration(ms: number): string {
  let rest = ms;
  const mo = Math.floor(rest / (160 * 3_600_000));
  rest -= mo * 160 * 3_600_000;
  const w = Math.floor(rest / (40 * 3_600_000));
  rest -= w * 40 * 3_600_000;
  const d = Math.floor(rest / (8 * 3_600_000));
  rest -= d * 8 * 3_600_000;
  const h = Math.floor(rest / 3_600_000);
  rest -= h * 3_600_000;
  const m = Math.floor(rest / 60_000);
  const parts: string[] = [];
  if (mo) parts.push(`${mo}mo`);
  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ');
}

export async function createIssue(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.reporter) throw errs.forbidden();
    const title = typeof body.title === 'string' ? body.title : '';
    const description = typeof body.description === 'string' ? body.description : '';
    const confidential = body.confidential === true;
    const weight = typeof body.weight === 'number' ? body.weight : null;
    const dueDate = typeof body.due_date === 'string' ? body.due_date : null;
    if (title === '') throw errs.validation({ title: "Title can't be blank." });
    if (title.length > 255) throw errs.validation({ title: 'Title is too long (255 characters at most).' });
    if (weight !== null && (weight < 0 || weight > 100)) throw errs.validation({ weight: 'Weight must be 0 to 100.' });
    const now = rc.ctx.now();
    const iid = await nextIid(client, id, 'issue');
    const r = await client.query<{ id: number }>(`INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, weight, due_date, created_at, updated_at) VALUES ($1, $2, $3, $4, 'opened', $5, $6, $7, $8, $9, $9) RETURNING id`,
      [id, iid, title, description, rc.user.id, confidential, weight, dueDate, now]);
    await applyIssueMeta(rc, client, id, r.rows[0].id, body, null);
    const seq = await rc.ctx.live(client, id, 'issue', { iid, state: 'opened', event: 'open' });
    await client.query('COMMIT');
    return { iid, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function applyIssueMeta(rc: RequestCtx, c: import('pg').PoolClient, projectId: number, issueId: number, body: Record<string, unknown>, before: { labels: string[] } | null): Promise<string[]> {
  void rc; void before;
  const notes: string[] = [];
  const now = rc.ctx.now();
  if (Array.isArray(body.labels)) {
    const names = body.labels.map(String);
    await setLabels(c, projectId, issueId, names, notes, now);
  }
  if (Array.isArray(body.assignees)) {
    const usernames = body.assignees.map(String);
    const ids = [];
    for (const u of usernames) {
      const row = (await c.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [u])).rows[0];
      if (row) ids.push(row.id);
    }
    await c.query(`DELETE FROM issue_assignees WHERE issue_id = $1`, [issueId]);
    for (const uid of ids) {
      await c.query(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issueId, uid]);
    }
  }
  if (typeof body.milestone === 'string' && body.milestone !== '') {
    const m = (await c.query<{ id: number }>(`SELECT id FROM milestones WHERE project_id = $1 AND title = $2`, [projectId, body.milestone])).rows[0];
    if (m) {
      await c.query(`DELETE FROM issue_milestones WHERE issue_id = $1`, [issueId]);
      await c.query(`INSERT INTO issue_milestones (issue_id, milestone_id) VALUES ($1, $2)`, [issueId, m.id]);
      await c.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, 0, $5)`, [projectId, 'system', `Set milestone %${body.milestone}.`, issueId, now]);
    }
  }
  return notes;
}

export async function setLabels(c: import('pg').PoolClient, projectId: number, issueId: number, names: string[], notes: string[], now: number): Promise<void> {
  const current = (await c.query<{ id: number; name: string }>(
    `SELECT l.id, l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issueId])).rows;
  const currentNames = new Set(current.map((x) => x.name));
  const currentByKey = new Map<string, string[]>();
  for (const n of currentNames) {
    const key = scopedKey(n);
    if (!currentByKey.has(key)) currentByKey.set(key, []);
    currentByKey.get(key)!.push(n);
  }
  const targetNames = new Set(names);
  const replaced: Array<{ old: string; new: string }> = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const n of targetNames) {
    if (currentNames.has(n)) continue;
    const key = scopedKey(n);
    const siblings = currentByKey.get(key) ?? [];
    if (key.includes('::') && siblings.length > 0 && !siblings.includes(n)) {
      replaced.push({ old: siblings[0], new: n });
    } else {
      added.push(n);
    }
  }
  for (const n of currentNames) {
    if (!targetNames.has(n) && !replaced.some((r) => r.old === n)) removed.push(n);
  }
  // apply
  await c.query(`DELETE FROM issue_labels WHERE issue_id = $1`, [issueId]);
  for (const n of targetNames) {
    const label = (await c.query<{ id: number }>(`SELECT id FROM labels WHERE name = $2 AND (project_id = $1 OR group_id IN (SELECT id FROM groups WHERE path = (SELECT path FROM groups WHERE id = (SELECT group_id FROM projects WHERE id = $1)) OR group_id IN (SELECT parent_id FROM groups WHERE id = (SELECT group_id FROM projects WHERE id = $1)))) LIMIT 1`, [projectId, n])).rows[0];
    if (!label) {
      // unknown label: error is handled by callers that need it
      continue;
    }
    await c.query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issueId, label.id]);
  }
  // notes order: Replaced, Added, Removed
  for (const r of replaced) {
    notes.push(`Replaced ~${r.old} with ~${r.new}.`);
  }
  if (added.length > 0) notes.push(`Added ${added.map((a) => `~${a}`).join(' ')}.`);
  if (removed.length > 0) notes.push(`Removed ${removed.map((a) => `~${a}`).join(' ')}.`);
  const actor = 'system';
  for (const text of notes) {
    await c.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, 0, $5)`, [projectId, actor, text, issueId, now]);
  }
}

export function scopedKey(name: string): string {
  const idx = name.lastIndexOf('::');
  return idx > 0 ? name.slice(0, idx) : name;
}

export { loadProject, requireMinRole, ROLE_LEVEL, effectiveAccess, groupAccess, parseDurationMs, zoneDate, dayFloor };
