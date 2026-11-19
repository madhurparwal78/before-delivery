/**
 * Desk access: health, signing up, the session and changing a password.
 */
import { F } from '../../shared/feedback.ts';
import { giveDeskItsStartingRows } from '../db/seed.ts';
import { hashPassword, newToken, verifyPassword } from '../db/pool.ts';
import { fail } from '../http/errors.ts';
import { Check, LIMITS } from '../http/validate.ts';
import type { Ctx, Route } from '../http/context.ts';
import { BUSINESS_ZONE, instantText, localTime } from '../domain/time.ts';
import type { Row } from '../present.ts';
import { indexDesk } from '../features/indexing.ts';

/**
 * A return address is honoured only if it is a same-origin relative path: one
 * leading slash, no second slash or backslash after it, and no scheme.
 */
export function honouredReturn(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '/pieces';
  if (!value.startsWith('/')) return '/pieces';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/pieces';
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return '/pieces';
  return value;
}

async function startSession(ctx: Ctx, deskId: string): Promise<string> {
  const token = newToken();
  const endsAt = new Date(ctx.app.now() + ctx.app.config.timers.sessionSeconds * 1000);
  await ctx.app.db.query(`INSERT INTO sessions (id, desk_id, ends_at) VALUES ($1,$2,$3)`, [
    token,
    deskId,
    endsAt,
  ]);
  ctx.setSessionCookie(token);
  return token;
}

export const accessRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    auth: 'none',
    async handle(ctx) {
      ctx.json(200, { status: 'ok' });
    },
  },

  {
    method: 'POST',
    pattern: '/api/sign-up',
    auth: 'none',
    body: 'json',
    async handle(ctx) {
      const check = new Check(ctx.body);
      const name = check.text('name', LIMITS.clientName);
      const email = check.email('email') as string | null;
      const password = check.password('password');
      check.done();

      const taken = await ctx.app.db.one<Row>(`SELECT id FROM desks WHERE lower(email) = lower($1)`, [
        email,
      ]);
      if (taken) throw fail.conflict(F.emailTaken);

      const desk = await ctx.app.db.one<Row>(
        `INSERT INTO desks (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id`,
        [name, email, hashPassword(password!)],
      );
      const deskId = String(desk!.id);
      await giveDeskItsStartingRows(ctx.app, deskId);
      await startSession(ctx, deskId);
      void indexDesk(ctx.app, deskId);

      ctx.json(201, {
        session: { deskId, name, email, landing: '/pieces' },
      });
    },
  },

  {
    method: 'POST',
    pattern: '/api/session',
    auth: 'none',
    body: 'json',
    async handle(ctx) {
      const check = new Check(ctx.body);
      const email = check.email('email') as string | null;
      const password = check.text('password', 200);
      check.done();

      const desk = await ctx.app.db.one<Row>(
        `SELECT * FROM desks WHERE lower(email) = lower($1)`,
        [email],
      );
      if (!desk || !verifyPassword(password!, String(desk.password_hash))) {
        throw fail.notSignedIn(F.badPair);
      }
      const deskId = String(desk.id);
      await startSession(ctx, deskId);
      ctx.json(200, {
        session: {
          deskId,
          name: String(desk.name),
          email: String(desk.email),
          landing: honouredReturn(ctx.body.returnTo),
        },
      });
    },
  },

  {
    method: 'GET',
    pattern: '/api/session',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const answer = await ctx.app.db.one<Row>(
        `SELECT cp.id, cp.answered_at, cp.seat_height, p.title, c.name
           FROM client_pages cp
           JOIN pieces p ON p.id = cp.piece_id
           JOIN clients c ON c.id = p.client_id
          WHERE p.desk_id = $1 AND cp.answered_at IS NOT NULL
          ORDER BY cp.answered_at DESC LIMIT 1`,
        [desk.id],
      );
      ctx.json(200, {
        session: {
          deskId: desk.id,
          name: desk.name,
          email: desk.email,
          today: ctx.app.todayText(),
          latestAnswer: answer
            ? {
                id: `${String(answer.id)}-${new Date(answer.answered_at as string).getTime()}`,
                message: F.clientAnswered(
                  String(answer.name),
                  String(answer.title),
                  localTime(BUSINESS_ZONE, new Date(answer.answered_at as string).getTime()),
                ),
                at: instantText(new Date(answer.answered_at as string).getTime()),
              }
            : null,
        },
      });
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/session',
    auth: 'none',
    async handle(ctx) {
      const token = ctx.request.headers.cookie;
      if (token) {
        const value = /semenza_session=([^;]+)/.exec(token)?.[1];
        if (value) await ctx.app.db.query(`DELETE FROM sessions WHERE id = $1`, [value]);
      }
      ctx.clearSessionCookie();
      ctx.noContent();
    },
  },

  {
    method: 'POST',
    pattern: '/api/password',
    auth: 'required',
    body: 'json',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const check = new Check(ctx.body);
      const current = check.text('currentPassword', 200);
      const next = check.password('newPassword');
      check.done();

      const row = await ctx.app.db.one<Row>(`SELECT password_hash FROM desks WHERE id = $1`, [
        desk.id,
      ]);
      if (!row || !verifyPassword(current!, String(row.password_hash))) {
        throw fail.fields({ currentPassword: F.badPair });
      }

      // The other sessions end at once; this one stays signed in.
      const keep = /semenza_session=([^;]+)/.exec(ctx.request.headers.cookie ?? '')?.[1] ?? '';
      await ctx.app.db.query(`UPDATE desks SET password_hash = $2 WHERE id = $1`, [
        desk.id,
        hashPassword(next!),
      ]);
      await ctx.app.db.query(`DELETE FROM sessions WHERE desk_id = $1 AND id <> $2`, [
        desk.id,
        keep,
      ]);
      ctx.noContent();
    },
  },
];
