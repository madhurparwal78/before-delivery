import { MemberDto } from '../../shared/api';
import { ROLE_LABELS, roleCan } from '../../shared/roles';
import { MemberRole } from '../../shared/workbook';
import { isValidTimeZone } from '../../shared/zone';
import { query, queryOne, transaction } from '../db';
import { jsonBody, requireMember, sendEmpty, sendJson } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { inviteToken, uuid } from '../secrets';
import { recomputeCutoffs } from '../domain/season';
import { queueMail } from '../services/mail';
import { serviceStatus } from '../services/status';

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const ROLES: MemberRole[] = ['viewer', 'technician', 'lead', 'data_manager'];

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: 'invited' | 'active';
}

function memberDto(row: MemberRow): MemberDto {
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}

export function registerStationRoutes(): void {
  addRoute({
    method: 'GET',
    pattern: '/api/station',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const row = await queryOne<{ id: string; name: string; time_zone: string }>(
        'select id, name, time_zone from stations where id = $1',
        [member.stationId],
      );
      if (!row) throw apiErrors.notFound();
      sendJson(ctx.res, 200, { station: { id: row.id, name: row.name, timeZone: row.time_zone } });
    },
  });

  addRoute({
    method: 'PATCH',
    pattern: '/api/station',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'stationManage')) throw apiErrors.forbidden();
      const timeZone = jsonBody(ctx).timeZone;
      if (typeof timeZone !== 'string' || !timeZone.includes('/') || !isValidTimeZone(timeZone)) {
        throw apiErrors.validation({ timeZone: 'Pick a time zone from the list.' });
      }
      const station = await transaction(async (client) => {
        const row = (
          await client.query('update stations set time_zone = $2 where id = $1 returning id, name, time_zone', [
            member.stationId,
            timeZone,
          ])
        ).rows[0] as { id: string; name: string; time_zone: string };
        await recomputeCutoffs(client, member.stationId, timeZone);
        return row;
      });
      sendJson(ctx.res, 200, { station: { id: station.id, name: station.name, timeZone: station.time_zone } });
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/station/members',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'stationManage')) throw apiErrors.forbidden();
      const rows = await query<MemberRow>(
        'select id, name, email, role, status from members where station_id = $1 order by name asc',
        [member.stationId],
      );
      sendJson(ctx.res, 200, { members: rows.map(memberDto) });
    },
  });

  addRoute({
    method: 'POST',
    pattern: '/api/station/members',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'stationManage')) throw apiErrors.forbidden();
      const body = jsonBody(ctx);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const role = body.role;
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 80) fields.name = 'Enter a name of 1 to 80 characters.';
      if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
      if (typeof role !== 'string' || !ROLES.includes(role as MemberRole)) fields.role = 'Pick a role.';
      if (Object.keys(fields).length > 0) throw apiErrors.validation(fields);
      const existing = await queryOne<{ id: string }>('select id from members where lower(email) = lower($1)', [email]);
      if (existing) throw apiErrors.memberExists(email);
      const token = inviteToken();
      const created = await transaction(async (client) => {
        const row = (
          await client.query(
            `insert into members (id, station_id, name, email, role, status)
             values ($1,$2,$3,$4,$5,'invited') returning id, name, email, role, status`,
            [uuid(), member.stationId, name, email, role],
          )
        ).rows[0] as MemberRow;
        await client.query('insert into invites (token, member_id) values ($1,$2)', [token, row.id]);
        await queueMail(client, {
          to: email,
          subject: `You're invited to ${member.stationName} on Furrowbook`,
          body:
            `${name}, you have been invited to ${member.stationName} on Furrowbook as ` +
            `${ROLE_LABELS[role as MemberRole]}.\n\nSet your password here:\n${ctx.origin}/invite/${token}\n`,
        });
        return row;
      });
      const status = await serviceStatus();
      sendJson(ctx.res, 201, {
        member: memberDto(created),
        invite: status.mail === 'up' ? 'sent' : 'queued',
      });
    },
  });

  addRoute({
    method: 'PATCH',
    pattern: '/api/station/members/:memberId',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'stationManage')) throw apiErrors.forbidden();
      const role = jsonBody(ctx).role;
      if (typeof role !== 'string' || !ROLES.includes(role as MemberRole)) {
        throw apiErrors.validation({ role: 'Pick a role.' });
      }
      const target = await queryOne<MemberRow>(
        'select id, name, email, role, status from members where id = $1 and station_id = $2',
        [ctx.params.memberId, member.stationId],
      );
      if (!target) throw apiErrors.notFound();
      if (target.role === 'data_manager' && role !== 'data_manager' && (await isLastDataManager(member.stationId))) {
        throw apiErrors.lastDataManager();
      }
      const updated = await queryOne<MemberRow>(
        'update members set role = $2 where id = $1 returning id, name, email, role, status',
        [target.id, role],
      );
      sendJson(ctx.res, 200, { member: memberDto(updated as MemberRow) });
    },
  });

  addRoute({
    method: 'DELETE',
    pattern: '/api/station/members/:memberId',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      if (!roleCan(member.role, 'stationManage')) throw apiErrors.forbidden();
      const target = await queryOne<MemberRow>(
        'select id, name, email, role, status from members where id = $1 and station_id = $2',
        [ctx.params.memberId, member.stationId],
      );
      if (!target) throw apiErrors.notFound();
      if (target.role === 'data_manager' && (await isLastDataManager(member.stationId))) {
        throw apiErrors.lastDataManager();
      }
      await query('delete from members where id = $1', [target.id]);
      sendEmpty(ctx.res, 204);
    },
  });
}

async function isLastDataManager(stationId: string): Promise<boolean> {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text as count from members where station_id = $1 and role = 'data_manager'",
    [stationId],
  );
  return Number(row?.count ?? '0') <= 1;
}
