import { requireCaller } from '../auth.ts';
import { query, withTransaction } from '../db/pool.ts';
import { allows } from '../domain/roles.ts';
import { ApiError, forbidden, notFound, validation } from '../http/errors.ts';
import { readString } from '../http/read.ts';
import { sendJson, type HttpApp } from '../http/server.ts';
import type { Role, TeamJson, TeamMemberJson } from '../../shared/types.ts';

const isRole = (value: string): value is Role =>
  value === 'owner' || value === 'member' || value === 'viewer';

type MemberRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export const registerTeamRoutes = (app: HttpApp): void => {
  app.on('GET', '/api/team', async (ctx) => {
    const caller = await requireCaller(ctx);
    const members = await query<MemberRow>(
      'SELECT id, email, name, role FROM users WHERE team_id = $1 ORDER BY name, email',
      [caller.teamId],
    );
    const payload: TeamJson = {
      id: caller.teamId,
      name: caller.teamName,
      members: members.map(
        (row): TeamMemberJson => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
        }),
      ),
    };
    sendJson(ctx.res, 200, payload);
  });

  app.on('PATCH', '/api/team/members/:userId', async (ctx) => {
    const caller = await requireCaller(ctx);
    const userId = ctx.params['userId'] ?? '';
    const member = await query<MemberRow>(
      'SELECT id, email, name, role FROM users WHERE id = $1 AND team_id = $2',
      [userId, caller.teamId],
    );
    const target = member[0];
    if (!target) throw notFound();
    if (!allows({ userId: caller.userId, role: caller.role }, 'changeRole', null)) {
      throw forbidden();
    }
    const body = await ctx.body();
    const role = readString(body, 'role');
    if (role === null || !isRole(role)) throw validation({ role: 'Choose a valid role.' });

    const updated = await withTransaction(async (client) => {
      const owners = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM users WHERE team_id = $1 AND role = 'owner'",
        [caller.teamId],
      );
      const ownerCount = owners.rows[0]?.count ?? 0;
      if (target.role === 'owner' && role !== 'owner' && ownerCount <= 1) {
        throw new ApiError(409, { error: 'last_owner' });
      }
      const result = await client.query<MemberRow>(
        'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, name, role',
        [userId, role],
      );
      return result.rows[0] ?? target;
    });
    sendJson(ctx.res, 200, updated);
  });
};
