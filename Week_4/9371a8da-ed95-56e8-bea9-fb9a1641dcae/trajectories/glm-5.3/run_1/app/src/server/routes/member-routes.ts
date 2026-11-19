import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember } from './session-routes.js';
import { ApiError, lastOwner, invalid } from '../errors.js';
import { readJson } from '../validation.js';
import type { Member, PersonShape, UserShape } from '../../shared/types.js';

const ROLES = ['owner', 'editor', 'reviewer', 'viewer'] as const;
type Role = (typeof ROLES)[number];

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}

export function registerMemberRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql } = svc;

  app.get('/api/projects/:pid/members', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, 'pid'));
    const pid = param(req, 'pid');
    const rows = await sql<{ id: string; email: string; display_name: string; handle: string; role: string }>`
      SELECT u.id, u.email, u.display_name, u.handle, m.role
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ${pid} ORDER BY u.display_name, u.id`;
    const isOwner = role === 'owner';
    const members: Member[] = rows.map((r) => {
      const person: PersonShape = { id: r.id, displayName: r.display_name, handle: r.handle };
      const full: UserShape = { id: r.id, email: r.email, displayName: r.display_name, handle: r.handle };
      return { user: isOwner ? full : person, role: r.role as Role };
    });
    res.json({ members });
    void user;
  }));

  app.patch('/api/projects/:pid/members/:uid', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['role']);
    if (typeof body.role !== 'string' || !ROLES.includes(body.role as Role)) {
      throw invalid({ role: 'unknown role' });
    }
    const pid = param(req, 'pid');
    const uid = param(req, 'uid');
    const newRole = body.role as Role;
    await sql.begin(async (tx) => {
      const target = await tx<{ role: string }>`
        SELECT * FROM memberships WHERE project_id = ${pid} AND user_id = ${uid} FOR UPDATE`;
      if (!target[0]) throw new ApiError(404, 'not_found');
      // A project always keeps at least one owner.
      if (target[0].role === 'owner' && newRole !== 'owner') {
        const owners = await tx<{ n: number }>`
          SELECT count(*)::int AS n FROM memberships WHERE project_id = ${pid} AND role = 'owner'`;
        if (owners[0].n <= 1) throw lastOwner();
      }
      await tx`UPDATE memberships SET role = ${newRole} WHERE project_id = ${pid} AND user_id = ${uid}`;
    });
    const rows = await sql<{ id: string; email: string; display_name: string; handle: string; role: string }>`
      SELECT u.id, u.email, u.display_name, u.handle, m.role
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ${pid} AND m.user_id = ${uid}`;
    const r = rows[0];
    res.json({ member: {
      user: { id: r.id, email: r.email, displayName: r.display_name, handle: r.handle },
      role: r.role as Role,
    }});
  }));

  app.delete('/api/projects/:pid/members/:uid', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, 'pid'));
    if (role !== 'owner') throw new ApiError(403, 'forbidden');
    const pid = param(req, 'pid');
    const uid = param(req, 'uid');
    await sql.begin(async (tx) => {
      const target = await tx<{ role: string }>`
        SELECT * FROM memberships WHERE project_id = ${pid} AND user_id = ${uid} FOR UPDATE`;
      if (!target[0]) throw new ApiError(404, 'not_found');
      if (target[0].role === 'owner') {
        const owners = await tx<{ n: number }>`
          SELECT count(*)::int AS n FROM memberships WHERE project_id = ${pid} AND role = 'owner'`;
        if (owners[0].n <= 1) throw lastOwner();
      }
      await tx`DELETE FROM memberships WHERE project_id = ${pid} AND user_id = ${uid}`;
    });
    res.status(204).end();
  }));
}
