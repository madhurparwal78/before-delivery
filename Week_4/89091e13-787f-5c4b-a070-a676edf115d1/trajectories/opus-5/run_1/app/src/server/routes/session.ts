import { randomUUID, timingSafeEqual } from 'node:crypto';
import { db, withTransaction } from '../db.js';
import { ApiError, clearedSessionCookie, sessionCookie, unprocessable } from '../http.js';
import { hashPassword } from '../domain/seed.js';
import { now } from '../domain/engine.js';
import { PersonRow, Role } from '../domain/types.js';
import { RequestContext, readString, requirePerson, StoredResponse } from './context.js';

const SIGN_IN_ERROR = 'Email or password is incorrect.';
const INVITE_ERROR = 'This invite link has already been used or has expired.';

interface PersonWithPassword extends PersonRow {
  password_salt: string;
  password_hash: string;
}

async function personByEmail(email: string): Promise<PersonWithPassword | null> {
  const { rows } = await db.query<PersonWithPassword>(
    'SELECT id, name, email, password_salt, password_hash FROM people WHERE lower(email) = lower($1)',
    [email],
  );
  return rows[0] ?? null;
}

function passwordMatches(person: PersonWithPassword, password: string): boolean {
  const expected = Buffer.from(person.password_hash, 'hex');
  const actual = Buffer.from(hashPassword(password, person.password_salt), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function identity(person: PersonRow): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ id: string; name: string; role: Role }>(
    `SELECT w.id, w.name, m.role FROM members m
       JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.person_id = $1 ORDER BY m.joined_at, w.name`,
    [person.id],
  );
  return {
    user: { id: person.id, name: person.name, email: person.email },
    workspaces: rows.map((row) => ({ id: row.id, name: row.name, role: row.role })),
  };
}

export async function signIn(ctx: RequestContext): Promise<StoredResponse> {
  const person = await personByEmail(readString(ctx, 'email'));
  if (!person || !passwordMatches(person, readString(ctx, 'password'))) {
    throw new ApiError(401, { error: SIGN_IN_ERROR });
  }
  const token = randomUUID();
  await db.query('INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, now())', [
    token,
    person.id,
  ]);
  ctx.cookies.push(sessionCookie(token));
  return { status: 200, body: await identity(person) };
}

export async function signOut(ctx: RequestContext): Promise<StoredResponse> {
  if (ctx.sessionToken) {
    await db.query('DELETE FROM sessions WHERE token = $1', [ctx.sessionToken]);
  }
  ctx.cookies.push(clearedSessionCookie());
  return { status: 204, body: null };
}

export async function me(ctx: RequestContext): Promise<StoredResponse> {
  const person = requirePerson(ctx);
  return { status: 200, body: await identity(person) };
}

interface InviteRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: Role;
  expires_at: Date;
  used_at: Date | null;
}

async function openInvite(token: string): Promise<InviteRow> {
  const { rows } = await db.query<InviteRow>(
    `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role, i.expires_at, i.used_at
     FROM invites i JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token = $1`,
    [token],
  );
  const invite = rows[0];
  if (!invite || invite.used_at || invite.expires_at.getTime() <= now().getTime()) {
    throw new ApiError(410, { error: INVITE_ERROR });
  }
  return invite;
}

export async function readInvite(token: string): Promise<StoredResponse> {
  const invite = await openInvite(token);
  const existing = await personByEmail(invite.email);
  return {
    status: 200,
    body: {
      workspaceName: invite.workspace_name,
      email: invite.email,
      role: invite.role,
      existingAccount: existing !== null,
    },
  };
}

export async function acceptInvite(
  ctx: RequestContext,
  token: string,
): Promise<StoredResponse> {
  const invite = await openInvite(token);
  const existing = await personByEmail(invite.email);
  const name = readString(ctx, 'name').trim();
  const password = readString(ctx, 'password');

  if (!existing) {
    if (name.length === 0) throw unprocessable('name', 'Enter your name.');
    if (password.length < 8) {
      throw unprocessable('password', 'Password must be at least 8 characters.');
    }
  } else if (!passwordMatches(existing, password)) {
    throw new ApiError(401, { error: SIGN_IN_ERROR });
  }

  const token2 = randomUUID();
  const at = now();
  await withTransaction(async (tx) => {
    let personId = existing?.id;
    if (!personId) {
      personId = randomUUID();
      const salt = randomUUID().replace(/-/g, '');
      await tx.query(
        `INSERT INTO people (id, name, email, password_salt, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [personId, name, invite.email, salt, hashPassword(password, salt), at],
      );
    }
    await tx.query(
      `INSERT INTO members (workspace_id, person_id, role, joined_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, person_id) DO NOTHING`,
      [invite.workspace_id, personId, invite.role, at],
    );
    await tx.query('UPDATE invites SET used_at = $2 WHERE id = $1', [invite.id, at]);
    await tx.query('INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)', [
      token2,
      personId,
      at,
    ]);
  });
  ctx.cookies.push(sessionCookie(token2));
  return { status: 200, body: { workspaceId: invite.workspace_id } };
}

export async function personForToken(token: string | null): Promise<PersonRow | null> {
  if (!token) return null;
  const { rows } = await db.query<PersonRow>(
    `SELECT p.id, p.name, p.email FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}
