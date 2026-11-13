// Sessions (DP-01) and members (DP-02).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str } from '../http.js';
import { ApiError } from '../errors.js';
import { toZ } from '../../shared/time.js';
import { hashPassword, verifyPassword, homeRouteFor, SESSION_COOKIE } from './session.js';

const memberSelection = 'SELECT id, name, email, role, created_at FROM members';

export const sessionAndMemberRoutes: Route[] = [
  // Sessions
  {
    method: 'POST', pattern: '/api/session', bodyLimit: 65536, auth: 'public',
    handle: async (ctx: RouteContext) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const email = str(body.email) ?? '';
      const password = str(body.password) ?? '';
      const { rows } = await ctx.services.pool.query(
        'SELECT id, name, email, role, password_hash FROM members WHERE email = $1 AND removed_at IS NULL',
        [email]
      );
      const row = rows[0];
      if (!row || !verifyPassword(password, row.password_hash)) {
        throw invalidCredentials();
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + ctx.services.config.timers.sessionSeconds * 1000);
      await ctx.services.pool.query(
        'INSERT INTO sessions (token, member_id, started_at, ends_at) VALUES ($1, $2, $3, $4)',
        [token, row.id, startedAt, endsAt]
      );
      sendJson(ctx.res, 200, {
        member: { id: row.id, name: row.name, email: row.email, role: row.role },
        homeRoute: homeRouteFor(row.role),
      }, { 'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/` });
    },
  },
  {
    method: 'GET', pattern: '/api/session', bodyLimit: 0, auth: 'staff',
    handle: async (ctx) => {
      const { rows } = await ctx.services.pool.query(
        'SELECT id, name, email, role FROM members WHERE id = $1', [ctx.member!.id]
      );
      const m = rows[0]!;
      sendJson(ctx.res, 200, {
        member: { id: m.id, name: m.name, email: m.email, role: m.role },
        homeRoute: homeRouteFor(m.role),
      });
    },
  },
  {
    method: 'DELETE', pattern: '/api/session', bodyLimit: 0, auth: 'staff',
    handle: async (ctx) => {
      await ctx.services.pool.query('DELETE FROM sessions WHERE token = $1', [ctx.sessionToken]);
      ctx.res.writeHead(204, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
      ctx.res.end();
    },
  },

  // Members (owner only)
  {
    method: 'GET', pattern: '/api/members', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const { rows } = await ctx.services.pool.query(`${memberSelection} WHERE removed_at IS NULL ORDER BY created_at, id`);
      sendJson(ctx.res, 200, { members: rows.map(memberJson) });
    },
  },
  {
    method: 'POST', pattern: '/api/members', bodyLimit: 65536, auth: 'owner',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const name = str(body.name);
      const email = str(body.email)?.toLowerCase();
      const password = str(body.password);
      const role = str(body.role);
      const fields: Record<string, string> = {};
      if (!name || name.trim().length === 0) fields.name = 'Enter a name.';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter an email address like name@example.be.';
      if (!password || password.length < 10 || password.length > 128) fields.password = 'Enter a starting password of 10 to 128 characters.';
      if (role !== 'assistant' && role !== 'bookkeeper') fields.role = 'Choose a role.';
      if (Object.keys(fields).length > 0) throw validationFailed(fields);
      const { rows } = await ctx.services.pool.query(
        'SELECT 1 FROM members WHERE email = $1 AND removed_at IS NULL', [email!]
      );
      if (rows.length > 0) throw memberEmailTaken();
      const id = crypto.randomUUID();
      await ctx.services.pool.query(
        `INSERT INTO members (id, name, email, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, name!.trim(), email!, hashPassword(password!), role!, new Date()]
      );
      const created = await ctx.services.pool.query(`${memberSelection} WHERE id = $1`, [id]);
      sendJson(ctx.res, 201, { member: memberJson(created.rows[0]!) });
    },
  },
  {
    method: 'GET', pattern: '/api/members/:id', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const row = await currentMember(ctx, ctx.params.id!);
      sendJson(ctx.res, 200, { member: memberJson(row) });
    },
  },
  {
    method: 'PATCH', pattern: '/api/members/:id', bodyLimit: 65536, auth: 'owner',
    handle: async (ctx) => {
      const row = await currentMember(ctx, ctx.params.id!);
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const role = str(body.role);
      if (role !== 'assistant' && role !== 'bookkeeper' && role !== 'owner') {
        throw validationFailed({ role: 'Choose a role.' });
      }
      await ctx.services.pool.query('UPDATE members SET role = $1 WHERE id = $2', [role, row.id]);
      const updated = await ctx.services.pool.query(`${memberSelection} WHERE id = $1`, [row.id]);
      sendJson(ctx.res, 200, { member: memberJson(updated.rows[0]!) });
    },
  },
  {
    method: 'DELETE', pattern: '/api/members/:id', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const row = await currentMember(ctx, ctx.params.id!);
      if (row.role === 'owner') throw cannotRemoveOwner();
      await ctx.services.pool.query('UPDATE members SET removed_at = $1 WHERE id = $2', [new Date(), row.id]);
      await ctx.services.pool.query('DELETE FROM sessions WHERE member_id = $1', [row.id]);
      ctx.res.writeHead(204);
      ctx.res.end();
    },
  },
];

/** A current member by id; a removed, unknown or non-member id answers 404 alike (DP-02). */
async function currentMember(ctx: RouteContext, id: string): Promise<{ id: string; name: string; email: string; role: string; created_at: Date }> {
  const { rows } = await ctx.services.pool.query(
    `${memberSelection} WHERE id = $1 AND removed_at IS NULL`, [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

function memberJson(m: { id: string; name: string; email: string; role: string; created_at: Date }): unknown {
  return { id: m.id, name: m.name, email: m.email, role: m.role, createdAt: toZ(new Date(m.created_at)) };
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}

function invalidCredentials(): ApiError {
  return new ApiError(401, 'invalid_credentials', 'That email and password don\u2019t match.');
}
function memberEmailTaken(): ApiError { return new ApiError(409, 'member_email_taken', 'A member with that email already exists.'); }
function cannotRemoveOwner(): ApiError { return new ApiError(409, 'cannot_remove_owner', 'The shop owner cannot be removed.'); }
function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);
}
