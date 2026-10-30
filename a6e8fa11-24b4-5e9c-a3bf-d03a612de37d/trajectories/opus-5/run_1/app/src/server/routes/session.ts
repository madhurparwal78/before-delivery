import { SessionUser } from '../../shared/api';
import { MIN_PASSWORD_CHARS } from '../../shared/limits';
import { MemberRole } from '../../shared/workbook';
import { query, queryOne } from '../db';
import {
  clearSessionCookie,
  jsonBody,
  requireMember,
  sendEmpty,
  sendJson,
  setSessionCookie,
} from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { hashPassword, uuid, verifyPassword } from '../secrets';

interface MemberAccountRow {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: string;
  password_hash: string | null;
  station_id: string;
  station_name: string;
  time_zone: string;
}

const ACCOUNT_SQL = `select m.id, m.name, m.email, m.role, m.status, m.password_hash,
  m.station_id, s.name as station_name, s.time_zone
  from members m join stations s on s.id = m.station_id`;

function sessionUser(row: MemberAccountRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    stationId: row.station_id,
    stationName: row.station_name,
    timeZone: row.time_zone,
  };
}

async function startSession(memberId: string): Promise<string> {
  const id = uuid();
  await query('insert into sessions (id, member_id) values ($1,$2)', [id, memberId]);
  return id;
}

export function registerSessionRoutes(): void {
  addRoute({
    method: 'POST',
    pattern: '/api/session',
    auth: false,
    handler: async (ctx) => {
      const body = jsonBody(ctx);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const row = await queryOne<MemberAccountRow>(`${ACCOUNT_SQL} where lower(m.email) = $1`, [email]);
      if (!row || row.status !== 'active' || !(await verifyPassword(password, row.password_hash))) {
        throw apiErrors.invalidCredentials();
      }
      setSessionCookie(ctx.res, await startSession(row.id));
      sendJson(ctx.res, 200, { user: sessionUser(row) });
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/session',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const row = await queryOne<MemberAccountRow>(`${ACCOUNT_SQL} where m.id = $1`, [member.id]);
      if (!row) throw apiErrors.unauthenticated();
      sendJson(ctx.res, 200, { user: sessionUser(row) });
    },
  });

  addRoute({
    method: 'DELETE',
    pattern: '/api/session',
    auth: false,
    handler: async (ctx) => {
      if (ctx.member) await query('delete from sessions where id = $1', [ctx.member.sessionId]);
      clearSessionCookie(ctx.res);
      sendEmpty(ctx.res, 204);
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/invites/:token',
    auth: false,
    handler: async (ctx) => {
      const invite = await queryOne<{ name: string; station_name: string }>(
        `select m.name, s.name as station_name from invites i
         join members m on m.id = i.member_id join stations s on s.id = m.station_id
         where i.token = $1 and i.used_at is null`,
        [ctx.params.token],
      );
      if (!invite) throw apiErrors.notFound();
      sendJson(ctx.res, 200, { invite: { name: invite.name, stationName: invite.station_name } });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/invites/:token/accept',
    auth: false,
    handler: async (ctx) => {
      const body = jsonBody(ctx);
      const invite = await queryOne<{ member_id: string }>(
        'select member_id from invites where token = $1 and used_at is null',
        [ctx.params.token],
      );
      if (!invite) throw apiErrors.notFound();
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < MIN_PASSWORD_CHARS) {
        throw apiErrors.validation({ password: 'Use at least 10 characters.' });
      }
      await query("update members set password_hash = $2, status = 'active' where id = $1", [
        invite.member_id,
        await hashPassword(password),
      ]);
      await query('update invites set used_at = now() where token = $1', [ctx.params.token]);
      const row = await queryOne<MemberAccountRow>(`${ACCOUNT_SQL} where m.id = $1`, [invite.member_id]);
      if (!row) throw apiErrors.notFound();
      setSessionCookie(ctx.res, await startSession(row.id));
      sendJson(ctx.res, 200, { user: sessionUser(row) });
    },
  });
}
