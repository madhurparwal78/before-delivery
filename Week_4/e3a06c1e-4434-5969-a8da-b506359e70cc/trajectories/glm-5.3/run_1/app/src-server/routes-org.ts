// Auth, members, invitations and trial-request routes.

import { randomUUID } from 'node:crypto';
import { errors } from './errors';
import { json, type Ctx, type Route } from './router';
import { route } from './router';
import { readJson } from './body';
import {
  hashPassword, verifyPassword, parseCookies, sessionCookieHeader, clearCookieHeader,
  foldEmail,
} from './auth';
import { requireAction, landingRoute, visibleProjectIds } from './access';
import { checkText, isValidEmail, passwordLength } from '../src-shared/text';
import { TRIAL_STATUS, MEMBERS_STATUS, FIELD_MESSAGES } from '../src-shared/copy';
import type { Role } from '../src-shared/protocol';

const ROLES: Role[] = ['admin', 'developer', 'reviewer', 'approver', 'billing'];

export function authRoutes(): Route[] {
  return [
    route('POST', '/api/auth/sign-in', async (ctx: Ctx) => {
      const body = await readJson(ctx.req);
      const email = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      // Any missing or wrong value answers 401 invalid_credentials; never 422.
      const { rows } = await ctx.db.query(
        `SELECT id, org_id, name, email_folded, role, password_hash FROM members WHERE email_folded=$1`,
        [foldEmail(email)],
      );
      if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
        throw errors.conflict('invalid_credentials', 'That email and password don\u2019t match.');
      }
      const m = rows[0];
      const token = randomUUID() + randomUUID().replace(/-/g, '');
      await ctx.db.query(`INSERT INTO sign_in_sessions (token, member_id) VALUES ($1,$2)`, [token, m.id]);
      ctx.res.setHeader('Set-Cookie', sessionCookieHeader(token));
      json(ctx, 200, {
        user: { id: String(m.id), name: m.name, email: m.email_folded, role: m.role, org_id: String(m.org_id) },
        landing: landingRoute(m.role as Role),
      });
    }),

    route('POST', '/api/auth/sign-out', async (ctx: Ctx) => {
      const cookies = parseCookies(ctx.req);
      const token = cookies['lowfield_session'];
      if (token) await ctx.db.query(`DELETE FROM sign_in_sessions WHERE token=$1`, [token]);
      ctx.res.setHeader('Set-Cookie', clearCookieHeader());
      ctx.res.writeHead(204);
      ctx.res.end();
    }),

    route('GET', '/api/me', async (ctx: Ctx) => {
      if (!ctx.member) throw errors.unauthenticated();
      requireAction(ctx.member, 'readProfile');
      const { rows } = await ctx.db.query(`SELECT name, slug, plan FROM orgs WHERE id=$1`, [ctx.member.org_id]);
      const projectIds = await visibleProjectIds(ctx.db, ctx.member);
      json(ctx, 200, {
        user: { id: ctx.member.id, name: ctx.member.name, email: ctx.member.email, role: ctx.member.role, org_id: ctx.member.org_id },
        org: { id: ctx.member.org_id, name: rows[0].name, slug: rows[0].slug, plan: rows[0].plan },
        project_ids: projectIds,
      });
    }),

    route('POST', '/api/invitations/:token/accept', async (ctx: Ctx) => {
      const body = await readJson(ctx.req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (passwordLength(password) < 12) {
        throw errors.validation({ password: FIELD_MESSAGES.password });
      }
      const token = ctx.url.pathname.split('/')[3];
      const { rows } = await ctx.db.query(
        `SELECT i.id, i.org_id, i.name, i.email_folded, i.role, i.used_at,
                COALESCE(json_agg(ip.project_id) FILTER (WHERE ip.project_id IS NOT NULL), '[]') AS project_ids
           FROM invitations i LEFT JOIN invitation_projects ip ON ip.invitation_id = i.id
          WHERE i.token = $1 GROUP BY i.id`,
        [token],
      );
      if (rows.length === 0) throw errors.notFound();
      if (rows[0].used_at !== null) throw errors.conflict('invitation_used', 'This invitation has already been used.');
      const inv = rows[0];
      const memberId = randomUUID();
      await ctx.db.query('BEGIN');
      try {
        await ctx.db.query(
          `INSERT INTO members (id, org_id, name, email_folded, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)`,
          [memberId, inv.org_id, inv.name, inv.email_folded, hashPassword(password), inv.role],
        );
        for (const pid of inv.project_ids as string[]) {
          await ctx.db.query(`INSERT INTO member_projects (member_id, project_id) VALUES ($1,$2)`, [memberId, pid]);
        }
        const updated = await ctx.db.query(`UPDATE invitations SET used_at=now() WHERE id=$1 AND used_at IS NULL RETURNING id`, [inv.id]);
        if (updated.rows.length === 0) throw errors.conflict('invitation_used', 'This invitation has already been used.');
        await ctx.db.query('COMMIT');
      } catch (e) {
        await ctx.db.query('ROLLBACK');
        throw e;
      }
      const sessionToken = randomUUID() + randomUUID().replace(/-/g, '');
      await ctx.db.query(`INSERT INTO sign_in_sessions (token, member_id) VALUES ($1,$2)`, [sessionToken, memberId]);
      ctx.res.setHeader('Set-Cookie', sessionCookieHeader(sessionToken));
      json(ctx, 201, {
        user: { id: memberId, name: inv.name, email: inv.email_folded, role: inv.role, org_id: String(inv.org_id) },
        landing: landingRoute(inv.role as Role),
      });
    }),
  ];
}

export function orgRoutes(): Route[] {
  return [
    route('GET', '/api/org/members', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'manageMembers');
      const { rows: members } = await ctx.db.query(
        `SELECT m.id, m.name, m.email_folded, m.role, m.created_at,
                COALESCE(json_agg(mp.project_id) FILTER (WHERE mp.project_id IS NOT NULL), '[]') AS project_ids
           FROM members m LEFT JOIN member_projects mp ON mp.member_id = m.id
          WHERE m.org_id=$1 GROUP BY m.id ORDER BY m.created_at`,
        [member.org_id],
      );
      const { rows: invitations } = await ctx.db.query(
        `SELECT i.id, i.name, i.email_folded, i.role, i.used_at,
                COALESCE(json_agg(ip.project_id) FILTER (WHERE ip.project_id IS NOT NULL), '[]') AS project_ids
           FROM invitations i LEFT JOIN invitation_projects ip ON ip.invitation_id = i.id
          WHERE i.org_id=$1 AND i.used_at IS NULL GROUP BY i.id ORDER BY i.created_at`,
        [member.org_id],
      );
      json(ctx, 200, {
        members: members.map((m) => ({
          id: String(m.id), name: m.name, email: m.email_folded, role: m.role,
          project_ids: (m.role === 'admin' || m.role === 'billing') ? [] : (m.project_ids as string[]),
          joined_at: iso(m.created_at),
        })),
        invitations: invitations.map((i) => ({
          id: String(i.id), name: i.name, email: i.email_folded, role: i.role,
          project_ids: i.project_ids as string[], used: false,
        })),
      });
    }),

    route('POST', '/api/org/invitations', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'manageMembers');
      const body = await readJson(ctx.req);
      const name = typeof body.name === 'string' ? body.name : '';
      const email = typeof body.email === 'string' ? body.email : '';
      const role = body.role;
      const projectIds = Array.isArray(body.project_ids) ? (body.project_ids as unknown[]) : null;

      const fields: Record<string, string> = {};
      const nameCheck = checkText(name, 1, 100);
      if (!nameCheck.ok) fields.name = MEMBERS_STATUS.nameError;
      if (!isValidEmail(email)) fields.email = MEMBERS_STATUS.emailError;
      if (typeof role !== 'string' || !ROLES.includes(role as Role)) fields.role = MEMBERS_STATUS.roleError;
      if (projectIds === null || projectIds.some((p) => typeof p !== 'string')) fields.project_ids = MEMBERS_STATUS.projectsError;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      // A listed id outside the caller's organisation answers 404 by the error precedence.
      const valid = projectIds as unknown[];
      const { rows: found } = await ctx.db.query(
        `SELECT id FROM projects WHERE org_id=$1 AND id = ANY($2::uuid[])`,
        [member.org_id, valid],
      );
      if (found.length !== valid.length) throw errors.notFound();

      const emailFolded = foldEmail(email);
      const { rows: existingMember } = await ctx.db.query(
        `SELECT id FROM members WHERE org_id=$1 AND email_folded=$2`, [member.org_id, emailFolded],
      );
      if (existingMember.length > 0) throw errors.conflict('email_taken', 'This email is already a member.');
      const { rows: existingInv } = await ctx.db.query(
        `SELECT id FROM invitations WHERE org_id=$1 AND email_folded=$2 AND used_at IS NULL`, [member.org_id, emailFolded],
      );
      if (existingInv.length > 0) throw errors.conflict('email_taken', 'This email is already invited.');

      const id = randomUUID();
      const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      await ctx.db.query('BEGIN');
      try {
        await ctx.db.query(
          `INSERT INTO invitations (id, org_id, name, email_folded, role, token) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, member.org_id, (checkText(name, 1, 100) as { value: string }).value, emailFolded, role, token],
        );
        for (const p of found) await ctx.db.query(`INSERT INTO invitation_projects (invitation_id, project_id) VALUES ($1,$2)`, [id, String(p.id)]);
        await ctx.db.query('COMMIT');
      } catch (e) {
        await ctx.db.query('ROLLBACK');
        throw e;
      }
      json(ctx, 201, { id, invite_url: `/join/${token}` });
    }),

    route('PATCH', '/api/org/members/:member_id', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'manageMembers');
      const targetId = ctx.url.pathname.split('/')[5];
      if (targetId === member.id) throw errors.conflict('self_change', 'You can\u2019t change or remove your own membership.');
      const body = await readJson(ctx.req);
      const { rows } = await ctx.db.query(`SELECT id, org_id FROM members WHERE id=$1`, [targetId]);
      if (rows.length === 0 || String(rows[0].org_id) !== member.org_id) throw errors.notFound();

      const fields: Record<string, string> = {};
      const role = body.role;
      const projectIds = body.project_ids;
      if (role !== undefined && (typeof role !== 'string' || !ROLES.includes(role as Role))) fields.role = MEMBERS_STATUS.roleError;
      if (projectIds !== undefined && (!Array.isArray(projectIds) || (projectIds as unknown[]).some((p) => typeof p !== 'string'))) fields.project_ids = MEMBERS_STATUS.projectsError;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      if (projectIds !== undefined) {
        const list = projectIds as unknown[];
        const { rows: found } = await ctx.db.query(`SELECT id FROM projects WHERE org_id=$1 AND id = ANY($2::uuid[])`, [member.org_id, list]);
        if (found.length !== list.length) throw errors.notFound();
      }
      await ctx.db.query('BEGIN');
      try {
        if (typeof role === 'string') await ctx.db.query(`UPDATE members SET role=$2 WHERE id=$1`, [targetId, role]);
        if (projectIds !== undefined) {
          await ctx.db.query(`DELETE FROM member_projects WHERE member_id=$1`, [targetId]);
          for (const p of projectIds as string[]) await ctx.db.query(`INSERT INTO member_projects (member_id, project_id) VALUES ($1,$2)`, [targetId, p]);
        }
        await ctx.db.query('COMMIT');
      } catch (e) {
        await ctx.db.query('ROLLBACK');
        throw e;
      }
      const { rows: after } = await ctx.db.query(
        `SELECT m.id, m.name, m.email_folded, m.role, m.created_at,
                COALESCE(json_agg(mp.project_id) FILTER (WHERE mp.project_id IS NOT NULL), '[]') AS project_ids
           FROM members m LEFT JOIN member_projects mp ON mp.member_id = m.id
          WHERE m.id=$1 GROUP BY m.id`,
        [targetId],
      );
      const m = after[0];
      json(ctx, 200, {
        member: {
          id: String(m.id), name: m.name, email: m.email_folded, role: m.role,
          project_ids: m.project_ids as string[], joined_at: iso(m.created_at),
        },
      });
    }),

    route('DELETE', '/api/org/members/:member_id', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'manageMembers');
      const targetId = ctx.url.pathname.split('/')[5];
      if (targetId === member.id) throw errors.conflict('self_change', 'You can\u2019t change or remove your own membership.');
      const { rows } = await ctx.db.query(`SELECT id FROM members WHERE id=$1 AND org_id=$2`, [targetId, member.org_id]);
      if (rows.length === 0) throw errors.notFound();
      // Removal applies on the member's next request: their cookies stop working at once.
      await ctx.db.query(`DELETE FROM members WHERE id=$1`, [targetId]);
      ctx.res.writeHead(204);
      ctx.res.end();
    }),
  ];
}

export function publicRoutes(): Route[] {
  return [
    route('POST', '/api/trial-requests', async (ctx: Ctx) => {
      const body = await readJson(ctx.req);
      const name = typeof body.name === 'string' ? body.name : '';
      const email = typeof body.email === 'string' ? body.email : '';
      const company = typeof body.company === 'string' ? body.company : '';
      const team = body.team;
      const fields: Record<string, string> = {};
      if (!checkText(name, 1, 100).ok) fields.name = TRIAL_STATUS.name;
      if (!isValidEmail(email)) fields.email = TRIAL_STATUS.email;
      if (!checkText(company, 1, 100).ok) fields.company = TRIAL_STATUS.company;
      if (team !== 'contact_centre' && team !== 'clinical_dictation') fields.team = TRIAL_STATUS.team;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      const stored = {
        name: (checkText(name, 1, 100) as { value: string }).value,
        company: (checkText(company, 1, 100) as { value: string }).value,
      };
      const emailFolded = foldEmail(email);
      const existing = await ctx.db.query(`SELECT id, received_at FROM trial_requests WHERE email_folded=$1`, [emailFolded]);
      if (existing.rows.length > 0) {
        // A repeat from the same email replays the first request.
        json(ctx, 200, { id: String(existing.rows[0].id), received_at: iso(existing.rows[0].received_at) });
        return;
      }
      const id = randomUUID();
      await ctx.db.query(
        `INSERT INTO trial_requests (id, email_folded, name, company, team) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email_folded) DO NOTHING`,
        [id, emailFolded, stored.name, stored.company, team],
      );
      const after = await ctx.db.query(`SELECT id, received_at FROM trial_requests WHERE email_folded=$1`, [emailFolded]);
      json(ctx, 201, { id: String(after.rows[0].id), received_at: iso(after.rows[0].received_at) });
    }),
  ];
}

function iso(d: Date): string {
  return d.toISOString().replace(/(\.\d{3})Z$/, 'Z');
}
