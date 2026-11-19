import { DEFAULT_SETTINGS } from '../../shared/format.js';
import type { NumberFormat, Role, TimeZone } from '../../shared/types.js';
import { membersOf, openProject, requireOwner, requirePerson, roleIn } from '../access.js';
import { activitySentence, recordActivityOutsideSprite, type ActivityRow } from '../activity.js';
import { instant, now } from '../clock.js';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';
import type { Route } from '../http.js';
import { publishPerson, publishProject } from '../live.js';
import { enqueueMail } from '../mail.js';
import { token } from '../secrets.js';
import { choice, idParam, text } from '../validate.js';
import { formatDate } from '../../shared/format.js';

interface InviteRow {
  id: number;
  project_id: number;
  email: string;
  role: Role;
  token: string;
  state: string;
  expires_at: Date;
}

async function settingsForEmail(email: string): Promise<{ number_format: NumberFormat; time_zone: TimeZone }> {
  const user = await one<{ number_format: NumberFormat; time_zone: TimeZone }>(
    'SELECT number_format, time_zone FROM users WHERE email = $1',
    [email],
  );
  return user ?? DEFAULT_SETTINGS;
}

function publicBase(ctx: { req: { headers: Record<string, unknown> } }): string {
  if (config.publicUrl !== '') return config.publicUrl.replace(/\/$/, '');
  const host = String(ctx.req.headers.host ?? '');
  return `http://${host}`;
}

export const projectRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/projects',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const projects = await query<{ id: number; name: string; role: Role }>(
        `SELECT p.id, p.name, 'owner'::text AS role FROM projects p WHERE p.owner_id = $1
         UNION ALL
         SELECT p.id, p.name, m.role FROM memberships m JOIN projects p ON p.id = m.project_id
          WHERE m.user_id = $1
          ORDER BY id`,
        [person.id],
      );
      return { status: 200, body: { projects } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const name = text(ctx, 'name', { max: 120, label: 'Name this project' });
      const made = await one<{ id: number }>(
        'INSERT INTO projects (name, owner_id, created_at) VALUES ($1, $2, $3) RETURNING id',
        [name, person.id, await now()],
      );
      return { status: 201, body: { id: (made as { id: number }).id, name, role: 'owner' } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:id',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      const members = await membersOf(access.project.id);
      const sprites = await query<{ id: number; name: string }>(
        'SELECT id, name FROM sprites WHERE project_id = $1 ORDER BY id',
        [access.project.id],
      );
      return {
        status: 200,
        body: {
          id: access.project.id,
          name: access.project.name,
          role: access.role,
          members,
          sprites,
        },
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/projects/:id/members/:userId',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      requireOwner(access);
      const userId = idParam(ctx, 'userId');
      if (userId === access.project.owner_id) throw conflict({ error: 'owner_required' });
      const membership = await one<{ role: Role }>(
        'SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2',
        [access.project.id, userId],
      );
      if (membership === null) throw notFound();
      const role = choice(ctx, 'role', ['editor', 'reviewer'] as const);
      await query('UPDATE memberships SET role = $3 WHERE project_id = $1 AND user_id = $2', [
        access.project.id,
        userId,
        role,
      ]);
      publishPerson(userId, { type: 'role', project: access.project.id, role });
      publishProject(access.project.id, { type: 'members' });
      return { status: 200, body: { id: userId, role } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/projects/:id/members/:userId',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      requireOwner(access);
      const userId = idParam(ctx, 'userId');
      if (userId === access.project.owner_id) throw conflict({ error: 'owner_required' });
      const membership = await one('SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2', [
        access.project.id,
        userId,
      ]);
      if (membership === null) throw notFound();
      await query('DELETE FROM memberships WHERE project_id = $1 AND user_id = $2', [
        access.project.id,
        userId,
      ]);
      publishPerson(userId, {
        type: 'removed',
        project: access.project.id,
        project_name: access.project.name,
      });
      publishProject(access.project.id, { type: 'members' });
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:id/invites',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      const invites = await query<InviteRow>(
        'SELECT id, email, role, state, expires_at FROM invites WHERE project_id = $1 ORDER BY id',
        [access.project.id],
      );
      return {
        status: 200,
        body: {
          invites: invites.map((invite) => ({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            state: invite.state,
            expires_at: instant(invite.expires_at),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects/:id/invites',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      requireOwner(access);
      const email = String(ctx.body.email ?? '').trim().toLowerCase();
      if (email === '' || !email.includes('@')) throw unprocessable({ email: 'Use an email address' });
      const role = choice(ctx, 'role', ['editor', 'reviewer'] as const);
      const member = await one<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
      if (member !== null) {
        const existing = await roleIn(access.project.id, member.id);
        if (existing !== null) throw conflict({ error: 'already_member' });
      }
      const pending = await one(
        "SELECT id FROM invites WHERE project_id = $1 AND email = $2 AND state = 'pending'",
        [access.project.id, email],
      );
      if (pending !== null) throw conflict({ error: 'invite_pending' });
      const at = await now();
      const expiresAt = new Date(at.getTime() + config.inviteTtlSeconds * 1000);
      const inviteToken = token(18);
      const made = await one<{ id: number }>(
        `INSERT INTO invites (project_id, email, role, token, state, created_at, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
        [access.project.id, email, role, inviteToken, at, expiresAt],
      );
      const settings = await settingsForEmail(email);
      await enqueueMail(email, `Join ${access.project.name} on Celmate`, [
        `Role: ${role}`,
        `Expires: ${formatDate(expiresAt, settings)}`,
        `Accept: ${publicBase(ctx)}/invites/${inviteToken}`,
      ]);
      await recordActivityOutsideSprite({
        projectId: access.project.id,
        kind: 'invite',
        userId: access.person.id,
        userName: access.person.name,
        detail: email,
        at,
      });
      publishProject(access.project.id, { type: 'invites' });
      return {
        status: 201,
        body: { id: (made as { id: number }).id, state: 'pending', expires_at: instant(expiresAt) },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/invites/:id',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const invite = await one<InviteRow>('SELECT * FROM invites WHERE id = $1', [idParam(ctx, 'id')]);
      if (invite === null) throw notFound();
      const role = await roleIn(invite.project_id, person.id);
      if (role === null) throw notFound();
      if (role !== 'owner') throw forbidden('Only the project owner can do this');
      if (invite.state !== 'pending') {
        throw conflict({ error: 'invite_closed', message: 'This invite is closed' });
      }
      await query("UPDATE invites SET state = 'revoked' WHERE id = $1", [invite.id]);
      publishProject(invite.project_id, { type: 'invites' });
      return { status: 200, body: { state: 'revoked' } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/invites/:token',
    handler: async (ctx) => {
      const invite = await one<InviteRow & { project_name: string }>(
        `SELECT i.*, p.name AS project_name FROM invites i JOIN projects p ON p.id = i.project_id
          WHERE i.token = $1`,
        [ctx.params.token],
      );
      if (invite === null) throw notFound();
      const at = await now();
      const lapsed = invite.state === 'pending' && at.getTime() >= invite.expires_at.getTime();
      return {
        status: 200,
        body: {
          project: invite.project_name,
          role: invite.role,
          state: lapsed ? 'lapsed' : invite.state,
          expires_at: instant(invite.expires_at),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/invites/:token/accept',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const invite = await one<InviteRow & { project_name: string }>(
        `SELECT i.*, p.name AS project_name FROM invites i JOIN projects p ON p.id = i.project_id
          WHERE i.token = $1`,
        [ctx.params.token],
      );
      if (invite === null) throw notFound();
      if (invite.email !== person.email.toLowerCase()) {
        throw forbidden('This invite is for another email');
      }
      if (invite.state === 'accepted') {
        throw conflict({ error: 'invite_used', message: 'This invite was already used' });
      }
      if (invite.state === 'revoked') {
        throw conflict({ error: 'invite_revoked', message: 'This invite was revoked' });
      }
      const at = await now();
      if (invite.state === 'lapsed' || at.getTime() >= invite.expires_at.getTime()) {
        await query("UPDATE invites SET state = 'lapsed' WHERE id = $1", [invite.id]);
        publishProject(invite.project_id, { type: 'invites' });
        throw conflict({ error: 'invite_lapsed', message: 'This invite has lapsed' });
      }
      await query(
        `INSERT INTO memberships (project_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3`,
        [invite.project_id, person.id, invite.role, at],
      );
      await query("UPDATE invites SET state = 'accepted' WHERE id = $1", [invite.id]);
      publishProject(invite.project_id, { type: 'members' });
      return {
        status: 200,
        body: { project: invite.project_id, role: invite.role, project_name: invite.project_name },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:id/activity',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      const cursorText = ctx.url.searchParams.get('cursor');
      let before = 2147483647;
      if (cursorText !== null && cursorText !== '') {
        const decoded = Number(Buffer.from(cursorText, 'base64url').toString('utf8'));
        if (Number.isInteger(decoded)) before = decoded;
      }
      const page = config.activityPage;
      const list = await query<ActivityRow>(
        `SELECT id, kind, user_name, sprite_name, pixels, strokes, frame, detail, at
           FROM activity WHERE project_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
        [access.project.id, before, page + 1],
      );
      const items = list.slice(0, page).map((row) => ({
        id: row.id,
        sentence: activitySentence(row, ctx.settings.number_format),
        at: instant(row.at),
      }));
      const nextCursor =
        list.length > page
          ? Buffer.from(String(items[items.length - 1].id), 'utf8').toString('base64url')
          : null;
      return { status: 200, body: { items, next_cursor: nextCursor } };
    },
  },
];
