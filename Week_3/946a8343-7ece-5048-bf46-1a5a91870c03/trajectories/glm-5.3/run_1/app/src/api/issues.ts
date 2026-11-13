import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, nextIid, canReadGroup, groupById } from './common.js';
import { ROLE_LEVEL, effectiveAccess, groupAccess, groupAncestors } from '../domain/access.js';
import { parseQuickActions, normalizeDuration, formatDuration, setLabels, scopedKey } from './planning.js';
import { zoneDate, dayFloor, parseDateOnly } from '../core/util.js';

export async function getIssue(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const issue = await visibleIssue(client, rc, id, iid, access);
    if (!issue) throw errs.notFound();
    const labels = (await client.query<{ name: string; description: string }>(`SELECT l.name, l.description FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1 ORDER BY l.name`, [issue.id])).rows;
    const assignees = (await client.query<{ username: string }>(`SELECT u.username FROM issue_assignees ia JOIN users u ON u.id = ia.user_id WHERE ia.issue_id = $1`, [issue.id])).rows.map((r) => r.username);
    const milestone = (await client.query<{ title: string }>(`SELECT m.title FROM issue_milestones im JOIN milestones m ON m.id = im.milestone_id WHERE im.issue_id = $1`, [issue.id])).rows[0]?.title ?? null;
    return {
      iid,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      confidential: issue.confidential,
      weight: issue.weight,
      due_date: issue.due_date,
      labels,
      assignees,
      milestone,
      author: (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [issue.author_id])).rows[0]?.username ?? '',
    };
  } finally {
    client.release();
  }
}

async function visibleIssue(c: import('pg').PoolClient, rc: RequestCtx, projectId: number, iid: number, access: { level: number; member: boolean; implied: boolean }): Promise<{ id: number; iid: number; title: string; description: string; state: string; confidential: boolean; weight: number | null; due_date: string | null; author_id: number } | null> {
  const row = (await c.query<{ id: number; iid: number; title: string; description: string; state: string; confidential: boolean; weight: number | null; due_date: string | null; author_id: number }>(
    `SELECT id, iid, title, description, state, confidential, weight, due_date, author_id FROM issues WHERE project_id = $1 AND iid = $2`, [projectId, iid])).rows[0];
  if (!row) return null;
  if (row.confidential) {
    const isAuthor = rc.user ? row.author_id === rc.user.id : false;
    const isAssignee = rc.user ? (await c.query(`SELECT 1 FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [row.id, rc.user.id])).rows.length > 0 : false;
    const member = access.member && access.level >= ROLE_LEVEL.reporter;
    if (!isAuthor && !isAssignee && !member) return null;
  }
  return row;
}

export async function patchIssue(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.reporter) throw errs.forbidden();
    const issue = await visibleIssue(client, rc, id, iid, access);
    if (!issue) throw errs.notFound();
    const now = rc.ctx.now();
    if (typeof body.title === 'string') {
      if (body.title === '') throw errs.validation({ title: "Title can't be blank." });
      if (body.title.length > 255) throw errs.validation({ title: 'Title is too long (255 characters at most).' });
      await client.query(`UPDATE issues SET title = $2, updated_at = $3 WHERE id = $1`, [issue.id, body.title, now]);
    }
    if (typeof body.description === 'string') {
      await client.query(`UPDATE issues SET description = $2, updated_at = $3 WHERE id = $1`, [issue.id, body.description, now]);
    }
    if (typeof body.confidential === 'boolean') {
      await client.query(`UPDATE issues SET confidential = $2, updated_at = $3 WHERE id = $1`, [issue.id, body.confidential, now]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, $5, $6)`,
        [id, rc.user.username, body.confidential ? 'Made confidential.' : 'Made public.', issue.id, iid, now]);
    }
    if (typeof body.weight === 'number') {
      if (body.weight < 0 || body.weight > 100) throw errs.validation({ weight: 'Weight must be 0 to 100.' });
      await client.query(`UPDATE issues SET weight = $2, updated_at = $3 WHERE id = $1`, [issue.id, body.weight, now]);
    }
    if (body.weight === null) {
      await client.query(`UPDATE issues SET weight = NULL WHERE id = $1`, [issue.id]);
    }
    if (typeof body.state_event === 'string') {
      if (body.state_event === 'close' && issue.state === 'opened') {
        await client.query(`UPDATE issues SET state = 'closed', updated_at = $2 WHERE id = $1`, [issue.id, now]);
        await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, 'Closed.', true, false, $3, $4, $5)`, [id, rc.user.username, issue.id, iid, now]);
      } else if (body.state_event === 'reopen' && issue.state === 'closed') {
        await client.query(`UPDATE issues SET state = 'opened', updated_at = $2 WHERE id = $1`, [issue.id, now]);
        await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, 'Reopened.', true, false, $3, $4, $5)`, [id, rc.user.username, issue.id, iid, now]);
      }
    }
    if (typeof body.due_date === 'string' || body.due_date === null) {
      await client.query(`UPDATE issues SET due_date = $2 WHERE id = $1`, [issue.id, body.due_date]);
    }
    if (Array.isArray(body.labels)) {
      const notes: string[] = [];
      await setLabels(client, id, issue.id, body.labels.map(String), notes, now);
    }
    if (Array.isArray(body.add_labels)) {
      const current = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issue.id])).rows.map((r) => r.name);
      const target = [...new Set([...current, ...body.add_labels.map(String)])];
      const notes: string[] = [];
      await setLabels(client, id, issue.id, target, notes, now);
    }
    if (Array.isArray(body.remove_labels)) {
      const current = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issue.id])).rows.map((r) => r.name);
      const removeSet = new Set(body.remove_labels.map(String));
      const target = current.filter((n) => !removeSet.has(n));
      const notes: string[] = [];
      await setLabels(client, id, issue.id, target, notes, now);
    }
    if (Array.isArray(body.assignees)) {
      const ids = [];
      for (const u of body.assignees.map(String)) {
        const row = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [u])).rows[0];
        if (!row) throw errs.validation({ assignees: `User @${u} doesn't exist.` });
        ids.push(row.id);
      }
      await client.query(`DELETE FROM issue_assignees WHERE issue_id = $1`, [issue.id]);
      for (const uid of ids) {
        await client.query(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issue.id, uid]);
      }
    }
    if (typeof body.milestone === 'string') {
      const m = (await client.query<{ id: number }>(`SELECT id FROM milestones WHERE project_id = $1 AND title = $2`, [id, body.milestone])).rows[0];
      if (!m) throw errs.validation({ milestone: `Milestone %${body.milestone} doesn't exist.` });
      await client.query(`DELETE FROM issue_milestones WHERE issue_id = $1`, [issue.id]);
      await client.query(`INSERT INTO issue_milestones (issue_id, milestone_id) VALUES ($1, $2)`, [issue.id, m.id]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, 'system', $2, true, false, $3, $4, $5)`,
        [id, `Set milestone %${body.milestone}.`, issue.id, iid, now]);
    }
    if (body.milestone === null) {
      await client.query(`DELETE FROM issue_milestones WHERE issue_id = $1`, [issue.id]);
    }
    if (typeof body.estimate === 'string') {
      const res = normalizeDuration(body.estimate);
      if ('error' in res) throw errs.validation({ estimate: `Invalid duration: ${body.estimate}.` });
      await client.query(`UPDATE issues SET estimate_ms = $2 WHERE id = $1`, [issue.id, res.ms]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, 'system', $2, true, false, $3, $4, $5)`,
        [id, `Set estimate to ${formatDuration(res.ms)}.`, issue.id, iid, now]);
    }
    const seq = await rc.ctx.live(client, id, 'issue', { iid, event: 'update' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function postIssueNote(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const text = typeof body.body === 'string' ? body.body : '';
  if (text.trim() === '') throw errs.validation({ body: "Comment can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const issue = await visibleIssue(client, rc, id, iid, access);
    if (!issue) throw errs.notFound();
    const parsed = parseQuickActions(text);
    const results: string[] = [];
    const now = rc.ctx.now();
    let storedText = parsed.text.trim();
    for (const action of parsed.actions) {
      const result = await runQuickAction(rc, client, id, issue, action, now);
      if (result) results.push(result);
      else storedText += (storedText === '' ? '' : '\n') + action.raw;
    }
    if (storedText !== '') {
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, false, false, $4, $5, $6)`,
        [id, rc.user.username, storedText, issue.id, iid, now]);
    }
    const seq = await rc.ctx.live(client, id, 'issue', { iid, event: 'note' });
    await client.query('COMMIT');
    return { results, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function runQuickAction(rc: RequestCtx, c: import('pg').PoolClient, projectId: number, issue: { id: number; iid: number; state: string; title: string }, action: { action: string; args: string; raw: string }, now: number): Promise<string | null> {
  const addNote = async (text: string): Promise<void> => {
    await c.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, $5, $6)`,
      [projectId, rc.user!.username, text, issue.id, issue.iid, now]);
  };
  const a = action.action;
  const args = action.args;
  if (a === '/assign' || a === '/unassign') {
    const name = args.replace(/^@/, '');
    const user = (await c.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [name])).rows[0];
    if (!user) return `Could not apply /${a.slice(1)}: user @${name} doesn't exist.`;
    if (a === '/assign') {
      await c.query(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issue.id, user.id]);
      await addNote(`Assigned @${name}.`);
      return `Assigned @${name}.`;
    }
    await c.query(`DELETE FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [issue.id, user.id]);
    await addNote(`Unassigned @${name}.`);
    return `Unassigned @${name}.`;
  }
  if (a === '/label' || a === '/unlabel') {
    const labels = splitLabelArgs(args);
    if (a === '/label') {
      for (const name of labels) {
        const label = await findLabel(c, projectId, name);
        if (!label) return `Could not apply /label: label ~${name} doesn't exist.`;
      }
      const current = (await c.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issue.id])).rows.map((r) => r.name);
      const notes: string[] = [];
      await setLabels(c, projectId, issue.id, [...new Set([...current, ...labels])], notes, now);
      if (notes.length > 0) return notes[0];
      return `Added ${labels.map((x) => `~${x}`).join(' ')}.`;
    }
    const current = (await c.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issue.id])).rows.map((r) => r.name);
    const remaining = current.filter((n) => !labels.includes(n));
    const notes: string[] = [];
    await setLabels(c, projectId, issue.id, remaining, notes, now);
    await addNote(`Removed ${labels.map((x) => `~${x}`).join(' ')}.`);
    return `Removed ${labels.map((x) => `~${x}`).join(' ')}.`;
  }
  if (a === '/milestone') {
    const title = args.replace(/^%/, '');
    const m = (await c.query<{ id: number }>(`SELECT id FROM milestones WHERE project_id = $1 AND title = $2`, [projectId, title])).rows[0];
    if (!m) return `Could not apply /milestone: milestone %${title} doesn't exist.`;
    await c.query(`DELETE FROM issue_milestones WHERE issue_id = $1`, [issue.id]);
    await c.query(`INSERT INTO issue_milestones (issue_id, milestone_id) VALUES ($1, $2)`, [issue.id, m.id]);
    await addNote(`Set milestone %${title}.`);
    return `Set milestone %${title}.`;
  }
  if (a === '/weight') {
    const w = parseInt(args, 10);
    if (Number.isNaN(w) || w < 0 || w > 100) return 'Could not apply /weight: weight must be 0 to 100.';
    await c.query(`UPDATE issues SET weight = $2 WHERE id = $1`, [issue.id, w]);
    await addNote(`Set weight to ${w}.`);
    return `Set weight to ${w}.`;
  }
  if (a === '/estimate') {
    const res = normalizeDuration(args);
    if ('error' in res) return `Could not apply /estimate: invalid duration ${args}.`;
    await c.query(`UPDATE issues SET estimate_ms = $2 WHERE id = $1`, [issue.id, res.ms]);
    await addNote(`Set estimate to ${formatDuration(res.ms)}.`);
    return `Set estimate to ${formatDuration(res.ms)}.`;
  }
  if (a === '/spend') {
    const res = normalizeDuration(args);
    if ('error' in res) return `Could not apply /spend: invalid duration ${args}.`;
    await c.query(`UPDATE issues SET spent_ms = COALESCE(spent_ms, 0) + $2 WHERE id = $1`, [issue.id, res.ms]);
    await addNote(`Added ${formatDuration(res.ms)} of time spent.`);
    return `Added ${formatDuration(res.ms)} of time spent.`;
  }
  if (a === '/due') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args) || parseDateOnly(args) === null) {
      return `Could not apply /due: invalid date ${args}.`;
    }
    await c.query(`UPDATE issues SET due_date = $2 WHERE id = $1`, [issue.id, args]);
    await addNote(`Set due date to ${args}.`);
    return `Set due date to ${args}.`;
  }
  if (a === '/close' || a === '/reopen') {
    const to = a === '/close' ? 'closed' : 'opened';
    if (issue.state !== to) {
      await c.query(`UPDATE issues SET state = $2, updated_at = $3 WHERE id = $1`, [issue.id, to, now]);
      await addNote(to === 'closed' ? 'Closed.' : 'Reopened.');
    }
    return to === 'closed' ? 'Closed.' : 'Reopened.';
  }
  if (a === '/confidential') {
    await c.query(`UPDATE issues SET confidential = true WHERE id = $1`, [issue.id]);
    await addNote('Made confidential.');
    return 'Made confidential.';
  }
  if (a === '/relate') {
    const target = parseInt(args.replace(/^#/, ''), 10);
    const other = (await c.query<{ id: number }>(`SELECT id FROM issues WHERE project_id = $1 AND iid = $2`, [projectId, target])).rows[0];
    if (!other) return `Could not apply /relate: issue #${target} doesn't exist.`;
    await c.query(`INSERT INTO issue_links (from_issue, to_issue, kind) VALUES ($1, $2, 'relates') ON CONFLICT DO NOTHING`, [issue.id, other.id]);
    await addNote(`Linked #${target}.`);
    return `Linked #${target}.`;
  }
  if (a === '/promote') {
    const project = (await c.query<{ group_id: number }>(`SELECT group_id FROM projects WHERE id = $1`, [projectId])).rows[0];
    if (!project) return 'Could not apply /promote: epics need a group.';
    const issueFull = (await c.query(`SELECT title, description, confidential, author_id FROM issues WHERE id = $1`, [issue.id])).rows[0];
    const epicIid = await nextEpicIid(c, project.group_id);
    const epic = await c.query<{ id: number }>(`INSERT INTO epics (group_id, iid, title, description, author_id, confidential, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'opened', $7) RETURNING id`,
      [project.group_id, epicIid, issueFull.title, issueFull.description, issueFull.author_id, issueFull.confidential, now]);
    // copy comments
    const comments = (await c.query(`SELECT author, body, created_at FROM notes WHERE issue_id = $1 AND system = false ORDER BY id`, [issue.id])).rows;
    for (const cm of comments) {
      await c.query(`INSERT INTO notes (project_id, author, body, system, pending, created_at) VALUES ($1, $2, $3, false, false, $4)`, [projectId, cm.author, cm.body, cm.created_at]);
      // epic notes live with the epic; store with a link through issue_id of the epic scope is simplified
    }
    await c.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, $5, $6)`,
      [projectId, rc.user!.username, `Copied from #${issue.iid}.`, issue.id, issue.iid, now]);
    // dropped labels
    const labels = (await c.query<{ name: string; group_id: number | null }>(`SELECT l.name, l.group_id FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issue.id])).rows;
    const groupLabels = labels.filter((l) => l.group_id !== null);
    const projectLabels = labels.filter((l) => l.group_id === null);
    if (projectLabels.length > 0 && groupLabels.length < labels.length) {
      const dropped = projectLabels.map((l) => l.name);
      await c.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, $5, $6)`,
        [projectId, rc.user!.username, `Dropped labels: ${dropped.map((d) => `~${d}`).join(', ')}.`, issue.id, issue.iid, now]);
    }
    await c.query(`UPDATE issues SET state = 'closed', updated_at = $2 WHERE id = $1`, [issue.id, now]);
    await c.query(`INSERT INTO epic_issues (epic_id, issue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [epic.rows[0].id, issue.id]);
    await addNote(`Promoted to epic &${epicIid}.`);
    return `Promoted to epic &${epicIid}.`;
  }
  if (a === '/title') {
    const newTitle = args.trim();
    if (newTitle === '') return "Could not apply /title: title can't be blank.";
    await c.query(`UPDATE issues SET title = $2 WHERE id = $1`, [issue.id, newTitle]);
    await addNote(`Changed title to ${newTitle}.`);
    return `Changed title to ${newTitle}.`;
  }
  return null;
}

function splitLabelArgs(args: string): string[] {
  const out: string[] = [];
  const re = /~("[^"]+"|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) {
    let name = m[1];
    if (name.startsWith('"')) name = name.slice(1, -1);
    out.push(name);
  }
  return out;
}

async function findLabel(c: import('pg').PoolClient, projectId: number, name: string): Promise<{ id: number } | null> {
  return (await c.query<{ id: number }>(`SELECT id FROM labels WHERE name = $1 AND (project_id = $2 OR group_id IN (WITH RECURSIVE gg AS (SELECT id, parent_id FROM groups WHERE id = (SELECT group_id FROM projects WHERE id = $2)) SELECT id FROM gg UNION ALL SELECT g2.parent_id IS NOT NULL, g2.parent_id FROM groups g2 JOIN gg ON gg.parent_id = g2.id WHERE FALSE) ) LIMIT 1`, [name, projectId])).rows[0] ?? null;
}

async function nextEpicIid(c: import('pg').PoolClient, groupId: number): Promise<number> {
  const r = await c.query<{ next_iid: number }>(
    `INSERT INTO epic_iids (group_id, next_iid) VALUES ($1, 2) ON CONFLICT (group_id) DO UPDATE SET next_iid = epic_iids.next_iid + 1 RETURNING next_iid - 1`,
    [groupId],
  );
  return r.rows[0].next_iid;
}

export async function getIssueNotes(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const issue = await visibleIssue(client, rc, id, iid, access);
    if (!issue) throw errs.notFound();
    const notes = (await client.query(`SELECT id, author, body, system, pending, created_at FROM notes WHERE issue_id = $1 ORDER BY id`, [issue.id])).rows;
    return { notes };
  } finally {
    client.release();
  }
}

export async function linkIssue(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const target = typeof body.target === 'string' ? parseInt(body.target.replace('#', ''), 10) : null;
  const kind = typeof body.kind === 'string' ? body.kind : 'relates';
  if (target === null) throw errs.validation({ target: "Target can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const issue = await visibleIssue(client, rc, id, iid, access);
    if (!issue) throw errs.notFound();
    const other = await visibleIssue(client, rc, id, target, access);
    if (!other) throw errs.notFound();
    await client.query(`INSERT INTO issue_links (from_issue, to_issue, kind) VALUES ($1, $2, $3)`, [issue.id, other.id, kind]);
    await client.query(`COMMIT`);
    return { linked: target };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export { visibleIssue };
