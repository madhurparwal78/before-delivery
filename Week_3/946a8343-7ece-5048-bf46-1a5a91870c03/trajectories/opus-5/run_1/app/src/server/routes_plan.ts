import { loadGroup, groupAccess, readableGroup, readableProject, requireLevel, roleLevels } from './access';
import { db } from './db';
import { errors } from './errors';
import { Ctx, Reply, param, route, stringList, text } from './http';
import { emit, seqOf, tx } from './live';
import {
  applyLabelChanges,
  addIssueNote,
  boardJson,
  burndown,
  canSeeConfidential,
  cardLabel,
  createIssue,
  epicJson,
  issueById,
  listOfIssue,
  loadIssue,
  moveCard,
  requireBoardAdmin,
  runQuickActions,
  setIssueState,
  titleErrors,
  visibleIssues,
} from './planning';

route(
  'POST',
  '/api/projects/:id/issues',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const issue = await createIssue(t, project, ctx.user.username, {
        title: text(ctx.body, 'title') ?? '',
        description: text(ctx.body, 'description') ?? '',
        labels: stringList(ctx.body, 'labels') ?? [],
        assignees: stringList(ctx.body, 'assignees') ?? [],
        milestone: ctx.body.milestone === undefined || ctx.body.milestone === null ? null : Number(ctx.body.milestone),
        weight: ctx.body.weight === undefined || ctx.body.weight === null ? null : Number(ctx.body.weight),
        confidential: ctx.body.confidential === true,
        due_date: text(ctx.body, 'due_date'),
      });
      return { status: 201, body: { iid: issue.iid, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/issues', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const issues = await visibleIssues(db, project, ctx.user.id);
  return {
    status: 200,
    body: {
      issues: issues.map((issue) => ({
        iid: issue.iid,
        id: issue.id,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees,
        weight: issue.weight,
        confidential: issue.confidential,
        milestone_id: issue.milestone_id,
      })),
    },
  };
});

route('GET', '/api/projects/:id/issues/:iid', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const issue = await loadIssue(db, project.id, param(ctx, 'iid'));
  if (issue === null) throw errors.notFound();
  if (issue.confidential && !(await canSeeConfidential(db, project, ctx.user.id, issue))) throw errors.notFound();
  const notes = await db.query<{ id: string; author: string; body: string; system: boolean; created_at: string }>(
    'select id, author, body, system, created_at from notes where issue_id = $1 order by id',
    [issue.id],
  );
  const links = await db.query<{ kind: string; iid: number }>(
    'select l.kind, i.iid from issue_links l join issues i on i.id = l.target_id where l.issue_id = $1',
    [issue.id],
  );
  return {
    status: 200,
    body: {
      ...issue,
      notes: notes.map((row) => ({
        id: Number(row.id),
        author: row.author,
        body: row.body,
        system: row.system,
        pending: false,
        thread_id: null,
        created_at: row.created_at,
      })),
      links: links.map((row) => ({ kind: row.kind, iid: Number(row.iid) })),
    },
  };
});

route(
  'PATCH',
  '/api/projects/:id/issues/:iid',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const issue = await loadIssue(t.sql, project.id, param(ctx, 'iid'));
      if (issue === null) throw errors.notFound();
      if (issue.confidential && !(await canSeeConfidential(t.sql, project, ctx.user.id, issue))) {
        throw errors.notFound();
      }
      const title = text(ctx.body, 'title');
      if (title !== null) {
        const failure = titleErrors(title);
        if (failure !== null) throw errors.validation('title', failure);
        await t.sql.query('update issues set title = $2 where id = $1', [issue.id, title]);
      }
      const description = text(ctx.body, 'description');
      if (description !== null) {
        await t.sql.query('update issues set description = $2 where id = $1', [issue.id, description]);
      }
      if (ctx.body.weight !== undefined) {
        const weight = ctx.body.weight === null ? null : Number(ctx.body.weight);
        if (weight !== null && (!Number.isInteger(weight) || weight < 0 || weight > 100)) {
          throw errors.validation('weight', 'Weight must be 0 to 100.');
        }
        await t.sql.query('update issues set weight = $2 where id = $1', [issue.id, weight]);
        await t.sql.query('insert into issue_events (issue_id, at_ms, kind, data) values ($1, $2, $3, $4)', [
          issue.id,
          (await import('./clock')).nowMs(),
          'weight',
          JSON.stringify({ weight: weight ?? 0 }),
        ]);
      }
      if (ctx.body.milestone !== undefined) {
        const milestone = ctx.body.milestone === null ? null : Number(ctx.body.milestone);
        await t.sql.query('update issues set milestone_id = $2 where id = $1', [issue.id, milestone]);
      }
      const assignees = stringList(ctx.body, 'assignees');
      if (assignees !== null) {
        await t.sql.query('update issues set assignees = $2 where id = $1', [issue.id, JSON.stringify(assignees)]);
      }
      if (ctx.body.confidential !== undefined) {
        await t.sql.query('update issues set confidential = $2 where id = $1', [issue.id, ctx.body.confidential === true]);
      }
      const dueDate = text(ctx.body, 'due_date');
      if (dueDate !== null) {
        await t.sql.query('update issues set due_date = $2 where id = $1', [issue.id, dueDate]);
      }
      if (ctx.body.estimate !== undefined) {
        await t.sql.query('update issues set estimate_m = $2 where id = $1', [issue.id, Number(ctx.body.estimate)]);
      }
      const add = stringList(ctx.body, 'add_labels') ?? stringList(ctx.body, 'labels') ?? [];
      const remove = stringList(ctx.body, 'remove_labels') ?? [];
      const explicit = stringList(ctx.body, 'labels');
      const removals = explicit === null ? remove : [...remove, ...issue.labels.filter((label) => !explicit.includes(label))];
      if (add.length > 0 || removals.length > 0) {
        await applyLabelChanges(t, project, issue, add, removals);
      }
      const event = text(ctx.body, 'state_event');
      if (event === 'close') await setIssueState(t, project, issue, 'closed', ctx.user.username);
      if (event === 'reopen') await setIssueState(t, project, issue, 'opened', ctx.user.username);
      await emit(t, project.id, 'issue', { iid: issue.iid });
      const updated = await loadIssue(t.sql, project.id, issue.iid);
      return { status: 200, body: { ...updated, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/issues/:iid/notes',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'guest');
      const issue = await loadIssue(t.sql, project.id, param(ctx, 'iid'));
      if (issue === null) throw errors.notFound();
      if (issue.confidential && !(await canSeeConfidential(t.sql, project, ctx.user.id, issue))) {
        throw errors.notFound();
      }
      const body = text(ctx.body, 'body') ?? '';
      const outcome = await runQuickActions(t, project, issue, ctx.user.username, body, null);
      let noteId: number | null = null;
      if (outcome.remaining !== '') {
        noteId = await addIssueNote(t, issue, ctx.user.username, outcome.remaining, false);
      }
      await emit(t, project.id, 'issue', { iid: issue.iid });
      return { status: 201, body: { note: noteId, results: outcome.results, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/issues/:iid/notes', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const issue = await loadIssue(db, project.id, param(ctx, 'iid'));
  if (issue === null) throw errors.notFound();
  if (issue.confidential && !(await canSeeConfidential(db, project, ctx.user.id, issue))) throw errors.notFound();
  const notes = await db.query<{ id: string; author: string; body: string; system: boolean; created_at: string }>(
    'select id, author, body, system, created_at from notes where issue_id = $1 order by id',
    [issue.id],
  );
  return {
    status: 200,
    body: {
      notes: notes.map((row) => ({
        id: Number(row.id),
        author: row.author,
        body: row.body,
        system: row.system,
        pending: false,
        thread_id: null,
        created_at: row.created_at,
      })),
    },
  };
});

route(
  'POST',
  '/api/projects/:id/issues/:iid/links',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const issue = await loadIssue(t.sql, project.id, param(ctx, 'iid'));
      if (issue === null) throw errors.notFound();
      const targetIid = Number((text(ctx.body, 'target') ?? '').replace('#', ''));
      const target = await loadIssue(t.sql, project.id, targetIid);
      if (target === null) throw errors.notFound();
      const kind = text(ctx.body, 'kind') ?? 'relates';
      await t.sql.query('insert into issue_links (issue_id, target_id, kind) values ($1, $2, $3)', [
        issue.id,
        target.id,
        kind,
      ]);
      return { status: 201, body: { kind, target: target.iid, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/milestones',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const row = await t.sql.one<{ id: string }>(
        `insert into milestones (project_id, title, start_date, due_date, time_zone)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          project.id,
          text(ctx.body, 'title') ?? '',
          text(ctx.body, 'start'),
          text(ctx.body, 'due'),
          text(ctx.body, 'time_zone') ?? 'UTC',
        ],
      );
      return { status: 201, body: { id: Number(row?.id), seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/milestones', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const rows = await db.query<{ id: string; title: string; start_date: string | null; due_date: string | null; time_zone: string; state: string }>(
    `select id, title, start_date::text as start_date, due_date::text as due_date, time_zone, state
     from milestones where project_id = $1 order by title`,
    [project.id],
  );
  return {
    status: 200,
    body: {
      milestones: rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        start: row.start_date,
        due: row.due_date,
        time_zone: row.time_zone,
        state: row.state,
      })),
    },
  };
});

route('GET', '/api/projects/:id/milestones/:milestone/burndown', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const milestone = await db.one<{ id: string; title: string }>(
    'select id, title from milestones where id = $1 and project_id = $2',
    [param(ctx, 'milestone'), project.id],
  );
  if (milestone === null) throw errors.notFound();
  const points = await burndown(db, Number(milestone.id));
  return { status: 200, body: { title: milestone.title, ...points } };
});

route(
  'POST',
  '/api/groups/:id/epics',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'reporter');
      const title = text(ctx.body, 'title') ?? '';
      const failure = titleErrors(title);
      if (failure !== null) throw errors.validation('title', failure);
      let parentId: number | null = null;
      if (ctx.body.parent !== undefined && ctx.body.parent !== null) {
        const parent = await t.sql.one<{ id: string; parent_id: string | null }>(
          'select id, parent_id from epics where group_id = $1 and iid = $2',
          [group.id, Number(ctx.body.parent)],
        );
        if (parent === null) throw errors.notFound();
        if (parent.parent_id !== null) {
          throw errors.validation('parent', 'Epics can only nest one level.');
        }
        parentId = Number(parent.id);
      }
      const iidRow = await t.sql.one<{ iid: number }>(
        'select coalesce(max(iid), 0) + 1 as iid from epics where group_id = $1',
        [group.id],
      );
      const iid = Number(iidRow?.iid ?? 1);
      await t.sql.query(
        `insert into epics (group_id, iid, title, description, author, parent_id) values ($1, $2, $3, $4, $5, $6)`,
        [group.id, iid, title, text(ctx.body, 'description') ?? '', ctx.user.username, parentId],
      );
      return { status: 201, body: { iid } };
    }),
  { write: true },
);

route(
  'PATCH',
  '/api/groups/:id/epics/:iid',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'reporter');
      const epic = await t.sql.one<{ id: string }>('select id from epics where group_id = $1 and iid = $2', [
        group.id,
        param(ctx, 'iid'),
      ]);
      if (epic === null) throw errors.notFound();
      const title = text(ctx.body, 'title');
      if (title !== null) {
        await t.sql.query('update epics set title = $2 where id = $1', [Number(epic.id), title]);
      }
      const description = text(ctx.body, 'description');
      if (description !== null) {
        await t.sql.query('update epics set description = $2 where id = $1', [Number(epic.id), description]);
      }
      if (ctx.body.parent !== undefined) {
        if (ctx.body.parent === null) {
          await t.sql.query('update epics set parent_id = null where id = $1', [Number(epic.id)]);
        } else {
          const parent = await t.sql.one<{ id: string; parent_id: string | null }>(
            'select id, parent_id from epics where group_id = $1 and iid = $2',
            [group.id, Number(ctx.body.parent)],
          );
          if (parent === null) throw errors.notFound();
          if (parent.parent_id !== null) throw errors.validation('parent', 'Epics can only nest one level.');
          const children = await t.sql.one<{ count: string }>(
            'select count(*)::text as count from epics where parent_id = $1',
            [Number(epic.id)],
          );
          if (Number(children?.count ?? '0') > 0) {
            throw errors.validation('parent', 'Epics can only nest one level.');
          }
          await t.sql.query('update epics set parent_id = $2 where id = $1', [Number(epic.id), Number(parent.id)]);
        }
      }
      return { status: 200, body: { iid: param(ctx, 'iid') } };
    }),
  { write: true },
);

route('GET', '/api/groups/:id/epics/:iid', async (ctx: Ctx): Promise<Reply> => {
  const { group } = await readableGroup(db, param(ctx, 'id'), ctx.user.id);
  const body = await epicJson(db, group.id, param(ctx, 'iid'), ctx.user.id);
  if (body === null) throw errors.notFound();
  return { status: 200, body };
});

route(
  'POST',
  '/api/groups/:id/epics/:iid/issues',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'reporter');
      const epic = await t.sql.one<{ id: string }>('select id from epics where group_id = $1 and iid = $2', [
        group.id,
        param(ctx, 'iid'),
      ]);
      if (epic === null) throw errors.notFound();
      const issue = await issueById(t.sql, Number(ctx.body.issue));
      if (issue === null) throw errors.notFound();
      await t.sql.query('insert into epic_issues (epic_id, issue_id) values ($1, $2) on conflict do nothing', [
        Number(epic.id),
        issue.id,
      ]);
      return { status: 201, body: { epic: param(ctx, 'iid'), issue: issue.id } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/boards',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireBoardAdmin(access);
      const name = text(ctx.body, 'name') ?? 'Board';
      const kind = text(ctx.body, 'kind') ?? 'label';
      const values = stringList(ctx.body, 'lists') ?? [];
      const lists = [
        { id: 1, title: 'Open', value: null },
        { id: 2, title: 'Closed', value: null },
        ...values.map((value, index) => ({ id: index + 3, title: value, value })),
      ];
      const row = await t.sql.one<{ id: string }>(
        'insert into boards (project_id, name, kind, lists) values ($1, $2, $3, $4) returning id',
        [project.id, name, kind, JSON.stringify(lists)],
      );
      return {
        status: 201,
        body: {
          id: Number(row?.id),
          lists: Object.fromEntries(lists.map((list) => [list.title, list.id])),
          seq: await seqOf(t, project.id),
        },
      };
    }),
  { write: true },
);

route(
  'POST',
  '/api/groups/:id/boards',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      if (access.level < roleLevels.maintainer && !access.permissions.includes('admin_board')) {
        throw errors.forbidden();
      }
      const values = stringList(ctx.body, 'lists') ?? [];
      const lists = [
        { id: 1, title: 'Open', value: null },
        { id: 2, title: 'Closed', value: null },
        ...values.map((value, index) => ({ id: index + 3, title: value, value })),
      ];
      const row = await t.sql.one<{ id: string }>(
        'insert into boards (group_id, name, kind, lists) values ($1, $2, $3, $4) returning id',
        [group.id, text(ctx.body, 'name') ?? 'Board', text(ctx.body, 'kind') ?? 'label', JSON.stringify(lists)],
      );
      return {
        status: 201,
        body: { id: Number(row?.id), lists: Object.fromEntries(lists.map((list) => [list.title, list.id])) },
      };
    }),
  { write: true },
);

route('GET', '/api/boards/:id', async (ctx: Ctx): Promise<Reply> => {
  const body = await boardJson(db, param(ctx, 'id'), ctx.user.id, {
    label: ctx.url.searchParams.get('label'),
    assignee: ctx.url.searchParams.get('assignee'),
    milestone: ctx.url.searchParams.get('milestone'),
    search: ctx.url.searchParams.get('search'),
  });
  return { status: 200, body };
});

route(
  'POST',
  '/api/boards/:id/moves',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const boardId = param(ctx, 'id');
      const issue = await issueById(t.sql, Number(ctx.body.issue));
      if (issue === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, issue.project_id, ctx.user.id);
      requireLevel(access, 'reporter');
      const result = await moveCard(t, boardId, ctx.user.id, ctx.user.username, {
        issue: issue.id,
        to_list: Number(ctx.body.to_list),
        after_id: ctx.body.after_id === undefined || ctx.body.after_id === null ? null : Number(ctx.body.after_id),
        version: Number(ctx.body.version ?? 0),
      });
      return { status: 200, body: { ...result, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/boards/:id/cards', async (ctx: Ctx): Promise<Reply> => {
  const board = await boardJson(db, param(ctx, 'id'), ctx.user.id, {});
  const lists = board.lists as { id: number; title: string; cards: { issue: number }[] }[];
  const labels: Record<string, string> = {};
  for (const list of lists) {
    for (const card of list.cards) {
      const issue = await issueById(db, card.issue);
      if (issue === null) continue;
      const place = await listOfIssue(db, param(ctx, 'id'), issue);
      labels[String(card.issue)] = cardLabel(issue, place.title, null);
    }
  }
  return { status: 200, body: { labels } };
});
