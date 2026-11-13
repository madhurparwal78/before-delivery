import {
  Access,
  Permission,
  Role,
  defaultSettings,
  groupAccess,
  hasPermission,
  loadGroup,
  loadProject,
  projectAccess,
  readableGroup,
  readableProject,
  requireLevel,
  roleLevels,
  writeAudit,
} from './access';
import { userByName } from './auth';
import { db } from './db';
import { errors } from './errors';
import { Ctx, Reply, param, route, stringList, text } from './http';
import { Tx, emit, seqOf, tx } from './live';
import { assertTargetAllowed } from './webhooks';

const visibilities = ['private', 'internal', 'public'];

function visibilityLevel(value: string): number {
  return visibilities.indexOf(value);
}

const pathSegment = /^[a-z0-9-]{2,40}$/;

route(
  'POST',
  '/api/groups',
  async (ctx: Ctx): Promise<Reply> => {
    const name = text(ctx.body, 'name') ?? '';
    const visibility = text(ctx.body, 'visibility') ?? 'private';
    const parentId = ctx.body.parent === null || ctx.body.parent === undefined ? null : Number(ctx.body.parent);
    if (!pathSegment.test(name)) {
      throw errors.validation('name', 'Group paths use 2 to 40 characters of a-z, 0-9 and -.');
    }
    if (!visibilities.includes(visibility)) throw errors.validation('visibility', 'Unknown visibility.');
    return tx(async (t) => {
      let path = name;
      if (parentId !== null) {
        const parent = await loadGroup(t.sql, parentId);
        if (parent === null) throw errors.notFound();
        const access = await groupAccess(t.sql, parent, ctx.user.id);
        if (access.level === 0) throw errors.notFound();
        requireLevel(access, 'owner');
        if (parent.path.split('/').length >= 4) {
          throw errors.validation('path', 'Groups can only nest 4 levels.');
        }
        if (visibilityLevel(visibility) > visibilityLevel(parent.visibility)) {
          throw errors.validation('visibility', `Visibility can't exceed the parent group's: ${parent.visibility}.`);
        }
        path = `${parent.path}/${name}`;
      }
      const row = await t.sql.one<{ id: string }>(
        'insert into groups (parent_id, name, path, visibility) values ($1, $2, $3, $4) returning id',
        [parentId, name, path, visibility],
      );
      const id = Number(row?.id);
      await t.sql.query(
        "insert into memberships (subject_type, subject_id, user_id, role) values ('group', $1, $2, 'owner')",
        [id, ctx.user.id],
      );
      await writeAudit(t, { groupId: id }, ctx.user.username, 'member.add', `${path}:${ctx.user.username}`, null, {
        role: 'owner',
      });
      return { status: 201, body: { id, path } };
    });
  },
  { write: true },
);

route('GET', '/api/groups/:id', async (ctx: Ctx): Promise<Reply> => {
  const { group, access } = await readableGroup(db, param(ctx, 'id'), ctx.user.id);
  const subgroups = await db.query<{ id: string; path: string; name: string }>(
    'select id, path, name from groups where parent_id = $1 order by path',
    [group.id],
  );
  const projects = await db.query<{ id: string; path: string; slug: string }>(
    'select id, path, slug from projects where group_id = $1 order by path',
    [group.id],
  );
  const members = await db.query<{ username: string; role: string | null; base: string | null; custom: string | null }>(
    `select u.username, m.role, r.base, r.name as custom
     from memberships m join users u on u.id = m.user_id
     left join custom_roles r on r.id = m.custom_role_id
     where m.subject_type = 'group' and m.subject_id = $1 order by u.username`,
    [group.id],
  );
  const epics = await db.query<{ iid: number; title: string; state: string }>(
    'select iid, title, state from epics where group_id = $1 order by iid',
    [group.id],
  );
  return {
    status: 200,
    body: {
      id: group.id,
      path: group.path,
      name: group.name,
      visibility: group.visibility,
      my_role: access.role,
      my_permissions: access.permissions,
      subgroups: subgroups.map((row) => ({ id: Number(row.id), path: row.path, name: row.name })),
      projects: projects.map((row) => ({ id: Number(row.id), path: row.path, slug: row.slug })),
      members: members.map((row) => ({
        username: row.username,
        effective_role: row.role ?? row.base,
        custom_role: row.custom,
      })),
      epics: epics.map((row) => ({ iid: Number(row.iid), title: row.title, state: row.state })),
    },
  };
});

route(
  'PATCH',
  '/api/groups/:id',
  async (ctx: Ctx): Promise<Reply> => {
    const visibility = text(ctx.body, 'visibility');
    if (visibility === null || !visibilities.includes(visibility)) {
      throw errors.validation('visibility', 'Unknown visibility.');
    }
    return tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'owner');
      if (group.parent_id !== null) {
        const parent = await loadGroup(t.sql, group.parent_id);
        if (parent !== null && visibilityLevel(visibility) > visibilityLevel(parent.visibility)) {
          throw errors.validation('visibility', `Visibility can't exceed the parent group's: ${parent.visibility}.`);
        }
      }
      await t.sql.query('update groups set visibility = $2 where id = $1', [group.id, visibility]);
      await writeAudit(
        t,
        { groupId: group.id },
        ctx.user.username,
        'group.visibility',
        group.path,
        { visibility: group.visibility },
        { visibility },
      );
      return { status: 200, body: { id: group.id, visibility } };
    });
  },
  { write: true },
);

async function changeMembership(
  t: Tx,
  ctx: Ctx,
  subject: { type: 'group' | 'project'; id: number; path: string },
  actorAccess: Access,
  mode: 'add' | 'update' | 'remove',
  username: string,
  role: string | null,
  customRoleId: number | null,
): Promise<void> {
  if (subject.type === 'group') requireLevel(actorAccess, 'owner');
  else requireLevel(actorAccess, 'maintainer');
  const user = await userByName(t.sql, username);
  if (user === null) throw errors.validation('username', `user @${username} doesn't exist`);
  const before = await t.sql.one<{ role: string | null; custom: string | null }>(
    `select m.role, r.name as custom from memberships m left join custom_roles r on r.id = m.custom_role_id
     where m.subject_type = $1 and m.subject_id = $2 and m.user_id = $3`,
    [subject.type, subject.id, user.id],
  );
  if (mode === 'remove') {
    await t.sql.query(
      'delete from memberships where subject_type = $1 and subject_id = $2 and user_id = $3',
      [subject.type, subject.id, user.id],
    );
  } else {
    let customName: string | null = null;
    if (customRoleId !== null) {
      const custom = await t.sql.one<{ name: string }>('select name from custom_roles where id = $1', [customRoleId]);
      customName = custom?.name ?? null;
    }
    void customName;
    await t.sql.query(
      `insert into memberships (subject_type, subject_id, user_id, role, custom_role_id)
       values ($1, $2, $3, $4, $5)
       on conflict (subject_type, subject_id, user_id) do update set role = $4, custom_role_id = $5`,
      [subject.type, subject.id, user.id, role, customRoleId],
    );
  }
  const after = await t.sql.one<{ role: string | null; custom: string | null }>(
    `select m.role, r.name as custom from memberships m left join custom_roles r on r.id = m.custom_role_id
     where m.subject_type = $1 and m.subject_id = $2 and m.user_id = $3`,
    [subject.type, subject.id, user.id],
  );
  const shape = (row: { role: string | null; custom: string | null } | null): unknown => {
    if (row === null) return null;
    return row.role === null ? { custom_role: row.custom } : { role: row.role };
  };
  await writeAudit(
    t,
    subject.type === 'group' ? { groupId: subject.id } : { projectId: subject.id },
    ctx.user.username,
    mode === 'add' ? 'member.add' : mode === 'update' ? 'member.update' : 'member.remove',
    `${subject.path}:${username}`,
    shape(before),
    shape(after),
  );
  if (subject.type === 'project') {
    await emit(t, subject.id, 'role', {
      username,
      role: after?.role ?? after?.custom ?? null,
      path: subject.path,
      announcement:
        after === null
          ? `You no longer have access to ${subject.path}.`
          : `Your role in ${subject.path} is now ${after.role ?? after.custom}.`,
    });
  } else {
    const projects = await t.sql.query<{ id: string; path: string }>(
      `with recursive chain as (
         select id from groups where id = $1
         union all select g.id from groups g join chain c on g.parent_id = c.id
       ) select p.id, p.path from projects p where p.group_id in (select id from chain)`,
      [subject.id],
    );
    for (const project of projects) {
      await emit(t, Number(project.id), 'role', {
        username,
        role: after?.role ?? after?.custom ?? null,
        path: project.path,
        announcement:
          after === null
            ? `You no longer have access to ${project.path}.`
            : `Your role in ${project.path} is now ${after.role ?? after.custom}.`,
      });
    }
  }
}

route(
  'POST',
  '/api/groups/:id/members',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      const username = text(ctx.body, 'username') ?? '';
      const role = text(ctx.body, 'role');
      const customRole = ctx.body.custom_role === undefined || ctx.body.custom_role === null ? null : Number(ctx.body.custom_role);
      await changeMembership(
        t,
        ctx,
        { type: 'group', id: group.id, path: group.path },
        access,
        'add',
        username,
        role,
        customRole,
      );
      return { status: 201, body: { username, role, custom_role: customRole } };
    }),
  { write: true },
);

route(
  'PATCH',
  '/api/groups/:id/members/:username',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      const role = text(ctx.body, 'role');
      const customRole = ctx.body.custom_role === undefined || ctx.body.custom_role === null ? null : Number(ctx.body.custom_role);
      await changeMembership(
        t,
        ctx,
        { type: 'group', id: group.id, path: group.path },
        access,
        'update',
        ctx.params.username,
        role,
        customRole,
      );
      return { status: 200, body: { username: ctx.params.username, role, custom_role: customRole } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/groups/:id/members/:username',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      await changeMembership(
        t,
        ctx,
        { type: 'group', id: group.id, path: group.path },
        access,
        'remove',
        ctx.params.username,
        null,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'POST',
  '/api/groups/:id/custom_roles',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'owner');
      const name = text(ctx.body, 'name') ?? '';
      const base = text(ctx.body, 'base') ?? 'developer';
      const permissions = (stringList(ctx.body, 'permissions') ?? []) as Permission[];
      if (!(base in roleLevels)) throw errors.validation('base', 'Unknown base role.');
      const row = await t.sql.one<{ id: string }>(
        'insert into custom_roles (group_id, name, base, permissions) values ($1, $2, $3, $4) returning id',
        [group.id, name, base, JSON.stringify(permissions)],
      );
      await writeAudit(
        t,
        { groupId: group.id },
        ctx.user.username,
        'custom_role.create',
        `${group.path}:${name}`,
        null,
        { base, permissions },
      );
      return { status: 201, body: { id: Number(row?.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/groups/:id/labels',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'maintainer');
      const row = await t.sql.one<{ id: string }>(
        'insert into labels (group_id, name, description) values ($1, $2, $3) returning id',
        [group.id, text(ctx.body, 'name') ?? '', text(ctx.body, 'description') ?? ''],
      );
      return { status: 201, body: { id: Number(row?.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/labels',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const row = await t.sql.one<{ id: string }>(
        'insert into labels (project_id, name, description) values ($1, $2, $3) returning id',
        [project.id, text(ctx.body, 'name') ?? '', text(ctx.body, 'description') ?? ''],
      );
      return { status: 201, body: { id: Number(row?.id), seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const groupId = Number(ctx.body.group);
      const slug = text(ctx.body, 'slug') ?? '';
      const visibility = text(ctx.body, 'visibility') ?? 'private';
      const defaultBranch = text(ctx.body, 'default_branch') ?? 'main';
      const group = await loadGroup(t.sql, groupId);
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      requireLevel(access, 'maintainer');
      if (!pathSegment.test(slug)) throw errors.validation('slug', 'Project slugs use 2 to 40 characters of a-z, 0-9 and -.');
      if (visibilityLevel(visibility) > visibilityLevel(group.visibility)) {
        throw errors.validation('visibility', `Visibility can't exceed the parent group's: ${group.visibility}.`);
      }
      const path = `${group.path}/${slug}`;
      const row = await t.sql.one<{ id: string }>(
        `insert into projects (group_id, slug, path, visibility, default_branch, settings)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [group.id, slug, path, visibility, defaultBranch, JSON.stringify(defaultSettings)],
      );
      const id = Number(row?.id);
      await t.sql.query(
        `insert into protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge)
         values ($1, $2, 'maintainer', 'developer')`,
        [id, defaultBranch],
      );
      await writeAudit(
        t,
        { projectId: id },
        ctx.user.username,
        'protected_branch.set',
        `${path}:${defaultBranch}`,
        null,
        { allowed_to_push: 'maintainer', allowed_to_merge: 'developer' },
      );
      return { status: 201, body: { id, path } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id', async (ctx: Ctx): Promise<Reply> => {
  const { project, access } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  return {
    status: 200,
    body: {
      id: project.id,
      path: project.path,
      slug: project.slug,
      group_id: project.group_id,
      visibility: project.visibility,
      default_branch: project.default_branch,
      settings: project.settings,
      my_role: access.role,
      my_permissions: access.permissions,
    },
  };
});

const settingKeys = [
  'merge_method',
  'merge_trains',
  'pipelines_must_succeed',
  'reset_approvals_on_push',
  'author_can_approve',
  'auto_resolve_outdated',
];

route(
  'PATCH',
  '/api/projects/:id/settings',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const settings = { ...project.settings } as Record<string, unknown>;
      let defaultBranch = project.default_branch;
      let visibility = project.visibility;
      for (const key of Object.keys(ctx.body)) {
        if (settingKeys.includes(key)) {
          before[key] = settings[key];
          settings[key] = ctx.body[key];
          after[key] = ctx.body[key];
          continue;
        }
        if (key === 'default_branch') {
          before[key] = defaultBranch;
          defaultBranch = String(ctx.body[key]);
          after[key] = defaultBranch;
          continue;
        }
        if (key === 'visibility') {
          before[key] = visibility;
          visibility = String(ctx.body[key]);
          after[key] = visibility;
        }
      }
      await t.sql.query('update projects set settings = $2, default_branch = $3, visibility = $4 where id = $1', [
        project.id,
        JSON.stringify(settings),
        defaultBranch,
        visibility,
      ]);
      if (Object.keys(after).length > 0) {
        await writeAudit(t, { projectId: project.id }, ctx.user.username, 'project.settings', project.path, before, after);
      }
      return { status: 200, body: { settings, default_branch: defaultBranch, visibility, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/members',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const customRole = ctx.body.custom_role === undefined || ctx.body.custom_role === null ? null : Number(ctx.body.custom_role);
      await changeMembership(
        t,
        ctx,
        { type: 'project', id: project.id, path: project.path },
        access,
        'add',
        text(ctx.body, 'username') ?? '',
        text(ctx.body, 'role'),
        customRole,
      );
      return { status: 201, body: { seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'PATCH',
  '/api/projects/:id/members/:username',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const customRole = ctx.body.custom_role === undefined || ctx.body.custom_role === null ? null : Number(ctx.body.custom_role);
      await changeMembership(
        t,
        ctx,
        { type: 'project', id: project.id, path: project.path },
        access,
        'update',
        ctx.params.username,
        text(ctx.body, 'role'),
        customRole,
      );
      return { status: 200, body: { seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/members/:username',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      await changeMembership(
        t,
        ctx,
        { type: 'project', id: project.id, path: project.path },
        access,
        'remove',
        ctx.params.username,
        null,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'PUT',
  '/api/projects/:id/protected_branches/:pattern',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const pattern = ctx.params.pattern;
      const push = text(ctx.body, 'allowed_to_push') ?? 'maintainer';
      const merge = text(ctx.body, 'allowed_to_merge') ?? 'developer';
      const before = await t.sql.one<{ allowed_to_push: string; allowed_to_merge: string }>(
        'select allowed_to_push, allowed_to_merge from protected_branches where project_id = $1 and pattern = $2',
        [project.id, pattern],
      );
      await t.sql.query(
        `insert into protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge)
         values ($1, $2, $3, $4)
         on conflict (project_id, pattern) do update set allowed_to_push = $3, allowed_to_merge = $4`,
        [project.id, pattern, push, merge],
      );
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'protected_branch.set',
        `${project.path}:${pattern}`,
        before,
        { allowed_to_push: push, allowed_to_merge: merge },
      );
      return { status: 200, body: { pattern, allowed_to_push: push, allowed_to_merge: merge, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/protected_branches/:pattern',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const before = await t.sql.one<{ allowed_to_push: string; allowed_to_merge: string }>(
        'select allowed_to_push, allowed_to_merge from protected_branches where project_id = $1 and pattern = $2',
        [project.id, ctx.params.pattern],
      );
      await t.sql.query('delete from protected_branches where project_id = $1 and pattern = $2', [
        project.id,
        ctx.params.pattern,
      ]);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'protected_branch.remove',
        `${project.path}:${ctx.params.pattern}`,
        before,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'PUT',
  '/api/projects/:id/protected_tags/:pattern',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const create = text(ctx.body, 'allowed_to_create') ?? 'maintainer';
      const before = await t.sql.one<{ allowed_to_create: string }>(
        'select allowed_to_create from protected_tags where project_id = $1 and pattern = $2',
        [project.id, ctx.params.pattern],
      );
      await t.sql.query(
        `insert into protected_tags (project_id, pattern, allowed_to_create) values ($1, $2, $3)
         on conflict (project_id, pattern) do update set allowed_to_create = $3`,
        [project.id, ctx.params.pattern, create],
      );
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'protected_tag.set',
        `${project.path}:${ctx.params.pattern}`,
        before,
        { allowed_to_create: create },
      );
      return { status: 200, body: { pattern: ctx.params.pattern, allowed_to_create: create } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/protected_tags/:pattern',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const before = await t.sql.one<{ allowed_to_create: string }>(
        'select allowed_to_create from protected_tags where project_id = $1 and pattern = $2',
        [project.id, ctx.params.pattern],
      );
      await t.sql.query('delete from protected_tags where project_id = $1 and pattern = $2', [
        project.id,
        ctx.params.pattern,
      ]);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'protected_tag.remove',
        `${project.path}:${ctx.params.pattern}`,
        before,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'PUT',
  '/api/projects/:id/push_rules',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const rules = {
        branch_name: text(ctx.body, 'branch_name'),
        commit_message: text(ctx.body, 'commit_message'),
        forbidden_files: stringList(ctx.body, 'forbidden_files') ?? [],
        required_files: stringList(ctx.body, 'required_files') ?? [],
        secrets: ctx.body.secrets === true,
      };
      const before = await t.sql.one<{ rules: unknown }>('select rules from push_rules where project_id = $1', [
        project.id,
      ]);
      await t.sql.query(
        `insert into push_rules (project_id, rules) values ($1, $2)
         on conflict (project_id) do update set rules = $2`,
        [project.id, JSON.stringify(rules)],
      );
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'push_rules.update',
        project.path,
        before?.rules ?? null,
        rules,
      );
      return { status: 200, body: { ...rules, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/approval_rules',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const name = text(ctx.body, 'name') ?? '';
      const required = Number(ctx.body.required ?? 1);
      const users = stringList(ctx.body, 'users') ?? [];
      const groups = stringList(ctx.body, 'groups') ?? [];
      const row = await t.sql.one<{ id: string }>(
        'insert into approval_rules (project_id, name, required, users, groups) values ($1, $2, $3, $4, $5) returning id',
        [project.id, name, required, JSON.stringify(users), JSON.stringify(groups)],
      );
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'approval_rule.create',
        `${project.path}:${name}`,
        null,
        { name, required, users, groups },
      );
      return { status: 201, body: { id: Number(row?.id), seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'PATCH',
  '/api/projects/:id/approval_rules/:rule',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const ruleId = param(ctx, 'rule');
      const before = await t.sql.one<{ name: string; required: number; users: string[]; groups: string[] }>(
        'select name, required, users, groups from approval_rules where id = $1 and project_id = $2',
        [ruleId, project.id],
      );
      if (before === null) throw errors.notFound();
      const name = text(ctx.body, 'name') ?? before.name;
      const required = ctx.body.required === undefined ? Number(before.required) : Number(ctx.body.required);
      const users = stringList(ctx.body, 'users') ?? before.users;
      const groups = stringList(ctx.body, 'groups') ?? before.groups;
      await t.sql.query('update approval_rules set name = $2, required = $3, users = $4, groups = $5 where id = $1', [
        ruleId,
        name,
        required,
        JSON.stringify(users),
        JSON.stringify(groups),
      ]);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'approval_rule.update',
        `${project.path}:${name}`,
        before,
        { name, required, users, groups },
      );
      return { status: 200, body: { id: ruleId, name, required, users, groups, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/approval_rules/:rule',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const before = await t.sql.one<{ name: string; required: number; users: string[]; groups: string[] }>(
        'select name, required, users, groups from approval_rules where id = $1 and project_id = $2',
        [param(ctx, 'rule'), project.id],
      );
      if (before === null) throw errors.notFound();
      await t.sql.query('delete from approval_rules where id = $1', [param(ctx, 'rule')]);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'approval_rule.delete',
        `${project.path}:${before.name}`,
        before,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'PUT',
  '/api/projects/:id/variables/:key',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const value = text(ctx.body, 'value') ?? '';
      const before = await t.sql.one<{ value: string }>(
        'select value from project_variables where project_id = $1 and key = $2',
        [project.id, ctx.params.key],
      );
      await t.sql.query(
        `insert into project_variables (project_id, key, value) values ($1, $2, $3)
         on conflict (project_id, key) do update set value = $3`,
        [project.id, ctx.params.key, value],
      );
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'variable.set',
        `${project.path}:${ctx.params.key}`,
        before,
        { value },
      );
      return { status: 200, body: { key: ctx.params.key, value } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/variables/:key',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const before = await t.sql.one<{ value: string }>(
        'select value from project_variables where project_id = $1 and key = $2',
        [project.id, ctx.params.key],
      );
      await t.sql.query('delete from project_variables where project_id = $1 and key = $2', [
        project.id,
        ctx.params.key,
      ]);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'variable.remove',
        `${project.path}:${ctx.params.key}`,
        before,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'PUT',
  '/api/projects/:id/protected_environments/:name',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      if (access.level < roleLevels.maintainer && !hasPermission(access, 'manage_environments')) {
        throw errors.forbidden();
      }
      const roles = (text(ctx.body, 'roles') ?? 'maintainer') as Role;
      const approvals = Number(ctx.body.approvals ?? 1);
      const before = await t.sql.one<{ roles: string; approvals: number }>(
        'select roles, approvals from protected_environments where project_id = $1 and name = $2',
        [project.id, ctx.params.name],
      );
      await t.sql.query(
        `insert into protected_environments (project_id, name, roles, approvals) values ($1, $2, $3, $4)
         on conflict (project_id, name) do update set roles = $3, approvals = $4`,
        [project.id, ctx.params.name, roles, approvals],
      );
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'protected_environment.set',
        `${project.path}:${ctx.params.name}`,
        before,
        { roles, approvals },
      );
      return { status: 200, body: { name: ctx.params.name, roles, approvals, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/protected_environments/:name',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      if (access.level < roleLevels.maintainer && !hasPermission(access, 'manage_environments')) {
        throw errors.forbidden();
      }
      const before = await t.sql.one<{ roles: string; approvals: number }>(
        'select roles, approvals from protected_environments where project_id = $1 and name = $2',
        [project.id, ctx.params.name],
      );
      await t.sql.query('delete from protected_environments where project_id = $1 and name = $2', [
        project.id,
        ctx.params.name,
      ]);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'protected_environment.remove',
        `${project.path}:${ctx.params.name}`,
        before,
        null,
      );
      return { status: 204, body: null };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/audit', async (ctx: Ctx): Promise<Reply> => {
  const { project, access } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  if (access.level < roleLevels.owner && !hasPermission(access, 'read_audit')) throw errors.forbidden();
  const rows = await db.query<{
    id: string;
    actor: string;
    action: string;
    target: string;
    before_value: unknown;
    after_value: unknown;
    at_ms: string;
  }>(
    `select id, actor, action, target, before_value, after_value, at_ms from audit_events
     where project_id = $1 order by id desc`,
    [project.id],
  );
  return {
    status: 200,
    body: {
      events: rows.map((row) => ({
        id: Number(row.id),
        actor: row.actor,
        action: row.action,
        target: row.target,
        before: row.before_value,
        after: row.after_value,
        at: new Date(Number(row.at_ms)).toISOString(),
      })),
    },
  };
});

route('GET', '/api/groups/:id/audit', async (ctx: Ctx): Promise<Reply> => {
  const { group, access } = await readableGroup(db, param(ctx, 'id'), ctx.user.id);
  if (access.level < roleLevels.owner && !hasPermission(access, 'read_audit')) throw errors.forbidden();
  const rows = await db.query<{
    id: string;
    actor: string;
    action: string;
    target: string;
    before_value: unknown;
    after_value: unknown;
    at_ms: string;
  }>(
    `select id, actor, action, target, before_value, after_value, at_ms from audit_events
     where group_id = $1 order by id desc`,
    [group.id],
  );
  return {
    status: 200,
    body: {
      events: rows.map((row) => ({
        id: Number(row.id),
        actor: row.actor,
        action: row.action,
        target: row.target,
        before: row.before_value,
        after: row.after_value,
        at: new Date(Number(row.at_ms)).toISOString(),
      })),
    },
  };
});

route('GET', '/api/projects', async (ctx: Ctx): Promise<Reply> => {
  const rows = await db.query<{ id: string }>('select id from projects order by id', []);
  const projects: Record<string, unknown>[] = [];
  for (const row of rows) {
    const project = await loadProject(db, Number(row.id));
    if (project === null) continue;
    const access = await projectAccess(db, project, ctx.user.id);
    if (access.level === 0) continue;
    projects.push({ id: project.id, path: project.path, slug: project.slug, role: access.role });
  }
  return { status: 200, body: { projects } };
});

route('GET', '/api/groups', async (ctx: Ctx): Promise<Reply> => {
  const rows = await db.query<{ id: string }>('select id from groups order by path', []);
  const groups: Record<string, unknown>[] = [];
  for (const row of rows) {
    const group = await loadGroup(db, Number(row.id));
    if (group === null) continue;
    const access = await groupAccess(db, group, ctx.user.id);
    if (access.level === 0) continue;
    groups.push({ id: group.id, path: group.path, name: group.name, role: access.role });
  }
  return { status: 200, body: { groups } };
});
