import { Access, ProjectRow, loadGroup, projectAccess, roleLevels } from './access';
import { nowMs } from './clock';
import { Sql } from './db';
import { errors } from './errors';
import { Tx, emit } from './live';
import { queueEvent } from './webhooks';

export type IssueRow = {
  id: number;
  project_id: number;
  iid: number;
  title: string;
  description: string;
  author: string;
  state: string;
  labels: string[];
  assignees: string[];
  milestone_id: number | null;
  weight: number | null;
  confidential: boolean;
  due_date: string | null;
  estimate_m: number | null;
  spent_m: number;
  position: number;
  card_version: number;
};

export type BoardList = { id: number; title: string; value: string | null };

export function labelKey(name: string): string | null {
  const index = name.lastIndexOf('::');
  return index === -1 ? null : name.slice(0, index);
}

export function titleErrors(title: string): string | null {
  if (title.trim() === '') return "Title can't be blank.";
  if (title.length > 255) return 'Title is too long (255 characters at most).';
  return null;
}

export function parseDurationText(text: string): number | null {
  const parts = text.trim().split(/\s+/);
  let total = 0;
  for (const part of parts) {
    const match = /^(\d+)(mo|w|d|h|m)$/.exec(part);
    if (match === null) return null;
    const amount = Number(match[1]);
    const unit = match[2];
    const minutes =
      unit === 'mo' ? 4 * 5 * 8 * 60 : unit === 'w' ? 5 * 8 * 60 : unit === 'd' ? 8 * 60 : unit === 'h' ? 60 : 1;
    total += amount * minutes;
  }
  return total;
}

export function formatDuration(minutes: number): string {
  const units: [string, number][] = [
    ['mo', 4 * 5 * 8 * 60],
    ['w', 5 * 8 * 60],
    ['d', 8 * 60],
    ['h', 60],
    ['m', 1],
  ];
  let left = minutes;
  const out: string[] = [];
  for (const [name, size] of units) {
    const count = Math.floor(left / size);
    if (count > 0) {
      out.push(`${count}${name}`);
      left -= count * size;
    }
  }
  return out.length === 0 ? '0m' : out.join(' ');
}

export async function loadIssue(sql: Sql, projectId: number, iid: number): Promise<IssueRow | null> {
  const row = await sql.one<IssueRow>(
    `select id, project_id, iid, title, description, author, state, labels, assignees, milestone_id, weight,
            confidential, due_date::text as due_date, estimate_m, spent_m, position, card_version
     from issues where project_id = $1 and iid = $2`,
    [projectId, iid],
  );
  return row === null ? null : normalizeIssue(row);
}

export async function issueById(sql: Sql, id: number): Promise<IssueRow | null> {
  const row = await sql.one<IssueRow>(
    `select id, project_id, iid, title, description, author, state, labels, assignees, milestone_id, weight,
            confidential, due_date::text as due_date, estimate_m, spent_m, position, card_version
     from issues where id = $1`,
    [id],
  );
  return row === null ? null : normalizeIssue(row);
}

function normalizeIssue(row: IssueRow): IssueRow {
  return {
    ...row,
    id: Number(row.id),
    project_id: Number(row.project_id),
    iid: Number(row.iid),
    milestone_id: row.milestone_id === null ? null : Number(row.milestone_id),
    weight: row.weight === null ? null : Number(row.weight),
    estimate_m: row.estimate_m === null ? null : Number(row.estimate_m),
    spent_m: Number(row.spent_m),
    position: Number(row.position),
    card_version: Number(row.card_version),
  };
}

export async function canSeeConfidential(
  sql: Sql,
  project: ProjectRow,
  userId: number,
  issue: { author: string; assignees: string[] },
): Promise<boolean> {
  const user = await sql.one<{ username: string }>('select username from users where id = $1', [userId]);
  const username = user?.username ?? '';
  if (issue.author === username) return true;
  if (issue.assignees.includes(username)) return true;
  const access = await projectAccess(sql, project, userId);
  return !access.implied && access.level >= roleLevels.reporter;
}

export async function visibleIssues(sql: Sql, project: ProjectRow, userId: number): Promise<IssueRow[]> {
  const rows = await sql.query<IssueRow>(
    `select id, project_id, iid, title, description, author, state, labels, assignees, milestone_id, weight,
            confidential, due_date::text as due_date, estimate_m, spent_m, position, card_version
     from issues where project_id = $1 order by iid`,
    [project.id],
  );
  const out: IssueRow[] = [];
  for (const raw of rows) {
    const issue = normalizeIssue(raw);
    if (issue.confidential && !(await canSeeConfidential(sql, project, userId, issue))) continue;
    out.push(issue);
  }
  return out;
}

export async function addIssueNote(
  t: Tx,
  issue: IssueRow,
  author: string,
  body: string,
  system: boolean,
): Promise<number> {
  const row = await t.sql.one<{ id: string }>(
    `insert into notes (project_id, issue_id, author, body, system, created_ms)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [issue.project_id, issue.id, author, body, system, nowMs()],
  );
  return Number(row?.id);
}

async function recordEvent(t: Tx, issue: IssueRow, kind: string, data: Record<string, unknown>): Promise<void> {
  await t.sql.query('insert into issue_events (issue_id, at_ms, kind, data) values ($1, $2, $3, $4)', [
    issue.id,
    nowMs(),
    kind,
    JSON.stringify(data),
  ]);
}

export async function createIssue(
  t: Tx,
  project: ProjectRow,
  author: string,
  input: {
    title: string;
    description?: string;
    labels?: string[];
    assignees?: string[];
    milestone?: number | null;
    weight?: number | null;
    confidential?: boolean;
    due_date?: string | null;
  },
): Promise<IssueRow> {
  const failure = titleErrors(input.title);
  if (failure !== null) throw errors.validation('title', failure);
  if (input.weight !== null && input.weight !== undefined && (input.weight < 0 || input.weight > 100)) {
    throw errors.validation('weight', 'Weight must be 0 to 100.');
  }
  const iidRow = await t.sql.one<{ next_issue_iid: number }>(
    'update projects set next_issue_iid = next_issue_iid + 1 where id = $1 returning next_issue_iid - 1 as next_issue_iid',
    [project.id],
  );
  const iid = Number(iidRow?.next_issue_iid ?? 1);
  const labels = resolveScoped(input.labels ?? []);
  const row = await t.sql.one<{ id: string }>(
    `insert into issues (project_id, iid, title, description, author, state, labels, assignees, milestone_id,
                         weight, confidential, due_date, position, created_ms)
     values ($1, $2, $3, $4, $5, 'opened', $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [
      project.id,
      iid,
      input.title,
      input.description ?? '',
      author,
      JSON.stringify(labels),
      JSON.stringify(input.assignees ?? []),
      input.milestone ?? null,
      input.weight ?? null,
      input.confidential === true,
      input.due_date ?? null,
      nowMs(),
      nowMs(),
    ],
  );
  const issue = await issueById(t.sql, Number(row?.id));
  if (issue === null) throw errors.notFound();
  await recordEvent(t, issue, 'created', { weight: issue.weight ?? 0, milestone: issue.milestone_id });
  await emit(t, project.id, 'issue', { iid, state: 'opened' });
  if (!issue.confidential) {
    await queueEvent(t, project, 'issue', {
      event: 'issue',
      action: 'open',
      project: { id: project.id, path: project.path },
      issue: { iid, title: issue.title, state: 'opened' },
    });
  }
  return issue;
}

function resolveScoped(labels: string[]): string[] {
  const out: string[] = [];
  for (const label of labels) {
    const key = labelKey(label);
    if (key === null) {
      if (!out.includes(label)) out.push(label);
      continue;
    }
    const filtered = out.filter((item) => labelKey(item) !== key);
    filtered.push(label);
    out.length = 0;
    out.push(...filtered);
  }
  return out;
}

export async function applyLabelChanges(
  t: Tx,
  project: ProjectRow,
  issue: IssueRow,
  add: string[],
  remove: string[],
): Promise<string[]> {
  const current = [...issue.labels];
  const replaced: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  let next = current.filter((label) => !remove.includes(label));
  for (const label of remove) {
    if (current.includes(label)) removed.push(label);
  }
  for (const label of add) {
    if (next.includes(label)) continue;
    const key = labelKey(label);
    if (key !== null) {
      const sibling = next.find((item) => labelKey(item) === key);
      if (sibling !== undefined) {
        next = next.filter((item) => item !== sibling);
        next.push(label);
        replaced.push(`Replaced ~${sibling} with ~${label}.`);
        continue;
      }
    }
    next.push(label);
    added.push(label);
  }
  await t.sql.query('update issues set labels = $2 where id = $1', [issue.id, JSON.stringify(next)]);
  const notes: string[] = [...replaced];
  if (added.length > 0) notes.push(`Added ${added.map((label) => `~${label}`).join(' ')}.`);
  if (removed.length > 0) notes.push(`Removed ${removed.map((label) => `~${label}`).join(' ')}.`);
  for (const note of notes) {
    await addIssueNote(t, issue, 'system', note, true);
  }
  await emit(t, project.id, 'issue', { iid: issue.iid, labels: next });
  return notes;
}

export async function setIssueState(
  t: Tx,
  project: ProjectRow,
  issue: IssueRow,
  state: 'opened' | 'closed',
  actor: string,
  note?: string,
): Promise<void> {
  if (issue.state === state) return;
  await t.sql.query('update issues set state = $2, closed_ms = $3 where id = $1', [
    issue.id,
    state,
    state === 'closed' ? nowMs() : null,
  ]);
  await recordEvent(t, issue, state === 'closed' ? 'closed' : 'reopened', {});
  await addIssueNote(t, issue, actor, note ?? (state === 'closed' ? 'Closed.' : 'Reopened.'), true);
  await emit(t, project.id, 'issue', {
    iid: issue.iid,
    state,
    announcement: note ?? (state === 'closed' ? 'Closed.' : 'Reopened.'),
  });
  if (!issue.confidential) {
    await queueEvent(t, project, 'issue', {
      event: 'issue',
      action: state === 'closed' ? 'close' : 'reopen',
      project: { id: project.id, path: project.path },
      issue: { iid: issue.iid, title: issue.title, state },
    });
  }
}

export async function closeIssue(
  t: Tx,
  project: ProjectRow,
  iid: number,
  actor: string,
  note: string,
): Promise<void> {
  const issue = await loadIssue(t.sql, project.id, iid);
  if (issue === null || issue.state === 'closed') return;
  await setIssueState(t, project, issue, 'closed', actor, note);
}

export type QuickResult = { text: string };

export async function runQuickActions(
  t: Tx,
  project: ProjectRow,
  issue: IssueRow,
  actor: string,
  body: string,
  allowed: string[] | null,
): Promise<{ remaining: string; results: string[] }> {
  const lines = body.split('\n');
  const keep: string[] = [];
  const results: string[] = [];
  let current = issue;
  for (const line of lines) {
    const match = /^\/(\w+)\s*(.*)$/.exec(line.trim());
    if (match === null) {
      keep.push(line);
      continue;
    }
    const action = match[1];
    const argument = match[2].trim();
    if (allowed !== null && !allowed.includes(action)) {
      keep.push(line);
      continue;
    }
    const outcome = await runAction(t, project, current, actor, action, argument);
    if (outcome === null) {
      keep.push(line);
      continue;
    }
    results.push(outcome);
    const reloaded = await issueById(t.sql, current.id);
    if (reloaded !== null) current = reloaded;
  }
  for (const result of results) {
    await addIssueNote(t, current, actor, result, true);
    await emit(t, project.id, 'issue', { iid: current.iid, announcement: result });
  }
  return { remaining: keep.join('\n').trim(), results };
}

function quoted(argument: string): string[] {
  const out: string[] = [];
  const pattern = /~"([^"]+)"|~(\S+)|%"([^"]+)"|%(\S+)|@(\S+)|#(\d+)/g;
  for (const match of argument.matchAll(pattern)) {
    out.push(match.slice(1).find((value) => value !== undefined) ?? '');
  }
  return out;
}

async function labelExists(sql: Sql, project: ProjectRow, name: string): Promise<boolean> {
  const row = await sql.one<{ id: string }>(
    `select l.id from labels l where l.name = $1 and (l.project_id = $2 or l.group_id in (
       with recursive chain as (
         select id, parent_id from groups where id = $3
         union all select g.id, g.parent_id from groups g join chain c on g.id = c.parent_id
       ) select id from chain))
     limit 1`,
    [name, project.id, project.group_id],
  );
  return row !== null;
}

async function runAction(
  t: Tx,
  project: ProjectRow,
  issue: IssueRow,
  actor: string,
  action: string,
  argument: string,
): Promise<string | null> {
  const names = quoted(argument);
  if (action === 'assign' || action === 'unassign') {
    const username = names[0] ?? argument.replace('@', '');
    const user = await t.sql.one<{ id: string }>('select id from users where username = $1', [username]);
    if (user === null) return `Could not apply /${action}: user @${username} doesn't exist.`;
    const next =
      action === 'assign'
        ? [...new Set([...issue.assignees, username])]
        : issue.assignees.filter((item) => item !== username);
    await t.sql.query('update issues set assignees = $2 where id = $1', [issue.id, JSON.stringify(next)]);
    return action === 'assign' ? `Assigned @${username}.` : `Unassigned @${username}.`;
  }
  if (action === 'label' || action === 'unlabel') {
    for (const name of names) {
      if (!(await labelExists(t.sql, project, name))) {
        return `Could not apply /${action}: label ~${name} doesn't exist.`;
      }
    }
    const notes = await applyLabelChanges(
      t,
      project,
      issue,
      action === 'label' ? names : [],
      action === 'unlabel' ? names : [],
    );
    return notes.length === 0 ? null : notes.join(' ');
  }
  if (action === 'milestone') {
    const title = names[0] ?? argument.replace('%', '');
    const milestone = await t.sql.one<{ id: string }>(
      'select id from milestones where project_id = $1 and title = $2',
      [project.id, title],
    );
    if (milestone === null) return `Could not apply /milestone: milestone %${title} doesn't exist.`;
    await t.sql.query('update issues set milestone_id = $2 where id = $1', [issue.id, Number(milestone.id)]);
    await recordEvent(t, issue, 'milestone', { milestone: Number(milestone.id) });
    return `Set milestone %${title}.`;
  }
  if (action === 'weight') {
    const weight = Number(argument);
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
      return 'Could not apply /weight: weight must be 0 to 100.';
    }
    await t.sql.query('update issues set weight = $2 where id = $1', [issue.id, weight]);
    await recordEvent(t, issue, 'weight', { weight });
    return `Set weight to ${weight}.`;
  }
  if (action === 'estimate' || action === 'spend') {
    const minutes = parseDurationText(argument);
    if (minutes === null) return `Could not apply /${action}: invalid duration ${argument}.`;
    if (action === 'estimate') {
      await t.sql.query('update issues set estimate_m = $2 where id = $1', [issue.id, minutes]);
      return `Set estimate to ${formatDuration(minutes)}.`;
    }
    await t.sql.query('update issues set spent_m = spent_m + $2 where id = $1', [issue.id, minutes]);
    return `Added ${formatDuration(minutes)} of time spent.`;
  }
  if (action === 'due') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(argument)) return `Could not apply /due: invalid duration ${argument}.`;
    await t.sql.query('update issues set due_date = $2 where id = $1', [issue.id, argument]);
    return `Set due date to ${argument}.`;
  }
  if (action === 'close') {
    await setIssueState(t, project, issue, 'closed', actor, 'Closed.');
    return null;
  }
  if (action === 'reopen') {
    await setIssueState(t, project, issue, 'opened', actor, 'Reopened.');
    return null;
  }
  if (action === 'confidential') {
    await t.sql.query('update issues set confidential = true where id = $1', [issue.id]);
    return 'Made confidential.';
  }
  if (action === 'relate') {
    const iid = Number(names[0] ?? argument.replace('#', ''));
    const target = await loadIssue(t.sql, project.id, iid);
    if (target === null) return `Could not apply /relate: label ~#${iid} doesn't exist.`;
    await t.sql.query('insert into issue_links (issue_id, target_id, kind) values ($1, $2, $3)', [
      issue.id,
      target.id,
      'relates',
    ]);
    return `Linked #${iid}.`;
  }
  if (action === 'promote') {
    const epic = await promoteToEpic(t, project, issue, actor);
    if (epic === null) return 'Could not apply /promote: epics need a group.';
    return `Promoted to epic &${epic}.`;
  }
  if (action === 'title') {
    const failure = titleErrors(argument);
    if (failure !== null) return `Could not apply /title: ${failure}`;
    await t.sql.query('update issues set title = $2 where id = $1', [issue.id, argument]);
    return `Changed title to ${argument}.`;
  }
  return null;
}

export async function promoteToEpic(
  t: Tx,
  project: ProjectRow,
  issue: IssueRow,
  actor: string,
): Promise<number | null> {
  const group = await loadGroup(t.sql, project.group_id);
  if (group === null) return null;
  const groupLabels = await t.sql.query<{ name: string }>(
    `with recursive chain as (
       select id, parent_id from groups where id = $1
       union all select g.id, g.parent_id from groups g join chain c on g.id = c.parent_id
     )
     select name from labels where group_id in (select id from chain)`,
    [group.id],
  );
  const keptLabels = issue.labels.filter((label) => groupLabels.some((row) => row.name === label));
  const dropped = issue.labels.filter((label) => !keptLabels.includes(label));
  const iidRow = await t.sql.one<{ iid: number }>(
    'select coalesce(max(iid), 0) + 1 as iid from epics where group_id = $1',
    [group.id],
  );
  const iid = Number(iidRow?.iid ?? 1);
  const epicRow = await t.sql.one<{ id: string }>(
    `insert into epics (group_id, iid, title, description, author, state, confidential, labels)
     values ($1, $2, $3, $4, $5, 'opened', $6, $7) returning id`,
    [group.id, iid, issue.title, issue.description, issue.author, issue.confidential, JSON.stringify(keptLabels)],
  );
  const epicId = Number(epicRow?.id);
  const comments = await t.sql.query<{ author: string; body: string; created_ms: string }>(
    'select author, body, created_ms from notes where issue_id = $1 and system = false order by id',
    [issue.id],
  );
  for (const comment of comments) {
    await t.sql.query(
      'insert into notes (group_id, epic_id, author, body, system, created_ms) values ($1, $2, $3, $4, false, $5)',
      [group.id, epicId, comment.author, comment.body, Number(comment.created_ms)],
    );
  }
  await t.sql.query(
    'insert into notes (group_id, epic_id, author, body, system, created_ms) values ($1, $2, $3, $4, true, $5)',
    [group.id, epicId, actor, `Copied from #${issue.iid}.`, nowMs()],
  );
  if (dropped.length > 0) {
    await t.sql.query(
      'insert into notes (group_id, epic_id, author, body, system, created_ms) values ($1, $2, $3, $4, true, $5)',
      [group.id, epicId, actor, `Dropped labels: ${dropped.map((label) => `~${label}`).join(', ')}.`, nowMs()],
    );
  }
  await t.sql.query('insert into epic_issues (epic_id, issue_id) values ($1, $2) on conflict do nothing', [
    epicId,
    issue.id,
  ]);
  await setIssueState(t, project, issue, 'closed', actor, 'Closed.');
  await emit(t, project.id, 'epic', { epic_iid: iid });
  return iid;
}

export async function epicJson(sql: Sql, groupId: number, iid: number, viewerId: number): Promise<Record<string, unknown> | null> {
  const epic = await sql.one<{
    id: string;
    iid: number;
    title: string;
    description: string;
    author: string;
    state: string;
    confidential: boolean;
    parent_id: string | null;
    labels: string[];
  }>(
    `select id, iid, title, description, author, state, confidential, parent_id, labels
     from epics where group_id = $1 and iid = $2`,
    [groupId, iid],
  );
  if (epic === null) return null;
  const epicId = Number(epic.id);
  const children = await sql.query<{ iid: number; title: string }>(
    'select iid, title from epics where parent_id = $1 order by iid',
    [epicId],
  );
  const issueRows = await sql.query<{ id: string; project_id: string; iid: number; title: string; milestone_id: string | null }>(
    `select i.id, i.project_id, i.iid, i.title, i.milestone_id
     from epic_issues e join issues i on i.id = e.issue_id where e.epic_id = $1 order by i.iid`,
    [epicId],
  );
  const issues: Record<string, unknown>[] = [];
  let start: string | null = null;
  let due: string | null = null;
  for (const row of issueRows) {
    const { loadProject } = await import('./access');
    const project = await loadProject(sql, Number(row.project_id));
    if (project === null) continue;
    const access = await projectAccess(sql, project, viewerId);
    if (access.level === 0) continue;
    let milestoneTitle: string | null = null;
    if (row.milestone_id !== null) {
      const milestone = await sql.one<{ title: string; start_date: string | null; due_date: string | null }>(
        'select title, start_date::text as start_date, due_date::text as due_date from milestones where id = $1',
        [Number(row.milestone_id)],
      );
      if (milestone !== null) {
        milestoneTitle = milestone.title;
        if (milestone.start_date !== null && (start === null || milestone.start_date < start)) start = milestone.start_date;
        if (milestone.due_date !== null && (due === null || milestone.due_date > due)) due = milestone.due_date;
      }
    }
    issues.push({ project: project.path, iid: Number(row.iid), title: row.title, milestone: milestoneTitle });
  }
  const notes = await sql.query<{ id: string; author: string; body: string; system: boolean; created_at: string }>(
    'select id, author, body, system, created_at from notes where epic_id = $1 order by id',
    [epicId],
  );
  const parent =
    epic.parent_id === null
      ? null
      : await sql.one<{ iid: number }>('select iid from epics where id = $1', [Number(epic.parent_id)]);
  return {
    iid: Number(epic.iid),
    title: epic.title,
    description: epic.description,
    author: epic.author,
    state: epic.state,
    confidential: epic.confidential,
    parent: parent === null ? null : Number(parent.iid),
    children: children.map((row) => ({ iid: Number(row.iid), title: row.title })),
    issues,
    labels: epic.labels,
    start_date: start,
    due_date: due,
    notes: notes.map((row) => ({
      id: Number(row.id),
      author: row.author,
      body: row.body,
      system: row.system,
      pending: false,
      thread_id: null,
      created_at: row.created_at,
    })),
  };
}

export async function burndown(sql: Sql, milestoneId: number): Promise<{ points: { day: string; remaining: number; future: boolean }[] }> {
  const milestone = await sql.one<{ start_date: string; due_date: string; time_zone: string; project_id: string }>(
    'select start_date::text as start_date, due_date::text as due_date, time_zone, project_id from milestones where id = $1',
    [milestoneId],
  );
  if (milestone === null) throw errors.notFound();
  const issues = await sql.query<{ id: string; weight: number | null; created_ms: string }>(
    'select id, weight, created_ms from issues where milestone_id = $1',
    [milestoneId],
  );
  const events = await sql.query<{ issue_id: string; at_ms: string; kind: string; data: Record<string, unknown> }>(
    'select issue_id, at_ms, kind, data from issue_events where issue_id = any($1) order by at_ms, id',
    [issues.map((row) => Number(row.id))],
  );
  const points: { day: string; remaining: number; future: boolean }[] = [];
  const zone = milestone.time_zone;
  const endOfDay = (day: string): number => {
    const next = new Date(`${day}T00:00:00Z`).getTime() + 86400000;
    return next;
  };
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(nowMs()),
  );
  let cursor = milestone.start_date;
  let todayValue = 0;
  const values: { day: string; remaining: number }[] = [];
  while (cursor <= milestone.due_date) {
    const cutoff = endOfDay(cursor);
    let remaining = 0;
    for (const issue of issues) {
      const id = Number(issue.id);
      if (Number(issue.created_ms) > cutoff) continue;
      let open = true;
      let weight = 0;
      const created = events.find((event) => Number(event.issue_id) === id && event.kind === 'created');
      if (created !== undefined) weight = Number((created.data as { weight?: number }).weight ?? 0);
      for (const event of events) {
        if (Number(event.issue_id) !== id) continue;
        if (Number(event.at_ms) > cutoff) continue;
        if (event.kind === 'closed') open = false;
        if (event.kind === 'reopened') open = true;
        if (event.kind === 'weight') weight = Number((event.data as { weight?: number }).weight ?? 0);
      }
      if (open) remaining += weight;
    }
    values.push({ day: cursor, remaining });
    if (cursor <= todayKey) todayValue = remaining;
    const next = new Date(`${cursor}T00:00:00Z`).getTime() + 86400000;
    cursor = new Date(next).toISOString().slice(0, 10);
  }
  for (const value of values) {
    const future = value.day > todayKey;
    points.push({ day: value.day, remaining: future ? todayValue : value.remaining, future });
  }
  return { points };
}

export async function boardLists(sql: Sql, boardId: number): Promise<{ board: { id: number; name: string; kind: string; project_id: number | null; group_id: number | null }; lists: BoardList[] }> {
  const board = await sql.one<{ id: string; name: string; kind: string; lists: BoardList[]; project_id: string | null; group_id: string | null }>(
    'select id, name, kind, lists, project_id, group_id from boards where id = $1',
    [boardId],
  );
  if (board === null) throw errors.notFound();
  return {
    board: {
      id: Number(board.id),
      name: board.name,
      kind: board.kind,
      project_id: board.project_id === null ? null : Number(board.project_id),
      group_id: board.group_id === null ? null : Number(board.group_id),
    },
    lists: board.lists,
  };
}

export function cardMatchesList(issue: IssueRow, list: BoardList, kind: string, assignees: string[]): boolean {
  if (list.value === null) return false;
  if (kind === 'label') return issue.labels.includes(list.value);
  if (kind === 'assignee') return issue.assignees.includes(list.value);
  return false;
}

export async function boardJson(
  sql: Sql,
  boardId: number,
  viewerId: number,
  filters: { label?: string | null; assignee?: string | null; milestone?: string | null; search?: string | null },
): Promise<Record<string, unknown>> {
  const { board, lists } = await boardLists(sql, boardId);
  const { loadProject } = await import('./access');
  const projects: ProjectRow[] = [];
  if (board.project_id !== null) {
    const project = await loadProject(sql, board.project_id);
    if (project !== null) projects.push(project);
  } else if (board.group_id !== null) {
    const rows = await sql.query<{ id: string }>(
      `with recursive chain as (
         select id from groups where id = $1
         union all select g.id from groups g join chain c on g.parent_id = c.id
       ) select p.id from projects p where p.group_id in (select id from chain) order by p.id`,
      [board.group_id],
    );
    for (const row of rows) {
      const project = await loadProject(sql, Number(row.id));
      if (project !== null) projects.push(project);
    }
  }
  const cards: { issue: IssueRow; project: ProjectRow }[] = [];
  for (const project of projects) {
    const access = await projectAccess(sql, project, viewerId);
    if (access.level === 0) continue;
    for (const issue of await visibleIssues(sql, project, viewerId)) {
      cards.push({ issue, project });
    }
  }
  const filtered = cards.filter(({ issue }) => {
    if (filters.label !== null && filters.label !== undefined && filters.label !== '' && !issue.labels.includes(filters.label)) {
      return false;
    }
    if (
      filters.assignee !== null &&
      filters.assignee !== undefined &&
      filters.assignee !== '' &&
      !issue.assignees.includes(filters.assignee)
    ) {
      return false;
    }
    if (filters.search !== null && filters.search !== undefined && filters.search !== '') {
      if (!issue.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
    }
    return true;
  });
  const ordered = [...lists].sort((a, b) => (a.id === 2 ? 1 : b.id === 2 ? -1 : a.id - b.id));
  const out = ordered.map((list) => {
    const members = filtered.filter(({ issue }) => {
      if (list.id === 2) return issue.state === 'closed';
      if (issue.state === 'closed') return false;
      if (list.id === 1) {
        return !lists.some((other) => other.value !== null && cardMatchesList(issue, other, board.kind, []));
      }
      return cardMatchesList(issue, list, board.kind, []);
    });
    const sorted = members.sort((a, b) => a.issue.position - b.issue.position || a.issue.iid - b.issue.iid);
    return {
      id: list.id,
      title: list.title,
      count: sorted.length,
      cards: sorted.map(({ issue, project }) => ({
        issue: issue.id,
        iid: issue.iid,
        project: project.slug,
        title: issue.title,
        weight: issue.weight,
        labels: issue.labels,
        version: issue.card_version,
        position: issue.position,
      })),
    };
  });
  return { id: board.id, name: board.name, kind: board.kind, lists: out };
}

export async function moveCard(
  t: Tx,
  boardId: number,
  viewerId: number,
  actor: string,
  input: { issue: number; to_list: number; after_id: number | null; version: number },
): Promise<Record<string, unknown>> {
  const { board, lists } = await boardLists(t.sql, boardId);
  const issue = await issueById(t.sql, input.issue);
  if (issue === null) throw errors.notFound();
  const { loadProject } = await import('./access');
  const project = await loadProject(t.sql, issue.project_id);
  if (project === null) throw errors.notFound();
  const target = lists.find((list) => list.id === input.to_list);
  if (target === undefined) throw errors.notFound();
  const currentList = await listOfIssue(t.sql, boardId, issue);
  if (issue.card_version !== input.version) {
    const mover = await t.sql.one<{ data: { user?: string } }>(
      "select data from issue_events where issue_id = $1 and kind = 'move' order by id desc limit 1",
      [issue.id],
    );
    const who = mover?.data.user ?? 'Someone';
    throw errors.conflict('stale_card', `${who} moved this card first. It is now in ${currentList.title}.`);
  }
  const notes: string[] = [];
  if (target.id === 2) {
    await setIssueState(t, project, issue, 'closed', actor);
  } else if (issue.state === 'closed') {
    await setIssueState(t, project, issue, 'opened', actor);
  }
  const removeValue = currentList.value === null ? [] : [currentList.value];
  const addValue = target.value === null ? [] : [target.value];
  if (board.kind === 'label') {
    const labelNotes = await applyLabelChanges(t, project, issue, addValue, removeValue);
    notes.push(...labelNotes);
  } else if (board.kind === 'assignee') {
    const next = [...new Set([...issue.assignees.filter((name) => !removeValue.includes(name)), ...addValue])];
    await t.sql.query('update issues set assignees = $2 where id = $1', [issue.id, JSON.stringify(next)]);
  }
  const reloaded = await issueById(t.sql, issue.id);
  if (reloaded === null) throw errors.notFound();
  const board2 = (await boardJson(t.sql, boardId, viewerId, {})) as { lists: { id: number; cards: { issue: number; position: number }[] }[] };
  const listCards = board2.lists.find((list) => list.id === target.id)?.cards ?? [];
  let position: number;
  if (input.after_id === null) {
    const first = listCards.filter((card) => card.issue !== issue.id)[0];
    position = first === undefined ? 1 : first.position - 1;
  } else {
    const index = listCards.findIndex((card) => card.issue === input.after_id);
    if (index === -1) {
      const last = listCards[listCards.length - 1];
      position = last === undefined ? 1 : last.position + 1;
      notes.push(`Card moved: ${reloaded.title} went to the end of ${target.title}.`);
    } else {
      const after = listCards[index];
      const next = listCards[index + 1];
      position = next === undefined ? after.position + 1 : (after.position + next.position) / 2;
    }
  }
  await t.sql.query('update issues set position = $2, card_version = card_version + 1 where id = $1', [
    issue.id,
    position,
  ]);
  await t.sql.query('insert into issue_events (issue_id, at_ms, kind, data) values ($1, $2, $3, $4)', [
    issue.id,
    nowMs(),
    'move',
    JSON.stringify({ user: actor, list: target.title }),
  ]);
  const final = (await boardJson(t.sql, boardId, viewerId, {})) as {
    lists: { id: number; cards: { issue: number }[] }[];
  };
  const card = await issueById(t.sql, issue.id);
  await emit(t, project.id, 'board', {
    board_id: boardId,
    issue: issue.id,
    iid: issue.iid,
    to_list: target.id,
    position,
  });
  return {
    card: {
      issue: issue.id,
      iid: issue.iid,
      title: reloaded.title,
      version: card?.card_version ?? 0,
      position,
      list: target.id,
    },
    lists: final.lists.map((list) => ({ id: list.id, issue_ids: list.cards.map((item) => item.issue) })),
    notes,
  };
}

export async function listOfIssue(sql: Sql, boardId: number, issue: IssueRow): Promise<BoardList> {
  const { board, lists } = await boardLists(sql, boardId);
  if (issue.state === 'closed') {
    return lists.find((list) => list.id === 2) ?? { id: 2, title: 'Closed', value: null };
  }
  const matched = lists
    .filter((list) => list.value !== null)
    .find((list) => cardMatchesList(issue, list, board.kind, []));
  return matched ?? lists.find((list) => list.id === 1) ?? { id: 1, title: 'Open', value: null };
}

export function cardLabel(issue: IssueRow, listTitle: string, projectSlug: string | null): string {
  const weight = issue.weight === null ? 'no weight' : `weight ${issue.weight}`;
  const prefix = projectSlug === null ? `Issue #${issue.iid}` : `Issue ${projectSlug}#${issue.iid}`;
  return `${prefix}, ${issue.title}, ${weight}, ${issue.labels.length} labels, in ${listTitle}`;
}

export function requireBoardAdmin(access: Access): void {
  if (access.level >= roleLevels.maintainer) return;
  if (access.permissions.includes('admin_board')) return;
  throw errors.forbidden();
}
