import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { ApiError, validation } from '../errors.js';
import { asString } from '../input.js';
import { clearedSessionCookie, sessionCookie, type Ctx, type Reply } from '../http.js';
import { createSession, hashPassword, requireUser, verifyPassword } from '../access.js';
import { COPY } from '../../shared/domain.js';

export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0) return false;
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export async function signup(ctx: Ctx): Promise<Reply> {
  const email = (asString(ctx.json['email']) ?? '').trim().toLowerCase();
  const displayName = (asString(ctx.json['display_name']) ?? '').trim();
  const password = asString(ctx.json['password']) ?? '';

  const taken = await pool.query(`select 1 from users where email = $1`, [email]);
  if (taken.rowCount !== null && taken.rowCount > 0) {
    throw new ApiError(409, 'email_taken', COPY.emailTaken);
  }

  const fields: Record<string, string> = {};
  if (!isValidEmail(email)) fields['email'] = COPY.emailInvalid;
  if (password.length < 10) fields['password'] = COPY.passwordShort;
  if (displayName.length < 1 || displayName.length > 40) fields['display_name'] = COPY.displayNameInvalid;
  if (Object.keys(fields).length > 0) throw validation(fields);

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const token = await withTransaction(async (client) => {
    await client.query(`insert into users (id, email, password_hash, display_name) values ($1, $2, $3, $4)`, [
      id,
      email,
      passwordHash,
      displayName,
    ]);
    return createSession(client, id);
  });

  return {
    status: 201,
    json: { user: { id, email, display_name: displayName } },
    headers: { 'Set-Cookie': sessionCookie(token) },
  };
}

export async function login(ctx: Ctx): Promise<Reply> {
  const email = (asString(ctx.json['email']) ?? '').trim().toLowerCase();
  const password = asString(ctx.json['password']) ?? '';
  const found = await pool.query<{ id: string; email: string; display_name: string; password_hash: string }>(
    `select id, email, display_name, password_hash from users where email = $1`,
    [email],
  );
  const row = found.rows[0];
  const bad = new ApiError(401, 'invalid_credentials', COPY.badCredentials);
  if (row === undefined) throw bad;
  if (!(await verifyPassword(password, row.password_hash))) throw bad;
  const token = await createSession(pool, row.id);
  return {
    status: 200,
    json: { user: { id: row.id, email: row.email, display_name: row.display_name } },
    headers: { 'Set-Cookie': sessionCookie(token) },
  };
}

export async function logout(ctx: Ctx): Promise<Reply> {
  const token = ctx.cookies['ag_session'];
  if (token !== undefined) await pool.query(`delete from sessions where token = $1`, [token]);
  return { status: 204, headers: { 'Set-Cookie': clearedSessionCookie() } };
}

export async function me(ctx: Ctx): Promise<Reply> {
  const user = await requireUser(ctx);
  return { status: 200, json: { user } };
}
