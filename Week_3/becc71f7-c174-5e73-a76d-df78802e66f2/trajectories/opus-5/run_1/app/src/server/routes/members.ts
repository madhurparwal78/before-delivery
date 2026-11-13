import { jsonResponse, type Member, type RequestContext } from '../http/context.js';
import { conflict, notFound } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { hashPassword, memberOf } from '../http/sessions.js';
import { FieldProblems, readString, requireEmail, requireName } from '../http/validate.js';
import { instantParam, isUniqueViolation } from '../db.js';
import { memberWithCreatedAtJson } from './session.js';
import { UUID_PATTERN } from '../data/pieces.js';
import { randomUUID } from 'node:crypto';
import type { Role } from '../../shared/options.js';

const MEMBER_COLUMNS = `id, name, email, role, created_at, removed_at`;

/** A removed member's id, an unknown id and any id that is not a current member all answer 404. */
async function currentMember(ctx: RequestContext): Promise<Member> {
  const id = ctx.param('id');
  if (!UUID_PATTERN.test(id)) throw notFound();
  const { rows } = await ctx.app.db.query(
    `SELECT ${MEMBER_COLUMNS} FROM members WHERE id = $1 AND removed_at IS NULL`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return memberOf(row as never);
}

export const memberRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/members',
    access: 'owner',
    handle: async (ctx) => {
      const { rows } = await ctx.app.db.query(
        `SELECT ${MEMBER_COLUMNS} FROM members WHERE removed_at IS NULL ORDER BY created_at, name`,
      );
      return jsonResponse(200, {
        members: rows.map((row) => memberWithCreatedAtJson(memberOf(row as never))),
      });
    },
  }),

  route({
    method: 'POST',
    path: '/api/members',
    access: 'owner',
    handle: async (ctx) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const name = requireName(problems, body);
      const email = requireEmail(problems, body);
      const password = readString(body, 'password') ?? '';
      if (password.length < 10 || password.length > 128) {
        problems.add('password', 'Use a starting password of 10 to 128 characters.');
      }
      const role = readString(body, 'role') ?? '';
      if (role !== 'assistant' && role !== 'bookkeeper') {
        problems.add('role', 'Choose Shop assistant or Bookkeeper.');
      }
      problems.throwIfAny();

      const id = randomUUID();
      try {
        await ctx.app.db.query(
          `INSERT INTO members (id, name, email, email_lower, password_hash, role, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            name,
            email,
            email.toLowerCase(),
            hashPassword(password),
            role as Role,
            instantParam(ctx.now),
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('member_email_taken', 'A member already uses that email address.');
        }
        throw error;
      }
      const { rows } = await ctx.app.db.query(
        `SELECT ${MEMBER_COLUMNS} FROM members WHERE id = $1`,
        [id],
      );
      return jsonResponse(201, {
        member: memberWithCreatedAtJson(memberOf(rows[0] as never)),
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/members/:id',
    access: 'owner',
    resolve: currentMember,
    handle: async (_ctx, member) => jsonResponse(200, { member: memberWithCreatedAtJson(member) }),
  }),

  route({
    method: 'PATCH',
    path: '/api/members/:id',
    access: 'owner',
    resolve: currentMember,
    handle: async (ctx, member) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const role = readString(body, 'role') ?? '';
      if (role !== 'assistant' && role !== 'bookkeeper') {
        problems.add('role', 'Choose Shop assistant or Bookkeeper.');
      }
      problems.throwIfAny();
      await ctx.app.db.query(`UPDATE members SET role = $2 WHERE id = $1`, [member.id, role]);
      const { rows } = await ctx.app.db.query(
        `SELECT ${MEMBER_COLUMNS} FROM members WHERE id = $1`,
        [member.id],
      );
      return jsonResponse(200, { member: memberWithCreatedAtJson(memberOf(rows[0] as never)) });
    },
  }),

  route({
    method: 'DELETE',
    path: '/api/members/:id',
    access: 'owner',
    resolve: currentMember,
    handle: async (ctx, member) => {
      if (member.role === 'owner') {
        throw conflict('cannot_remove_owner', `The shop owner can't be removed.`);
      }
      await ctx.app.db.query(`UPDATE members SET removed_at = $2 WHERE id = $1`, [
        member.id,
        instantParam(ctx.now),
      ]);
      await ctx.app.db.query(
        `UPDATE sessions SET ended_at = $2 WHERE member_id = $1 AND ended_at IS NULL`,
        [member.id, instantParam(ctx.now)],
      );
      return { kind: 'empty', status: 204 };
    },
  }),
];
