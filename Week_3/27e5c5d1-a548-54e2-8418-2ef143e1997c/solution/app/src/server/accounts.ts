import type { Colour } from '../shared/types.ts';
import { createSession, endOtherSessions, endSession, expiredCookie, sessionCookie } from './auth.ts';
import { database, transaction, type Row, only } from './db.ts';
import { invalidCredentials } from './errors.ts';
import type { Handler, PublicHandler } from './http-types.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { safeReturnPath } from './redirect.ts';
import { accessChanged, liveState } from './hub.ts';
import { storageState } from './storage.ts';
import { Input, text } from './validate.ts';
import { workspaceFrom } from './workspaces.ts';

const PASSWORD_LENGTH = 'Use 12 to 200 characters.';
const credential = { parse: (value: unknown) => (typeof value === 'string' && value.length > 0 && value.length <= 400 ? { ok: true as const, value } : { ok: false as const, message: 'Enter a value.' }) };
const next = { parse: (value: unknown) => ({ ok: true as const, value }) };

let dummyHash: Promise<string> | null = null;

/** Sign in: same work and same answer whether the email exists or the password is wrong. */
export const signIn: PublicHandler = async ({ body, response }) => {
  const input = new Input(body, { email: credential, password: credential, next }, ['email', 'password']);
  const { email, password, next: returnTo } = input.check();
  const { rows } = await database().query<Row>(
    'SELECT id, display_name, initials, colour, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const row = rows[0];
  dummyHash ??= hashPassword('not-a-real-password');
  const valid = await verifyPassword(password, row ? (row['password_hash'] as string) : await dummyHash);
  if (!row || !valid) throw invalidCredentials();
  const token = await createSession(database(), row['id'] as string);
  response.setHeader('Set-Cookie', sessionCookie(token));
  return {
    status: 200,
    body: {
      user: {
        userId: row['id'],
        displayName: row['display_name'],
        initials: row['initials'],
        colour: row['colour'] as Colour,
      },
      redirectTo: safeReturnPath(returnTo),
    },
  };
};

export const signOut: Handler = async ({ actor, response }) => {
  await endSession(database(), actor.tokenHash);
  void accessChanged({ userId: actor.userId });
  response.setHeader('Set-Cookie', expiredCookie());
  return { status: 204 };
};

export const me: Handler = async ({ actor }) => {
  const { rows } = await database().query<Row>(
    `SELECT w.id, w.name, w.parent_name, w.time_zone, wm.role
       FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1 ORDER BY wm.seq`,
    [actor.userId],
  );
  return {
    status: 200,
    body: {
      userId: actor.userId,
      displayName: actor.displayName,
      initials: actor.initials,
      colour: actor.colour,
      email: actor.email,
      workspaces: rows.map(workspaceFrom),
    },
  };
};

export const changePassword: Handler = async ({ actor, body }) => {
  const input = new Input(
    body,
    { currentPassword: credential, newPassword: text({ min: 12, max: 200, trim: false, empty: PASSWORD_LENGTH, long: PASSWORD_LENGTH }) },
    ['currentPassword', 'newPassword'],
  );
  const attempt = input.peek('currentPassword');
  const { rows } = await database().query<Row>('SELECT password_hash FROM users WHERE id = $1', [actor.userId]);
  const current = typeof attempt === 'string' && (await verifyPassword(attempt, only(rows)['password_hash'] as string));
  const values = input.check(current || attempt === undefined ? {} : { currentPassword: "That isn't your current password." });
  const hash = await hashPassword(values.newPassword);
  const ended = await transaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, actor.userId]);
    return endOtherSessions(client, actor.userId, actor.tokenHash);
  });
  void accessChanged({ userId: actor.userId });
  return { status: 200, body: { signedOutSessions: ended } };
};

export const serviceStatus: Handler = async () => ({
  status: 200,
  body: { live: liveState(), storage: storageState() },
});
