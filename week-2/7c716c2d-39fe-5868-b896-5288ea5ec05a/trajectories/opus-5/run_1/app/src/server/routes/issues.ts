import { randomUUID } from 'node:crypto';
import { now, nowDate } from '../clock.js';
import { db, tx, type Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { requireWorkspace, visibleProjectIds } from '../access.js';
import { loadHistory } from '../calendarstore.js';
import { finishedCycleKeys } from '../cycleview.js';
import { snapToCountedDay, type CalendarHistory } from '../domain/calendar.js';
import { cycleSpan, MAX_CYCLE_NUMBER } from '../domain/cycles.js';
import { isIssueStatus, isClosedStatus, isLegalTransition } from '../domain/status.js';
import { appendEvent } from '../events.js';
import { issueBodies, issueBody, listIssueRows, loadIssueRow, type IssueRow } from '../issueview.js';
import { sessionRoute, type Route } from '../router.js';
import { isCalendarDate } from '../domain/zone.js';
import { isUuid, textField } from '../validate.js';
import type { Issue, IssueStatus } from '../../shared/types.js';

async function reloadIssueRow(client: Queryable, id: string): Promise<IssueRow> {
  const row = await client.one<IssueRow>(
    `select i.id, i.workspace_id, i.project_id, i.number, i.key, i.title, i.description, i.status,
            i.assignee_id, i.parent_id, i.cycle_number, i.due_date, i.closed_at, p.key as project_key
       from issues i join projects p on p.id = i.project_id where i.id = $1`,
    [id],
  );
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

async function emitIssue(
  client: Queryable,
  workspaceId: string,
  body: Issue,
  createdAt: string,
): Promise<void> {
  await appendEvent(
    client,
    workspaceId,
    'issue',
    { ...body },
    { type: 'project', id: body.project_id },
    createdAt,
  );
}

function titleField(body: Record<string, unknown>): string {
  return textField(body, 'title', {
    field: 'title',
    min: 1,
    max: 200,
    message: 'Give the issue a title.',
  });
}

function dueDateField(body: Record<string, unknown>, history: CalendarHistory): { date: string | null; snapped: boolean } {
  const value = body.due_date;
  if (value === null || value === undefined) return { date: null, snapped: false };
  if (!isCalendarDate(value)) {
    throw new ApiError('validation', {
      fields: { due_date: 'Enter a date as YYYY-MM-DD.' },
      message: 'Enter a date as YYYY-MM-DD.',
    });
  }
  const snapped = snapToCountedDay(history, value);
  return { date: snapped.date, snapped: snapped.snapped };
}

async function assigneeField(
  body: Record<string, unknown>,
  workspaceId: string,
  projectId: string,
): Promise<string | null> {
  const value = body.assignee_id;
  if (value === null || value === undefined) return null;
  if (!isUuid(value)) {
    throw new ApiError('validation', {
      fields: { assignee_id: 'Choose someone who can see this project.' },
      message: 'Choose someone who can see this project.',
    });
  }
  const row = await db.one<{ id: string }>(
    `select p.id from people p
      where p.id = $1 and p.workspace_id = $2 and p.removed = false
        and (p.role in ('owner','member')
             or exists (select 1 from project_guests g where g.person_id = p.id and g.project_id = $3))`,
    [value, workspaceId, projectId],
  );
  if (row === undefined) {
    throw new ApiError('validation', {
      fields: { assignee_id: 'Choose someone who can see this project.' },
      message: 'Choose someone who can see this project.',
    });
  }
  return value;
}

function cycleField(body: Record<string, unknown>, history: CalendarHistory): number | null {
  const value = body.cycle_number;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CYCLE_NUMBER) {
    throw new ApiError('validation', {
      fields: { cycle_number: 'Choose a cycle.' },
      message: 'Choose a cycle.',
    });
  }
  if (cycleSpan(history, value).endsAt <= now()) throw new ApiError('cycle_closed');
  return value;
}

export const issueRoutes: Route[] = [
  sessionRoute('GET', '/api/issues', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const history = await loadHistory(workspaceId);
    const projectParam = ctx.url.searchParams.get('project');
    const cycleParam = ctx.url.searchParams.get('cycle');
    const statusParam = ctx.url.searchParams.get('status');
    if (projectParam !== null && !isUuid(projectParam)) throw new ApiError('not_found');
    let cycle: 'current' | 'none' | number | undefined;
    if (cycleParam !== null) {
      if (cycleParam === 'current' || cycleParam === 'none') cycle = cycleParam;
      else if (/^\d+$/.test(cycleParam) && Number(cycleParam) >= 1 && Number(cycleParam) <= MAX_CYCLE_NUMBER) {
        cycle = Number(cycleParam);
      } else {
        throw new ApiError('validation', {
          fields: { cycle: 'Use a cycle number, current or none.' },
          message: 'Use a cycle number, current or none.',
        });
      }
    }
    if (statusParam !== null && !isIssueStatus(statusParam)) {
      throw new ApiError('validation', {
        fields: { status: 'Use a known status.' },
        message: 'Use a known status.',
      });
    }
    const rows = await listIssueRows(
      ctx.actor,
      history,
      {
        projectId: projectParam ?? undefined,
        cycle,
        status: statusParam === null ? undefined : (statusParam as IssueStatus),
      },
      (number) => finishedCycleKeys(workspaceId, number, history),
    );
    return { status: 200, body: { issues: await issueBodies(rows, history) } };
  }),

  sessionRoute('POST', '/api/issues', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const history = await loadHistory(workspaceId);
    const projectId = ctx.body.project_id;
    if (!isUuid(projectId)) throw new ApiError('not_found');
    if (!(await visibleProjectIds(ctx.actor)).includes(projectId)) throw new ApiError('not_found');
    const title = titleField(ctx.body);
    const description =
      ctx.body.description === undefined || ctx.body.description === null
        ? ''
        : textField(ctx.body, 'description', {
            field: 'description',
            min: 0,
            max: 20000,
            message: 'A description can be up to 20,000 characters.',
          });
    const assigneeId = await assigneeField(ctx.body, workspaceId, projectId);
    const cycleNumber = cycleField(ctx.body, history);
    const due = dueDateField(ctx.body, history);
    const parentId = await parentField(ctx.body, workspaceId, projectId);
    const at = nowDate().toISOString();

    const body = await tx(async (client) => {
      const project = await client.one<{ key: string; next_issue_number: number }>(
        'update projects set next_issue_number = next_issue_number + 1 where id = $1 returning key, next_issue_number',
        [projectId],
      );
      if (project === undefined) throw new ApiError('not_found');
      const number = Number(project.next_issue_number) - 1;
      const key = `${project.key}-${number}`;
      const id = randomUUID();
      await client.query(
        `insert into issues (id, workspace_id, project_id, number, key, title, description, status, assignee_id,
                             parent_id, cycle_number, due_date, closed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'backlog', $8, $9, $10, $11, null, $12, $12)`,
        [id, workspaceId, projectId, number, key, title, description, assigneeId, parentId, cycleNumber, due.date, at],
      );
      const row = await reloadIssueRow(client, id);
      const issue = await issueBody(row, history, client);
      await emitIssue(client, workspaceId, issue, at);
      return issue;
    });
    return { status: 201, body: { ...body, due_date_snapped: due.snapped } };
  }),

  sessionRoute('GET', '/api/issues/:key', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const history = await loadHistory(workspaceId);
    const row = await loadIssueRow(ctx.actor, ctx.params.key ?? '');
    return { status: 200, body: await issueBody(row, history) };
  }),

  sessionRoute('PATCH', '/api/issues/:key', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const history = await loadHistory(workspaceId);
    const existing = await loadIssueRow(ctx.actor, ctx.params.key ?? '');
    const at = nowDate().toISOString();
    let snapped = false;

    const updates: string[] = [];
    const values: unknown[] = [existing.id];
    if (ctx.body.title !== undefined) {
      updates.push(`title = $${values.length + 1}`);
      values.push(titleField(ctx.body));
    }
    if (ctx.body.description !== undefined) {
      updates.push(`description = $${values.length + 1}`);
      values.push(
        textField(ctx.body, 'description', {
          field: 'description',
          min: 0,
          max: 20000,
          message: 'A description can be up to 20,000 characters.',
        }),
      );
    }
    if (ctx.body.assignee_id !== undefined) {
      updates.push(`assignee_id = $${values.length + 1}`);
      values.push(await assigneeField(ctx.body, workspaceId, existing.project_id));
    }
    if (ctx.body.cycle_number !== undefined) {
      updates.push(`cycle_number = $${values.length + 1}`);
      values.push(cycleField(ctx.body, history));
    }
    if (ctx.body.due_date !== undefined) {
      const due = dueDateField(ctx.body, history);
      snapped = due.snapped;
      updates.push(`due_date = $${values.length + 1}`);
      values.push(due.date);
    }

    const issue = await tx(async (client) => {
      if (updates.length > 0) {
        await client.query(
          `update issues set ${updates.join(', ')}, updated_at = $${values.length + 1} where id = $1`,
          [...values, at],
        );
      }
      const row = await reloadIssueRow(client, existing.id);
      const body = await issueBody(row, history, client);
      await emitIssue(client, workspaceId, body, at);
      return body;
    });
    return { status: 200, body: { ...issue, due_date_snapped: snapped } };
  }),

  sessionRoute('POST', '/api/issues/:key/transition', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const history = await loadHistory(workspaceId);
    const existing = await loadIssueRow(ctx.actor, ctx.params.key ?? '');
    const to = ctx.body.to;
    if (!isIssueStatus(to)) {
      throw new ApiError('validation', {
        fields: { to: 'Use a known status.' },
        message: 'Use a known status.',
      });
    }
    if (!isLegalTransition(existing.status, to)) throw new ApiError('illegal_transition');
    if (to === 'done') {
      const open = await db.one<{ count: number }>(
        `select count(*)::int as count from issues
          where parent_id = $1 and status not in ('done','cancelled')`,
        [existing.id],
      );
      if ((open?.count ?? 0) > 0) throw new ApiError('open_sub_issues');
    }
    const at = nowDate().toISOString();
    const closedAt = isClosedStatus(to) ? at : null;
    const issue = await tx(async (client) => {
      await client.query('update issues set status = $2, closed_at = $3, updated_at = $4 where id = $1', [
        existing.id,
        to,
        closedAt,
        at,
      ]);
      const row = await reloadIssueRow(client, existing.id);
      const body = await issueBody(row, history, client);
      await emitIssue(client, workspaceId, body, at);
      return body;
    });
    return { status: 200, body: issue };
  }),
];

async function parentField(
  body: Record<string, unknown>,
  workspaceId: string,
  projectId: string,
): Promise<string | null> {
  const value = body.parent_key;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ApiError('validation', {
      fields: { parent_key: 'Name a top-level issue in this project.' },
      message: 'Name a top-level issue in this project.',
    });
  }
  const row = await db.one<{ id: string }>(
    `select id from issues where workspace_id = $1 and key = $2 and project_id = $3 and parent_id is null`,
    [workspaceId, value, projectId],
  );
  if (row === undefined) {
    throw new ApiError('validation', {
      fields: { parent_key: 'Name a top-level issue in this project.' },
      message: 'Name a top-level issue in this project.',
    });
  }
  return row.id;
}
