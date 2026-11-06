import { randomUUID } from 'node:crypto';
import { nowDate } from '../clock.js';
import { db, tx } from '../db.js';
import { ApiError } from '../errors.js';
import { createSession, hashToken, personBody, toActor, type PersonRow } from '../access.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { publicRoute, sessionRoute, type Route } from '../router.js';
import { emailField, passwordField, textField } from '../validate.js';
import { workspaceBody } from '../workspaces.js';

const sessionMaxAge = 60 * 60 * 24 * 30;

async function personById(id: string): Promise<PersonRow> {
  const row = await db.one<PersonRow>(
    'select id, name, email, handle, role, workspace_id, removed, away from people where id = $1',
    [id],
  );
  if (row === undefined) throw new ApiError('unauthenticated');
  return row;
}

export const authRoutes: Route[] = [
  publicRoute('POST', '/api/accounts', 'json', async (ctx) => {
    const name = textField(ctx.body, 'name', {
      field: 'name',
      min: 1,
      max: 80,
      message: 'Use 1 to 80 characters.',
    });
    const email = emailField(ctx.body);
    const password = passwordField(ctx.body, 'password');
    const existing = await db.one<{ id: string }>('select id from people where email_lower = $1', [
      email.toLowerCase(),
    ]);
    if (existing !== undefined) throw new ApiError('email_taken');
    const id = randomUUID();
    const hash = await hashPassword(password);
    const token = await tx(async (client) => {
      await client.query(
        `insert into people (id, workspace_id, name, email, email_lower, handle, role, password_hash, created_at, last_seen_at, away)
         values ($1, null, $2, $3, $4, null, null, $5, $6, $6, false)`,
        [id, name, email, email.toLowerCase(), hash, nowDate().toISOString()],
      );
      return createSession(client, id);
    });
    const person = await personById(id);
    return {
      status: 201,
      body: { person: personBody(person) },
      cookie: { value: token, maxAge: sessionMaxAge },
    };
  }),

  publicRoute('POST', '/api/session', 'json', async (ctx) => {
    const email = typeof ctx.body.email === 'string' ? ctx.body.email : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const row = await db.one<PersonRow & { password_hash: string }>(
      `select id, name, email, handle, role, workspace_id, removed, away, password_hash
         from people where email_lower = $1`,
      [email.toLowerCase()],
    );
    if (row === undefined || !(await verifyPassword(password, row.password_hash))) {
      throw new ApiError('invalid_credentials', { message: "That email and password don't match." });
    }
    const token = await tx(async (client) => createSession(client, row.id));
    const actor = toActor(row);
    return {
      status: 200,
      body: {
        person: personBody(row),
        workspace: actor.workspaceId === null ? null : await workspaceBody(actor, actor.workspaceId),
      },
      cookie: { value: token, maxAge: sessionMaxAge },
    };
  }),

  sessionRoute('DELETE', '/api/session', 'none', async (ctx) => {
    await db.query('update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null', [
      hashToken(ctx.sessionToken ?? ''),
      nowDate().toISOString(),
    ]);
    return { status: 204, cookie: { clear: true } };
  }),

  sessionRoute('GET', '/api/me', 'none', async (ctx) => {
    const row = await personById(ctx.actor.id);
    return {
      status: 200,
      body: {
        person: personBody(row),
        workspace: ctx.actor.workspaceId === null ? null : await workspaceBody(ctx.actor, ctx.actor.workspaceId),
      },
    };
  }),

  sessionRoute('POST', '/api/account/password', 'json', async (ctx) => {
    const current = typeof ctx.body.current_password === 'string' ? ctx.body.current_password : '';
    const next = passwordField(ctx.body, 'new_password');
    const row = await db.one<{ password_hash: string }>('select password_hash from people where id = $1', [
      ctx.actor.id,
    ]);
    if (row === undefined || !(await verifyPassword(current, row.password_hash))) {
      throw new ApiError('invalid_credentials', {
        status: 403,
        message: "That current password isn't right.",
      });
    }
    const hash = await hashPassword(next);
    const keep = hashToken(ctx.sessionToken ?? '');
    await tx(async (client) => {
      await client.query('update people set password_hash = $2 where id = $1', [ctx.actor.id, hash]);
      await client.query(
        'update sessions set revoked_at = $3 where person_id = $1 and token_hash <> $2 and revoked_at is null',
        [ctx.actor.id, keep, nowDate().toISOString()],
      );
    });
    return { status: 204 };
  }),
];
