import { now } from './clock.js';
import { db, type Queryable } from './db.js';
import { ApiError } from './errors.js';
import { visibleProjectIds, type Actor } from './access.js';
import { currentCalendar, type CalendarHistory } from './domain/calendar.js';
import { cycleNumberAt, cycleSpan } from './domain/cycles.js';
import { STATUS_ORDER } from './domain/status.js';
import { storedInstant } from './domain/zone.js';
import type { Attachment, Issue, IssueStatus } from '../shared/types.js';

export type IssueRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  number: number;
  key: string;
  title: string;
  description: string;
  status: IssueStatus;
  assignee_id: string | null;
  parent_id: string | null;
  cycle_number: number | null;
  due_date: string | null;
  closed_at: string | null;
  project_key: string;
};

const issueColumns = `i.id, i.workspace_id, i.project_id, i.number, i.key, i.title, i.description, i.status,
  i.assignee_id, i.parent_id, i.cycle_number, i.due_date, i.closed_at, p.key as project_key`;

/**
 * The cycle an issue reports: the cycle its close falls in, the current cycle
 * when its planned cycle has ended, and otherwise its planned cycle.
 */
export function attributedCycle(
  issue: { cycle_number: number | null; closed_at: string | null },
  history: CalendarHistory,
  at: number,
): number | null {
  if (issue.cycle_number === null) return null;
  const closedAt = issue.closed_at === null ? null : Date.parse(issue.closed_at);
  if (closedAt !== null && closedAt <= at) return cycleNumberAt(history, closedAt);
  const planned = cycleSpan(history, issue.cycle_number);
  if (planned.endsAt <= at) return cycleNumberAt(history, at);
  return issue.cycle_number;
}

export async function attachmentsFor(
  parentType: 'issue' | 'message' | 'doc',
  parentIds: string[],
  client: Queryable = db,
): Promise<Map<string, Attachment[]>> {
  const out = new Map<string, Attachment[]>();
  if (parentIds.length === 0) return out;
  const rows = await client.query<{
    id: string;
    filename: string;
    size: number;
    content_type: string;
    parent_id: string;
  }>(
    `select id, filename, size, content_type, parent_id from attachments
      where parent_type = $1 and parent_id = any($2::text[]) order by created_at asc, id asc`,
    [parentType, parentIds],
  );
  for (const row of rows) {
    const list = out.get(row.parent_id) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      size: Number(row.size),
      content_type: row.content_type,
      parent: { type: parentType, id: row.parent_id },
    });
    out.set(row.parent_id, list);
  }
  return out;
}

function compareIssues(left: IssueRow, right: IssueRow): number {
  const byStatus = STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
  if (byStatus !== 0) return byStatus;
  if (left.project_key !== right.project_key) return left.project_key < right.project_key ? -1 : 1;
  return left.number - right.number;
}

export async function issueBodies(
  rows: IssueRow[],
  history: CalendarHistory,
  client: Queryable = db,
): Promise<Issue[]> {
  if (rows.length === 0) return [];
  const at = now();
  const zone = currentCalendar(history).timeZone;
  const ids = rows.map((row) => row.id);
  const parents = await client.query<{ id: string; key: string }>(
    'select id, key from issues where id = any($1::uuid[])',
    [rows.map((row) => row.parent_id).filter((id): id is string => id !== null)],
  );
  const parentKeys = new Map(parents.map((row) => [row.id, row.key]));
  const children = await client.query<{ parent_id: string; key: string; number: number }>(
    'select parent_id, key, number from issues where parent_id = any($1::uuid[]) order by number asc',
    [ids],
  );
  const subKeys = new Map<string, string[]>();
  for (const child of children) {
    const list = subKeys.get(child.parent_id) ?? [];
    list.push(child.key);
    subKeys.set(child.parent_id, list);
  }
  const attachments = await attachmentsFor(
    'issue',
    rows.map((row) => row.key),
    client,
  );
  return rows.map((row) => ({
    key: row.key,
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assignee_id: row.assignee_id,
    parent_key: row.parent_id === null ? null : parentKeys.get(row.parent_id) ?? null,
    sub_issue_keys: subKeys.get(row.id) ?? [],
    cycle_number: attributedCycle(row, history, at),
    due_date: row.due_date,
    closed_at: storedInstant(zone, row.closed_at),
    attachments: attachments.get(row.key) ?? [],
  }));
}

export async function issueBody(row: IssueRow, history: CalendarHistory, client: Queryable = db): Promise<Issue> {
  const bodies = await issueBodies([row], history, client);
  const body = bodies[0];
  if (body === undefined) throw new ApiError('not_found');
  return body;
}

export async function loadIssueRow(
  actor: Actor,
  key: string,
  client: Queryable = db,
): Promise<IssueRow> {
  const projectIds = await visibleProjectIds(actor, client);
  const row = await client.one<IssueRow>(
    `select ${issueColumns} from issues i join projects p on p.id = i.project_id
      where i.workspace_id = $1 and i.key = $2 and i.project_id = any($3::uuid[])`,
    [actor.workspaceId, key, projectIds],
  );
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

export type IssueFilter = {
  projectId?: string | undefined;
  cycle?: 'current' | 'none' | number | undefined;
  status?: IssueStatus | undefined;
};

/** The viewer's issues, in the Issues list order. */
export async function listIssueRows(
  actor: Actor,
  history: CalendarHistory,
  filter: IssueFilter,
  memberKeysOfFinishedCycle: (cycle: number) => Promise<string[] | null>,
  client: Queryable = db,
): Promise<IssueRow[]> {
  const projectIds = await visibleProjectIds(actor, client);
  const scoped =
    filter.projectId === undefined
      ? projectIds
      : projectIds.filter((id) => id === filter.projectId);
  if (filter.projectId !== undefined && scoped.length === 0) throw new ApiError('not_found');
  let rows = await client.query<IssueRow>(
    `select ${issueColumns} from issues i join projects p on p.id = i.project_id
      where i.workspace_id = $1 and i.project_id = any($2::uuid[])`,
    [actor.workspaceId, scoped],
  );
  if (filter.status !== undefined) rows = rows.filter((row) => row.status === filter.status);
  if (filter.cycle !== undefined) {
    const at = now();
    if (filter.cycle === 'none') {
      rows = rows.filter((row) => row.cycle_number === null);
    } else {
      const number = filter.cycle === 'current' ? cycleNumberAt(history, at) : filter.cycle;
      const finishedKeys = await memberKeysOfFinishedCycle(number);
      if (finishedKeys !== null) {
        const keys = new Set(finishedKeys);
        rows = rows.filter((row) => keys.has(row.key));
      } else {
        rows = rows.filter((row) => attributedCycle(row, history, at) === number);
      }
    }
  }
  return rows.sort(compareIssues);
}
