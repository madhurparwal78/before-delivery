import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { writeAudit, groupById, requireMinRole, groupByPath, canReadGroup } from './common.js';
import { effectiveAccess, groupAccess, ROLE_LEVEL, hasPermission, type Role } from '../domain/access.js';

const SEGMENT_RE = /^[a-z0-9-]{2,40}$/;

export function validateGroupPath(path: string): void {
  const segs = path.split('/');
  if (segs.length > 4) {
    throw new AppError(422, 'validation', 'Groups can only nest 4 levels.', { fields: { path: 'Groups can only nest 4 levels.' } });
  }
  for (const s of segs) {
    if (!SEGMENT_RE.test(s)) {
      throw new AppError(422, 'validation', 'Group path segments must be 2 to 40 characters: a-z, 0-9 and -.', { fields: { path: 'Group path segments must be 2 to 40 characters: a-z, 0-9 and -.' } });
    }
  }
}

export async function createGroup(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const body = requireBody(rc);
  const name = typeof body.name === 'string' ? body.name : '';
  const parent = typeof body.parent === 'number' ? body.parent : null;
  const visibility = typeof body.visibility === 'string' ? body.visibility : 'private';
  if (name === '') throw errs.validation({ name: "Name can't be blank." });
  if (!['private', 'internal', 'public'].includes(visibility)) {
    throw errs.validation({ visibility: 'Visibility must be private, internal or public.' });
  }
  const now = rc.ctx.now();
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    let parentPath = '';
    let parentRow = null as { id: number; path: string; visibility: string } | null;
    if (parent !== null) {
      parentRow = await groupById(client, parent);
      if (!parentRow) throw errs.notFound();
      const acc = await groupAccess(client, parent, rc.user.id);
      if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
      parentPath = `${parentRow.path}/`;
      if (parentRow.visibility === 'private' && (visibility === 'internal' || visibility === 'public')) {
        throw new AppError(422, 'validation', `Visibility can't exceed the parent group's: ${parentRow.visibility}.`, { fields: { visibility: `Visibility can't exceed the parent group's: ${parentRow.visibility}.` } });
      }
      if (parentRow.visibility === 'internal' && visibility === 'public') {
        throw new AppError(422, 'validation', `Visibility can't exceed the parent group's: ${parentRow.visibility}.`, { fields: { visibility: `Visibility can't exceed the parent group's: ${parentRow.visibility}.` } });
      }
    }
    const path = `${parentPath}${name}`;
    validateGroupPath(path);
    const r = await client.query<{ id: number; path: string }>(
      `INSERT INTO groups (name, path, parent_id, visibility, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, path`,
      [name.toLowerCase(), path, parent, visibility, now],
    );
    await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [r.rows[0].id, rc.user.id]);
    await writeAudit(client, { groupId: r.rows[0].id, actor: rc.user.username, action: 'group.visibility', target: path, before: null, after: { visibility }, at: now });
    await client.query('COMMIT');
    return { id: r.rows[0].id, path: r.rows[0].path };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getGroup(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    if (!(await canReadGroup(client, id, rc.user.id))) throw errs.notFound();
    const subgroups = (await client.query(`SELECT id, name, path, visibility FROM groups WHERE parent_id = $1 ORDER BY path`, [id])).rows;
    const projects = (await client.query(`SELECT id, slug, path, visibility FROM projects WHERE group_id = $1 ORDER BY path`, [id])).rows;
    const members = (await client.query<{ user_id: number; username: string; role: string | null; custom_role_id: number | null; custom_name: string | null; base: string | null; permissions: string[] | null }>(
      `SELECT gm.user_id, u.username, gm.role, gm.custom_role_id, cr.name AS custom_name, cr.base, cr.permissions
       FROM group_members gm JOIN users u ON u.id = gm.user_id LEFT JOIN custom_roles cr ON cr.id = gm.custom_role_id
       WHERE gm.group_id = $1 ORDER BY u.username`, [id],
    )).rows;
    const memberList = members.map((m) => ({
      username: m.username,
      role: m.custom_name ? m.base : m.role,
      custom_role: m.custom_name ?? null,
      permissions: m.permissions ?? [],
      effective_role: m.custom_name ? m.base : m.role,
    }));
    return { id: g.id, name: g.name, path: g.path, visibility: g.visibility, subgroups, projects, members: memberList };
  } finally {
    client.release();
  }
}

export async function patchGroup(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const visibility = typeof body.visibility === 'string' ? body.visibility : null;
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const now = rc.ctx.now();
    if (visibility) {
      if (g.parent_id) {
        const parent = await groupById(client, g.parent_id);
        if (parent) {
          const order = ['private', 'internal', 'public'];
          if (order.indexOf(visibility) > order.indexOf(parent.visibility)) {
            throw new AppError(422, 'validation', `Visibility can't exceed the parent group's: ${parent.visibility}.`, { fields: { visibility: `Visibility can't exceed the parent group's: ${parent.visibility}.` } });
          }
        }
      }
      await client.query(`UPDATE groups SET visibility = $2 WHERE id = $1`, [id, visibility]);
      await writeAudit(client, { groupId: id, actor: rc.user.username, action: 'group.visibility', target: g.path, before: { visibility: g.visibility }, after: { visibility }, at: now });
    }
    const updated = await groupById(client, id);
    return { id: updated!.id, path: updated!.path, visibility: updated!.visibility };
  } finally {
    client.release();
  }
}

export async function addGroupMember(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const username = typeof body.username === 'string' ? body.username.toLowerCase() : '';
    const role = typeof body.role === 'string' ? body.role : null;
    const customRoleId = typeof body.custom_role === 'number' ? body.custom_role : null;
    const user = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    if (!user) throw errs.notFound();
    if (!role && !customRoleId) throw errs.validation({ role: "Role can't be blank." });
    const now = rc.ctx.now();
    if (customRoleId) {
      const cr = (await client.query(`SELECT name, base, permissions FROM custom_roles WHERE id = $1 AND group_id = $2`, [customRoleId, id])).rows[0];
      if (!cr) throw errs.notFound();
      await client.query(`INSERT INTO group_members (group_id, user_id, role, custom_role_id) VALUES ($1, $2, NULL, $3)
        ON CONFLICT (group_id, user_id) DO UPDATE SET role = NULL, custom_role_id = $3`, [id, user.id, customRoleId]);
      await writeAudit(client, { groupId: id, actor: rc.user.username, action: 'member.add', target: `${g.path}:${username}`, before: null, after: { custom_role: cr.name }, at: now });
    } else {
      if (!['guest', 'reporter', 'developer', 'maintainer', 'owner'].includes(role!)) {
        throw errs.validation({ role: 'Role must be guest, reporter, developer, maintainer or owner.' });
      }
      await client.query(`INSERT INTO group_members (group_id, user_id, role, custom_role_id) VALUES ($1, $2, $3, NULL)
        ON CONFLICT (group_id, user_id) DO UPDATE SET role = $3, custom_role_id = NULL`, [id, user.id, role]);
      await writeAudit(client, { groupId: id, actor: rc.user.username, action: 'member.add', target: `${g.path}:${username}`, before: null, after: { role }, at: now });
    }
    await client.query(`INSERT INTO audit_events (project_id, group_id, actor, action, target, before, after, at) VALUES (NULL, $1, $2, 'member.add', $3, NULL, $4, $5)`, [id, rc.user.username, `${g.path}:${username}`, JSON.stringify(role ? { role } : { custom_role: 'x' }), now]);
    return { username, role: role ?? null };
  } finally {
    client.release();
  }
}

export async function patchGroupMember(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const username = rc.params.username.toLowerCase();
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const user = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    if (!user) throw errs.notFound();
    const before = (await client.query<{ role: string | null; custom_role_id: number | null }>(`SELECT role, custom_role_id FROM group_members WHERE group_id = $1 AND user_id = $2`, [id, user.id])).rows[0];
    if (!before) throw errs.notFound();
    const role = typeof body.role === 'string' ? body.role : null;
    const customRoleId = typeof body.custom_role === 'number' ? body.custom_role : null;
    const now = rc.ctx.now();
    let after: Record<string, unknown>;
    if (customRoleId) {
      const cr = (await client.query(`SELECT name FROM custom_roles WHERE id = $1 AND group_id = $2`, [customRoleId, id])).rows[0];
      if (!cr) throw errs.notFound();
      await client.query(`UPDATE group_members SET role = NULL, custom_role_id = $3 WHERE group_id = $1 AND user_id = $2`, [id, user.id, customRoleId]);
      after = { custom_role: cr.name };
    } else {
      await client.query(`UPDATE group_members SET role = $3, custom_role_id = NULL WHERE group_id = $1 AND user_id = $2`, [id, user.id, role]);
      after = { role };
    }
    await writeAudit(client, { groupId: id, actor: rc.user.username, action: 'member.update', target: `${g.path}:${username}`, before: before.role ? { role: before.role } : { custom_role: 'x' }, after, at: now });
    return { username, role: role ?? null };
  } finally {
    client.release();
  }
}

export async function deleteGroupMember(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const username = rc.params.username.toLowerCase();
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const user = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    if (!user) throw errs.notFound();
    const before = (await client.query<{ role: string | null }>(`SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`, [id, user.id])).rows[0];
    if (!before) throw errs.notFound();
    await client.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [id, user.id]);
    const now = rc.ctx.now();
    await writeAudit(client, { groupId: id, actor: rc.user.username, action: 'member.remove', target: `${g.path}:${username}`, before: { role: before.role }, after: null, at: now });
    return null;
  } finally {
    client.release();
  }
}

export async function createCustomRole(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const name = typeof body.name === 'string' ? body.name : '';
    const base = typeof body.base === 'string' ? body.base : '';
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    if (name === '') throw errs.validation({ name: "Name can't be blank." });
    if (!['guest', 'reporter', 'developer', 'maintainer', 'owner'].includes(base)) {
      throw errs.validation({ base: 'Base must be guest, reporter, developer, maintainer or owner.' });
    }
    const validPerms = ['push_protected', 'approve', 'manage_environments', 'dismiss_finding', 'admin_board', 'read_audit'];
    for (const p of permissions) {
      if (!validPerms.includes(p)) throw errs.validation({ permissions: `Unknown permission ${p}.` });
    }
    const now = rc.ctx.now();
    const r = await client.query<{ id: number }>(`INSERT INTO custom_roles (group_id, name, base, permissions, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, name, base, permissions, now]);
    await writeAudit(client, { groupId: id, actor: rc.user.username, action: 'custom_role.create', target: `${g.path}:${name}`, before: null, after: { base, permissions }, at: now });
    return { id: r.rows[0].id };
  } finally {
    client.release();
  }
}

export async function createLabel(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const body = requireBody(rc);
  const name = typeof body.name === 'string' ? body.name : '';
  const description = typeof body.description === 'string' ? body.description : '';
  if (name === '') throw errs.validation({ name: "Name can't be blank." });
  if (name.includes('\t') || name.includes('\n')) throw errs.validation({ name: 'Label name has invalid characters.' });
  const now = rc.ctx.now();
  if (rc.path.startsWith('/api/groups/')) {
    const id = Number(rc.params.id);
    const client = await rc.ctx.db.pool.connect();
    try {
      const acc = await groupAccess(client, id, rc.user.id);
      if (acc.level < ROLE_LEVEL.maintainer) throw errs.forbidden();
      const r = await client.query<{ id: number }>(`INSERT INTO labels (group_id, name, description, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [id, name, description, now]);
      return { id: r.rows[0].id };
    } finally {
      client.release();
    }
  }
  const projectId = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const access = await effectiveAccess(client, projectId, rc.user.id);
    requireMinRole(access, 'maintainer');
    const r = await client.query<{ id: number }>(`INSERT INTO labels (project_id, name, description, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [projectId, name, description, now]);
    return { id: r.rows[0].id };
  } finally {
    client.release();
  }
}

export async function createProject(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const body = requireBody(rc);
  const groupId = typeof body.group === 'number' ? body.group : null;
  const slug = typeof body.slug === 'string' ? body.slug.toLowerCase() : '';
  const visibility = typeof body.visibility === 'string' ? body.visibility : 'private';
  const defaultBranch = typeof body.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : 'main';
  if (!groupId) throw errs.validation({ group: "Group can't be blank." });
  if (!SEGMENT_RE.test(slug)) throw errs.validation({ slug: 'Slug must be 2 to 40 characters: a-z, 0-9 and -.' });
  const client = await rc.ctx.db.pool.connect();
  try {
    const g = await groupById(client, groupId);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, groupId, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const path = `${g.path}/${slug}`;
    const existing = await client.query(`SELECT id FROM projects WHERE path = $1`, [path]);
    if (existing.rows.length > 0) throw new AppError(409, 'taken', 'That project path is taken.');
    const now = rc.ctx.now();
    await client.query('BEGIN');
    const r = await client.query<{ id: number }>(
      `INSERT INTO projects (group_id, slug, path, visibility, default_branch, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [groupId, slug, path, visibility, defaultBranch, now],
    );
    const projectId = r.rows[0].id;
    // default branch protected at creation
    await client.query(`INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, 'maintainer', 'developer')`, [projectId, defaultBranch]);
    await client.query(`INSERT INTO push_rules (project_id, branch_name, commit_message, forbidden_files, required_files, secrets) VALUES ($1, NULL, NULL, '{}', '{}', false)`, [projectId]);
    await client.query(`INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, 'issue', 1), ($1, 'request', 1) ON CONFLICT DO NOTHING`, [projectId]);
    await writeAudit(client, { projectId, groupId, actor: rc.user.username, action: 'project.settings', target: path, before: null, after: { visibility, default_branch: defaultBranch }, at: now });
    await writeAudit(client, { projectId, groupId, actor: rc.user.username, action: 'protected_branch.set', target: `${path}:${defaultBranch}`, before: null, after: { allowed_to_push: 'maintainer', allowed_to_merge: 'developer' }, at: now });
    await client.query('COMMIT');
    return { id: projectId, path };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getProject(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    const settings = {
      merge_method: project.merge_method,
      merge_trains: project.merge_trains,
      pipelines_must_succeed: project.pipelines_must_succeed,
      reset_approvals_on_push: project.reset_approvals_on_push,
      author_can_approve: project.author_can_approve,
      auto_resolve_outdated: project.auto_resolve_outdated,
      default_branch: project.default_branch,
      visibility: project.visibility,
    };
    return {
      id: project.id,
      path: project.path,
      slug: project.slug,
      visibility: project.visibility,
      default_branch: project.default_branch,
      settings,
      my_role: access.role,
      my_permissions: [...access.permissions],
    };
  } finally {
    client.release();
  }
}

export async function patchSettings(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const allowed = ['merge_method', 'merge_trains', 'pipelines_must_succeed', 'reset_approvals_on_push', 'author_can_approve', 'auto_resolve_outdated', 'default_branch', 'visibility'];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      before[key] = (project as unknown as Record<string, unknown>)[key === 'default_branch' ? 'default_branch' : key];
      after[key] = body[key];
      if (key === 'merge_method' && !['merge_commit', 'squash', 'fast_forward', 'rebase'].includes(String(body[key]))) {
        throw errs.validation({ merge_method: 'Merge method must be merge_commit, squash, fast_forward or rebase.' });
      }
      if (key === 'visibility' && !['private', 'internal', 'public'].includes(String(body[key]))) {
        throw errs.validation({ visibility: 'Visibility must be private, internal or public.' });
      }
      await client.query(`UPDATE projects SET ${key} = $2 WHERE id = $1`, [id, body[key]]);
      if (key === 'default_branch') {
        await client.query(`INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, 'maintainer', 'developer')
          ON CONFLICT (project_id, pattern) DO NOTHING`, [id, body[key]]);
      }
    }
    if (Object.keys(after).length > 0) {
      const now = rc.ctx.now();
      await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'project.settings', target: project.path, before, after, at: now });
    }
    await client.query('COMMIT');
    const updated = (await client.query(`SELECT merge_method, merge_trains, pipelines_must_succeed, reset_approvals_on_push, author_can_approve, auto_resolve_outdated, default_branch, visibility FROM projects WHERE id = $1`, [id])).rows[0];
    return updated;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function putProtectedBranch(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const pattern = rc.params.pattern;
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const push = typeof body.allowed_to_push === 'string' ? body.allowed_to_push : 'maintainer';
    const merge = typeof body.allowed_to_merge === 'string' ? body.allowed_to_merge : 'developer';
    const existing = (await client.query(`SELECT allowed_to_push, allowed_to_merge FROM protected_branches WHERE project_id = $1 AND pattern = $2`, [id, pattern])).rows[0];
    await client.query(`INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id, pattern) DO UPDATE SET allowed_to_push = $3, allowed_to_merge = $4`, [id, pattern, push, merge]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'protected_branch.set', target: `${project.path}:${pattern}`, before: existing ?? null, after: { allowed_to_push: push, allowed_to_merge: merge }, at: now });
    return { pattern, allowed_to_push: push, allowed_to_merge: merge };
  } finally {
    client.release();
  }
}

export async function deleteProtectedBranch(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const pattern = rc.params.pattern;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    await client.query(`DELETE FROM protected_branches WHERE project_id = $1 AND pattern = $2`, [id, pattern]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'protected_branch.remove', target: `${project.path}:${pattern}`, before: null, after: null, at: now });
    return null;
  } finally {
    client.release();
  }
}

export async function putProtectedTag(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const pattern = rc.params.pattern;
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const create = typeof body.allowed_to_create === 'string' ? body.allowed_to_create : 'maintainer';
    await client.query(`INSERT INTO protected_tags (project_id, pattern, allowed_to_create) VALUES ($1, $2, $3)
      ON CONFLICT (project_id, pattern) DO UPDATE SET allowed_to_create = $3`, [id, pattern, create]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'protected_tag.set', target: `${project.path}:${pattern}`, before: null, after: { allowed_to_create: create }, at: now });
    return { pattern, allowed_to_create: create };
  } finally {
    client.release();
  }
}

export async function deleteProtectedTag(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const pattern = rc.params.pattern;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    await client.query(`DELETE FROM protected_tags WHERE project_id = $1 AND pattern = $2`, [id, pattern]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'protected_tag.remove', target: `${project.path}:${pattern}`, before: null, after: null, at: now });
    return null;
  } finally {
    client.release();
  }
}

export async function putPushRules(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const rules = {
      branch_name: body.branch_name === undefined ? null : String(body.branch_name),
      commit_message: body.commit_message === undefined ? null : String(body.commit_message),
      forbidden_files: Array.isArray(body.forbidden_files) ? body.forbidden_files.map(String) : [],
      required_files: Array.isArray(body.required_files) ? body.required_files.map(String) : [],
      secrets: body.secrets === true,
    };
    await client.query(`INSERT INTO push_rules (project_id, branch_name, commit_message, forbidden_files, required_files, secrets) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (project_id) DO UPDATE SET branch_name = $2, commit_message = $3, forbidden_files = $4, required_files = $5, secrets = $6`,
      [id, rules.branch_name, rules.commit_message, rules.forbidden_files, rules.required_files, rules.secrets]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'push_rules.update', target: project.path, before: null, after: rules, at: now });
    return rules;
  } finally {
    client.release();
  }
}

export async function postApprovalRule(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const name = typeof body.name === 'string' ? body.name : '';
    const required = typeof body.required === 'number' ? body.required : 0;
    const users = Array.isArray(body.users) ? body.users.map(String) : [];
    const groups = Array.isArray(body.groups) ? body.groups.map(String) : [];
    if (name === '') throw errs.validation({ name: "Name can't be blank." });
    const now = rc.ctx.now();
    const r = await client.query<{ id: number }>(`INSERT INTO approval_rules (project_id, name, required_count, users, groups, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, name, required, users, groups, now]);
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'approval_rule.create', target: `${project.path}:${name}`, before: null, after: { name, required, users, groups }, at: now });
    return { id: r.rows[0].id };
  } finally {
    client.release();
  }
}

export async function patchApprovalRule(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ruleId = Number(rc.params.rule_id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const before = (await client.query(`SELECT name, required_count, users, groups FROM approval_rules WHERE id = $1 AND project_id = $2`, [ruleId, id])).rows[0];
    if (!before) throw errs.notFound();
    const after = {
      name: typeof body.name === 'string' ? body.name : before.name,
      required: typeof body.required === 'number' ? body.required : before.required_count,
      users: Array.isArray(body.users) ? body.users.map(String) : before.users,
      groups: Array.isArray(body.groups) ? body.groups.map(String) : before.groups,
    };
    await client.query(`UPDATE approval_rules SET name = $3, required_count = $4, users = $5, groups = $6 WHERE id = $1 AND project_id = $2`,
      [ruleId, id, after.name, after.required, after.users, after.groups]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'approval_rule.update', target: `${project.path}:${after.name}`, before, after, at: now });
    return after;
  } finally {
    client.release();
  }
}

export async function deleteApprovalRule(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ruleId = Number(rc.params.rule_id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const before = (await client.query(`SELECT name FROM approval_rules WHERE id = $1 AND project_id = $2`, [ruleId, id])).rows[0];
    if (!before) throw errs.notFound();
    await client.query(`DELETE FROM approval_rules WHERE id = $1 AND project_id = $2`, [ruleId, id]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'approval_rule.delete', target: `${project.path}:${before.name}`, before: null, after: null, at: now });
    return null;
  } finally {
    client.release();
  }
}

export async function putVariable(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const key = rc.params.key;
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const value = typeof body.value === 'string' ? body.value : '';
    await client.query(`INSERT INTO variables (project_id, key, value) VALUES ($1, $2, $3)
      ON CONFLICT (project_id, key) DO UPDATE SET value = $3`, [id, key, value]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'variable.set', target: `${project.path}:${key}`, before: null, after: { value }, at: now });
    return { key, value };
  } finally {
    client.release();
  }
}

export async function deleteVariable(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const key = rc.params.key;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    await client.query(`DELETE FROM variables WHERE project_id = $1 AND key = $2`, [id, key]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'variable.remove', target: `${project.path}:${key}`, before: null, after: null, at: now });
    return null;
  } finally {
    client.release();
  }
}

export async function putProtectedEnvironment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const name = rc.params.name;
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (!hasPermission(access, 'manage_environments')) requireMinRole(access, 'maintainer');
    const roles = typeof body.roles === 'string' ? body.roles : 'maintainer';
    const approvals = typeof body.approvals === 'number' ? body.approvals : 0;
    await client.query(`INSERT INTO protected_environments (project_id, name, roles, approvals) VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id, name) DO UPDATE SET roles = $3, approvals = $4`, [id, name, roles, approvals]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'protected_environment.set', target: `${project.path}:${name}`, before: null, after: { roles, approvals }, at: now });
    return { name, roles, approvals };
  } finally {
    client.release();
  }
}

export async function deleteProtectedEnvironment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const name = rc.params.name;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (!hasPermission(access, 'manage_environments')) requireMinRole(access, 'maintainer');
    await client.query(`DELETE FROM protected_environments WHERE project_id = $1 AND name = $2`, [id, name]);
    const now = rc.ctx.now();
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'protected_environment.remove', target: `${project.path}:${name}`, before: null, after: null, at: now });
    return null;
  } finally {
    client.release();
  }
}

export async function projectMembers(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { loadProject } = await import('./common.js');
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const members = (await client.query(`SELECT u.username, pm.role, cr.name AS custom_name, cr.base FROM project_members pm JOIN users u ON u.id = pm.user_id LEFT JOIN custom_roles cr ON cr.id = pm.custom_role_id WHERE pm.project_id = $1`, [id])).rows;
    return { members };
  } finally {
    client.release();
  }
}

export { groupByPath, ROLE_LEVEL, canReadGroup };
export type { Role };
