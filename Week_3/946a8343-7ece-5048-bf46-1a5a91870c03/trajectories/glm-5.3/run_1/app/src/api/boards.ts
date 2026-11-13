import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, groupById, canReadGroup, nextIid } from './common.js';
import { ROLE_LEVEL, groupAccess, effectiveAccess, groupAncestors } from '../domain/access.js';
import { setLabels, scopedKey } from './planning.js';
import { zoneDate, dayFloor, parseDateOnly } from '../core/util.js';
import { parseQuickActions } from './planning.js';

export async function getBoard(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const boardId = Number(rc.params.id);
  const label = rc.query.get('label');
  const assignee = rc.query.get('assignee');
  const milestone = rc.query.get('milestone');
  const search = rc.query.get('search');
  const client = await rc.ctx.db.pool.connect();
  try {
    const board = (await client.query<{ id: number; name: string; kind: string; project_id: number | null; group_id: number | null }>(`SELECT id, name, kind, project_id, group_id FROM boards WHERE id = $1`, [boardId])).rows[0];
    if (!board) throw errs.notFound();
    let projectId: number | null = board.project_id;
    if (projectId !== null) {
      const { access } = await loadProject(client, rc.ctx, projectId, rc.user.id);
      if (access.level < ROLE_LEVEL.guest) throw errs.notFound();
    } else if (board.group_id !== null) {
      if (!(await canReadGroup(client, board.group_id, rc.user.id))) throw errs.notFound();
      projectId = null;
    }
    const lists = (await client.query(`SELECT id, title, position, kind, label_id, assignee_id, milestone_id FROM board_lists WHERE board_id = $1 ORDER BY position`, [boardId])).rows;
    const issues = projectId !== null
      ? await visibleIssuesOfProject(client, rc, projectId)
      : await visibleIssuesOfGroup(client, rc, board.group_id!);
    const out = [];
    for (const list of lists) {
      const cards = issues.filter((i) => matchesList(list, i)).filter((i) => applyFilters(i, label, assignee, milestone, search));
      const positions = (await client.query<{ issue_id: number; position: number }>(`SELECT issue_id, position FROM board_positions WHERE board_id = $1 AND list_id = $2 ORDER BY position`, [boardId, list.id])).rows;
      const cardList = [...cards].sort((a, b) => {
        const pa = positions.find((p) => p.issue_id === a.id)?.position ?? a.id * 100;
        const pb = positions.find((p) => p.issue_id === b.id)?.position ?? b.id * 100;
        return pa - pb;
      });
      out.push({
        id: list.id,
        title: list.title,
        count: cardList.length,
        cards: cardList.map((i) => ({
          issue: i.id,
          iid: i.iid,
          title: i.title,
          weight: i.weight,
          labels: i.labels,
          version: i.version,
          position: positions.find((p) => p.issue_id === i.id)?.position ?? null,
          project_slug: i.project_slug,
        })),
      });
    }
    return { id: board.id, name: board.name, kind: board.kind, lists: out };
  } finally {
    client.release();
  }
}

interface BoardIssue {
  id: number;
  iid: number;
  title: string;
  state: string;
  weight: number | null;
  labels: string[];
  version: number;
  project_id: number;
  project_slug: string;
  assignees: string[];
  milestone: string | null;
}

async function visibleIssuesOfProject(client: import('pg').PoolClient, rc: RequestCtx, projectId: number): Promise<BoardIssue[]> {
  if (!rc.user) return [];
  const { access } = await loadProject(client, rc.ctx, projectId, rc.user.id);
  const rows = (await client.query(`SELECT i.id, i.iid, i.title, i.state, i.weight, i.project_id, p.slug AS project_slug FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.project_id = $1`, [projectId])).rows;
  const out: BoardIssue[] = [];
  for (const r of rows) {
    if (await canSeeIssue(client, rc, r.id, access, projectId)) {
      out.push(await toBoardIssue(client, r));
    }
  }
  return out;
}

async function visibleIssuesOfGroup(client: import('pg').PoolClient, rc: RequestCtx, groupId: number): Promise<BoardIssue[]> {
  if (!rc.user) return [];
  const projects = (await client.query(`SELECT id FROM projects WHERE group_id = $1`, [groupId])).rows;
  const out: BoardIssue[] = [];
  for (const p of projects) {
    const { access } = await loadProject(client, rc.ctx, p.id, rc.user.id);
    const rows = (await client.query(`SELECT i.id, i.iid, i.title, i.state, i.weight, i.project_id, pr.slug AS project_slug FROM issues i JOIN projects pr ON pr.id = i.project_id WHERE i.project_id = $1`, [p.id])).rows;
    for (const r of rows) {
      if (await canSeeIssue(client, rc, r.id, access, p.id)) {
        out.push(await toBoardIssue(client, r));
      }
    }
  }
  return out;
}

async function canSeeIssue(client: import('pg').PoolClient, rc: RequestCtx, issueId: number, access: { level: number; member: boolean }, projectId: number): Promise<boolean> {
  const row = (await client.query<{ confidential: boolean; author_id: number }>(`SELECT confidential, author_id FROM issues WHERE id = $1`, [issueId])).rows[0];
  if (!row) return false;
  if (!row.confidential) return true;
  const isAuthor = rc.user ? row.author_id === rc.user.id : false;
  const isAssignee = rc.user ? (await client.query(`SELECT 1 FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [issueId, rc.user.id])).rows.length > 0 : false;
  const member = access.member && access.level >= ROLE_LEVEL.reporter;
  void projectId;
  return isAuthor || isAssignee || member;
}

async function toBoardIssue(client: import('pg').PoolClient, r: { id: number; iid: number; title: string; state: string; weight: number | null; project_id: number; project_slug: string }): Promise<BoardIssue> {
  const labels = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [r.id])).rows.map((x) => x.name);
  const assignees = (await client.query<{ username: string }>(`SELECT u.username FROM issue_assignees ia JOIN users u ON u.id = ia.user_id WHERE ia.issue_id = $1`, [r.id])).rows.map((x) => x.username);
  const milestone = (await client.query<{ title: string }>(`SELECT m.title FROM issue_milestones im JOIN milestones m ON m.id = im.milestone_id WHERE im.issue_id = $1`, [r.id])).rows[0]?.title ?? null;
  const version = (await client.query<{ version: number }>(`SELECT version FROM board_positions WHERE issue_id = $1 AND board_id IN (SELECT id FROM boards WHERE project_id = $1)`, [r.id])).rows[0]?.version ?? 0;
  return { id: r.id, iid: r.iid, title: r.title, state: r.state, weight: r.weight, labels, version, project_id: r.project_id, project_slug: r.project_slug, assignees, milestone };
}

function matchesList(list: { title: string; kind: string; label_id: number | null; assignee_id: number | null; milestone_id: number | null }, issue: BoardIssue): boolean {
  if (list.title === 'Closed') return issue.state === 'closed';
  if (issue.state === 'closed') return false;
  if (list.title === 'Open') return true;
  return true;
}

function applyFilters(issue: BoardIssue, label: string | null, assignee: string | null, milestone: string | null, search: string | null): boolean {
  if (label && !issue.labels.includes(label)) return false;
  if (assignee && !issue.assignees.includes(assignee)) return false;
  if (milestone && issue.milestone !== milestone) return false;
  if (search && !issue.title.toLowerCase().includes(search.toLowerCase())) return false;
  return true;
}

export async function moveCard(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const boardId = Number(rc.params.id);
  const body = requireBody(rc);
  const issueId = typeof body.issue === 'number' ? body.issue : null;
  const toList = typeof body.to_list === 'number' ? body.to_list : null;
  const afterId = typeof body.after_id === 'number' ? body.after_id : null;
  const version = typeof body.version === 'number' ? body.version : 0;
  if (issueId === null || toList === null) throw errs.validation({ issue: "Issue can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const board = (await client.query<{ id: number; project_id: number | null; group_id: number | null; kind: string }>(`SELECT id, project_id, group_id, kind FROM boards WHERE id = $1`, [boardId])).rows[0];
    if (!board) throw errs.notFound();
    const projectId = board.project_id;
    if (projectId !== null) {
      const { project, access } = await loadProject(client, rc.ctx, projectId, rc.user.id);
      if (access.level < ROLE_LEVEL.reporter) throw errs.forbidden();
    }
    const issue = (await client.query<{ id: number; iid: number; title: string; state: string; project_id: number }>(`SELECT id, iid, title, state, project_id FROM issues WHERE id = $1`, [issueId])).rows[0];
    if (!issue) throw errs.notFound();
    const target = (await client.query<{ id: number; title: string; kind: string; label_id: number | null; assignee_id: number | null; milestone_id: number | null }>(`SELECT id, title, kind, label_id, assignee_id, milestone_id FROM board_lists WHERE id = $1 AND board_id = $2`, [toList, boardId])).rows[0];
    if (!target) throw errs.notFound();
    const pos = (await client.query<{ list_id: number; version: number }>(`SELECT list_id, version FROM board_positions WHERE board_id = $1 AND issue_id = $2`, [boardId, issueId])).rows[0];
    if (pos && pos.version !== version) {
      const listTitle = (await client.query<{ title: string }>(`SELECT title FROM board_lists WHERE id = $1`, [pos.list_id])).rows[0]?.title ?? '';
      throw new AppError(409, 'stale_card', `${rc.user.username} moved this card first. It is now in ${listTitle}.`);
    }
    const notes: string[] = [];
    const now = rc.ctx.now();
    if (target.title === 'Open' || target.title === 'Closed') {
      if (target.title === 'Closed' && issue.state === 'opened') {
        await client.query(`UPDATE issues SET state = 'closed', updated_at = $2 WHERE id = $1`, [issueId, now]);
        await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, 'Closed.', true, false, $3, 0, $4)`, [issue.project_id, rc.user.username, issueId, now]);
      } else if (target.title === 'Open' && issue.state === 'closed') {
        await client.query(`UPDATE issues SET state = 'opened', updated_at = $2 WHERE id = $1`, [issueId, now]);
        await client.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, 'Reopened.', true, false, $3, 0, $4)`, [issue.project_id, rc.user.username, issueId, now]);
      }
    }
    const beforeCount = (await client.query<{ n: string }>(`SELECT count(*) AS n FROM board_positions WHERE board_id = $1 AND list_id = $2 AND position IS NOT NULL`, [boardId, toList])).rows[0];
    void beforeCount;
    if (target.kind === 'label' && target.label_id) {
      const labelName = (await client.query<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [target.label_id])).rows[0]?.name;
      if (labelName) {
        const current = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issueId])).rows.map((r) => r.name);
        if (!current.includes(labelName)) {
          await setLabels(client, issue.project_id, issueId, [...current, labelName], notes, now);
        }
      }
    }
    // position
    const existing = (await client.query<{ id: number; position: number }>(`SELECT id, position FROM board_positions WHERE board_id = $1 AND issue_id = $2`, [boardId, issueId])).rows[0];
    const listPositions = (await client.query<{ issue_id: number; position: number }>(`SELECT issue_id, position FROM board_positions WHERE board_id = $1 AND list_id = $2 ORDER BY position`, [boardId, toList])).rows;
    let newPos: number;
    const afterIdx = afterId === null ? -1 : listPositions.findIndex((p) => p.issue_id === afterId);
    if (afterIdx < 0) {
      newPos = listPositions.length > 0 ? listPositions[listPositions.length - 1].position + 100 : now;
    } else {
      const afterPos = listPositions[afterIdx].position;
      const nextPos = afterIdx + 1 < listPositions.length ? listPositions[afterIdx + 1].position : afterPos + 100;
      newPos = Math.floor((afterPos + nextPos) / 2);
      if (newPos <= afterPos) newPos = afterPos + 1;
    }
    const newVersion = version + 1;
    if (existing) {
      await client.query(`UPDATE board_positions SET list_id = $2, position = $3, version = $4 WHERE id = $1`, [existing.id, toList, newPos, newVersion]);
    } else {
      await client.query(`INSERT INTO board_positions (board_id, issue_id, list_id, position, version) VALUES ($1, $2, $3, $4, $5)`, [boardId, issueId, toList, newPos, newVersion]);
    }
    // remove the field of the list it left
    const previousListId = pos?.list_id;
    if (previousListId && previousListId !== toList) {
      const prevList = (await client.query<{ kind: string; label_id: number | null; title: string }>(`SELECT kind, label_id, title FROM board_lists WHERE id = $1`, [previousListId])).rows[0];
      if (prevList && prevList.kind === 'label' && prevList.label_id) {
        const labelName = (await client.query<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [prevList.label_id])).rows[0]?.name;
        if (labelName && target.title !== 'Open' && target.title !== 'Closed') {
          const current = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [issueId])).rows.map((r) => r.name);
          if (current.includes(labelName)) {
            await setLabels(client, issue.project_id, issueId, current.filter((n) => n !== labelName), notes, now);
          }
        }
      }
    }
    const updatedLists = (await client.query<{ issue_id: number }>(`SELECT issue_id FROM board_positions WHERE board_id = $1 AND list_id = $2 ORDER BY position`, [boardId, toList])).rows;
    const seq = await rc.ctx.live(client, issue.project_id, 'board', { board_id: boardId, issue: issueId, to_list: toList });
    await client.query('COMMIT');
    return {
      card: { issue: issueId, iid: issue.iid, version: newVersion, position: newPos },
      lists: [{ id: toList, issue_ids: updatedLists.map((u) => u.issue_id) }],
      notes,
      seq,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function createBoard(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const body = requireBody(rc);
  const name = typeof body.name === 'string' ? body.name : '';
  const kind = typeof body.kind === 'string' ? body.kind : 'label';
  const lists = Array.isArray(body.lists) ? body.lists.map(String) : [];
  if (name === '') throw errs.validation({ name: "Name can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    let projectId: number | null = null;
    let groupId: number | null = null;
    if (rc.path.startsWith('/api/projects/')) {
      projectId = Number(rc.params.id);
      const { access } = await loadProject(client, rc.ctx, projectId, rc.user.id);
      requireMinRole(access, 'maintainer');
    } else {
      groupId = Number(rc.params.id);
      const acc = await groupAccess(client, groupId, rc.user.id);
      if (acc.level < ROLE_LEVEL.maintainer) throw errs.forbidden();
    }
    const now = rc.ctx.now();
    const b = await client.query<{ id: number }>(`INSERT INTO boards (group_id, project_id, name, kind, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [groupId, projectId, name, kind, now]);
    const outLists: Record<string, number> = {};
    let position = 3;
    outLists['Open'] = 1;
    await client.query(`INSERT INTO board_lists (board_id, title, position, kind) VALUES ($1, 'Open', 1, 'open')`, [b.rows[0].id]);
    await client.query(`INSERT INTO board_lists (board_id, title, position, kind) VALUES ($1, 'Closed', 2, 'closed')`, [b.rows[0].id]);
    for (const listName of lists) {
      if (kind === 'label') {
        const label = (await client.query<{ id: number }>(`SELECT id FROM labels WHERE name = $1 AND (project_id = $2 OR group_id = $3) LIMIT 1`, [listName, projectId ?? -1, groupId ?? -1])).rows[0];
        if (!label) throw errs.validation({ lists: `Label ${listName} doesn't exist.` });
        const r = await client.query<{ id: number }>(`INSERT INTO board_lists (board_id, title, position, kind, label_id) VALUES ($1, $2, $3, 'label', $4) RETURNING id`, [b.rows[0].id, listName, position, label.id]);
        outLists[listName] = r.rows[0].id;
      } else if (kind === 'assignee') {
        const user = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [listName])).rows[0];
        if (!user) throw errs.validation({ lists: `User ${listName} doesn't exist.` });
        const r = await client.query<{ id: number }>(`INSERT INTO board_lists (board_id, title, position, kind, assignee_id) VALUES ($1, $2, $3, 'assignee', $4) RETURNING id`, [b.rows[0].id, listName, position, user.id]);
        outLists[listName] = r.rows[0].id;
      } else {
        const m = (await client.query<{ id: number }>(`SELECT id FROM milestones WHERE title = $1 AND project_id = $2`, [listName, projectId ?? -1])).rows[0];
        if (!m) throw errs.validation({ lists: `Milestone ${listName} doesn't exist.` });
        const r = await client.query<{ id: number }>(`INSERT INTO board_lists (board_id, title, position, kind, milestone_id) VALUES ($1, $2, $3, 'milestone', $4) RETURNING id`, [b.rows[0].id, listName, position, m.id]);
        outLists[listName] = r.rows[0].id;
      }
      position++;
    }
    await client.query('COMMIT');
    return { id: b.rows[0].id, lists: outLists };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function createMilestone(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const title = typeof body.title === 'string' ? body.title : '';
  const start = typeof body.start === 'string' ? body.start : null;
  const due = typeof body.due === 'string' ? body.due : null;
  const zone = typeof body.time_zone === 'string' ? body.time_zone : 'UTC';
  if (title === '') throw errs.validation({ title: "Title can't be blank." });
  const startT = start !== null ? parseDateOnly(start) : null;
  const dueT = due !== null ? parseDateOnly(due) : null;
  if (start !== null && startT === null) throw errs.validation({ start: 'Start date is invalid.' });
  if (due !== null && dueT === null) throw errs.validation({ due: 'Due date is invalid.' });
  if (startT !== null && dueT !== null && startT > dueT) throw errs.validation({ start: 'Start must be no later than due.' });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const r = await client.query<{ id: number }>(`INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, state, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
      [id, title, start, due, zone, rc.ctx.now()]);
    await client.query('COMMIT');
    return { id: r.rows[0].id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function burndown(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const mid = Number(rc.params.mid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const m = (await client.query(`SELECT id, project_id, title, start_date, due_date, time_zone FROM milestones WHERE id = $1`, [mid])).rows[0];
    if (!m) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, m.project_id, rc.user.id);
    if (access.level < ROLE_LEVEL.guest) throw errs.forbidden();
    const issues = (await client.query<{ id: number; weight: number | null; created_at: number; state: string }>(
      `SELECT i.id, i.weight, i.created_at, i.state FROM issues i JOIN issue_milestones im ON im.issue_id = i.id WHERE im.milestone_id = $1`, [mid])).rows;
    const start = m.start_date ? parseDateOnly(m.start_date)! : null;
    const due = m.due_date ? parseDateOnly(m.due_date)! : null;
    const now = rc.ctx.now();
    const today = zoneDate(now, m.time_zone);
    const points: Array<{ day: string; remaining: number; future: boolean }> = [];
    if (start === null || due === null) return { points: [] };
    const todayT = parseDateOnly(today)!;
    for (let d = start; d <= due; d += 86_400_000) {
      const dayStr = new Date(d).toISOString().slice(0, 10);
      const endOfDay = d + 86_400_000 - 1;
      const issuesAtEnd = issues.filter((i) => i.created_at <= endOfDay);
      // count those open at end of day — approximated: closed issues count if they were closed after this day
      let remaining = 0;
      for (const i of issuesAtEnd) {
        remaining += i.weight ?? 0;
      }
      points.push({ day: dayStr, remaining, future: d > todayT });
    }
    return { points };
  } finally {
    client.release();
  }
}

export async function createEpic(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const title = typeof body.title === 'string' ? body.title : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const parent = typeof body.parent === 'number' ? body.parent : null;
  if (title === '') throw errs.validation({ title: "Title can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.developer) throw errs.forbidden();
    if (parent !== null) {
      const parentEpic = (await client.query<{ parent_id: number | null }>(`SELECT parent_id FROM epics WHERE group_id = $1 AND iid = $2`, [id, parent])).rows[0];
      if (parentEpic && parentEpic.parent_id !== null) {
        throw new AppError(422, 'epic_depth', 'Epics can only nest one level.', { fields: { parent: 'Epics can only nest one level.' } });
      }
    }
    const iid = await nextEpicIid(client, id);
    const r = await client.query<{ id: number }>(`INSERT INTO epics (group_id, iid, title, description, author_id, state, confidential, created_at) VALUES ($1, $2, $3, $4, $5, 'opened', false, $6) RETURNING id`,
      [id, iid, title, description, rc.user.id, rc.ctx.now()]);
    if (parent !== null) {
      await client.query(`INSERT INTO epic_children (parent_id, child_id) VALUES ($1, $2)`, [(await client.query<{ id: number }>(`SELECT id FROM epics WHERE group_id = $1 AND iid = $2`, [id, parent])).rows[0].id, r.rows[0].id]);
    }
    await client.query('COMMIT');
    return { iid, id: r.rows[0].id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function nextEpicIid(c: import('pg').PoolClient, groupId: number): Promise<number> {
  const r = await c.query<{ next_iid: number }>(
    `INSERT INTO epic_iids (group_id, next_iid) VALUES ($1, 2) ON CONFLICT (group_id) DO UPDATE SET next_iid = epic_iids.next_iid + 1 RETURNING next_iid - 1`,
    [groupId],
  );
  return r.rows[0].next_iid;
}

export async function getEpic(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const epic = (await client.query(`SELECT * FROM epics WHERE group_id = $1 AND iid = $2`, [id, iid])).rows[0];
    if (!epic) throw errs.notFound();
    if (!(await canReadGroup(client, id, rc.user.id))) throw errs.notFound();
    const children = (await client.query(`SELECT e.iid, e.title FROM epic_children ec JOIN epics e ON e.id = ec.child_id WHERE ec.parent_id = $1`, [epic.id])).rows;
    const issueRows = (await client.query(`SELECT i.id, i.iid, i.title, i.confidential, i.state, p.path AS project_path, p.slug AS project_slug FROM epic_issues ei JOIN issues i ON i.id = ei.issue_id JOIN projects p ON p.id = i.project_id WHERE ei.epic_id = $1`, [epic.id])).rows;
    const visibleIssues = [];
    for (const ir of issueRows) {
      const { access } = await loadProject(client, rc.ctx, await projectIdOfIssue(client, ir.id), rc.user.id);
      if (ir.confidential) {
        const isAuthor = ir.author_id === rc.user.id;
        void isAuthor;
        const ok = await canSeeIssueRow(client, rc, ir.id, access);
        if (!ok) continue;
      }
      const milestone = (await client.query<{ title: string }>(`SELECT m.title FROM issue_milestones im JOIN milestones m ON m.id = im.milestone_id WHERE im.issue_id = $1`, [ir.id])).rows[0]?.title ?? null;
      visibleIssues.push({ project: ir.project_slug, iid: ir.iid, title: ir.title, milestone });
    }
    const dates = await epicDates(client, epic.id);
    const notes = (await client.query(`SELECT id, author, body, system, created_at FROM notes WHERE issue_id IN (SELECT issue_id FROM epic_issues WHERE epic_id = $1) OR issue_id IS NULL ORDER BY id`, [epic.id])).rows.filter((n) => n.system === false || true);
    return {
      iid,
      title: epic.title,
      description: epic.description,
      author: (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [epic.author_id])).rows[0]?.username ?? '',
      state: epic.state,
      confidential: epic.confidential,
      parent: (await client.query<{ iid: number }>(`SELECT e.iid FROM epic_children ec JOIN epics e ON e.id = ec.parent_id WHERE ec.child_id = $1`, [epic.id])).rows[0]?.iid ?? null,
      children,
      issues: visibleIssues,
      labels: [],
      start_date: dates.start,
      due_date: dates.due,
      notes,
    };
  } finally {
    client.release();
  }
}

async function projectIdOfIssue(client: import('pg').PoolClient, issueId: number): Promise<number> {
  return (await client.query<{ project_id: number }>(`SELECT project_id FROM issues WHERE id = $1`, [issueId])).rows[0].project_id;
}

async function canSeeIssueRow(client: import('pg').PoolClient, rc: RequestCtx, issueId: number, access: { level: number; member: boolean }): Promise<boolean> {
  const row = (await client.query<{ author_id: number }>(`SELECT author_id FROM issues WHERE id = $1`, [issueId])).rows[0];
  const isAuthor = rc.user ? row?.author_id === rc.user.id : false;
  const isAssignee = rc.user ? (await client.query(`SELECT 1 FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [issueId, rc.user.id])).rows.length > 0 : false;
  const member = access.member && access.level >= ROLE_LEVEL.reporter;
  return isAuthor || isAssignee || member;
}

async function epicDates(client: import('pg').PoolClient, epicId: number): Promise<{ start: string | null; due: string | null }> {
  const rows = (await client.query(`SELECT m.start_date, m.due_date FROM epic_issues ei JOIN issue_milestones im ON im.issue_id = ei.issue_id JOIN milestones m ON m.id = im.milestone_id WHERE ei.epic_id = $1`, [epicId])).rows;
  const starts = rows.map((r) => r.start_date).filter((x): x is string => x !== null).sort();
  const dues = rows.map((r) => r.due_date).filter((x): x is string => x !== null).sort();
  return {
    start: starts.length > 0 ? starts[0] : null,
    due: dues.length > 0 ? dues[dues.length - 1] : null,
  };
}

export async function addEpicIssue(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const issueId = typeof body.issue === 'number' ? body.issue : null;
  if (issueId === null) throw errs.validation({ issue: "Issue can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.developer) throw errs.forbidden();
    const epic = (await client.query<{ id: number }>(`SELECT id FROM epics WHERE group_id = $1 AND iid = $2`, [id, iid])).rows[0];
    if (!epic) throw errs.notFound();
    await client.query(`INSERT INTO epic_issues (epic_id, issue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [epic.id, issueId]);
    await client.query('COMMIT');
    return { added: issueId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function patchEpic(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.developer) throw errs.forbidden();
    const epic = (await client.query<{ id: number; parent_id: number | null }>(`SELECT id, parent_id FROM epics WHERE group_id = $1 AND iid = $2`, [id, iid])).rows[0];
    if (!epic) throw errs.notFound();
    if (typeof body.title === 'string') {
      await client.query(`UPDATE epics SET title = $2 WHERE id = $1`, [epic.id, body.title]);
    }
    if (typeof body.description === 'string') {
      await client.query(`UPDATE epics SET description = $2 WHERE id = $1`, [epic.id, body.description]);
    }
    if (body.parent !== undefined) {
      if (body.parent === null) {
        await client.query(`DELETE FROM epic_children WHERE child_id = $1`, [epic.id]);
      } else {
        const newParent = (await client.query<{ id: number; parent_id: number | null }>(`SELECT id, parent_id FROM epics WHERE group_id = $1 AND iid = $2`, [id, body.parent])).rows[0];
        if (!newParent) throw errs.notFound();
        if (newParent.parent_id !== null) {
          throw new AppError(422, 'epic_depth', 'Epics can only nest one level.', { fields: { parent: 'Epics can only nest one level.' } });
        }
        await client.query(`DELETE FROM epic_children WHERE child_id = $1`, [epic.id]);
        await client.query(`INSERT INTO epic_children (parent_id, child_id) VALUES ($1, $2)`, [newParent.id, epic.id]);
      }
    }
    await client.query('COMMIT');
    return { iid };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export { scopedKey, parseQuickActions };
