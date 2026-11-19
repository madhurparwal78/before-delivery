import { randomBytes } from 'node:crypto';
import { checkAccountFields, createSession, firstWorkspaceId, hashPassword, verifyLogin } from './auth.js';
import { config } from './config.js';
import { db, isUniqueViolation, type Queryable } from './db.js';
import { refuse } from './errors.js';
import { newId, newToken } from './ids.js';
import type { JsonObject } from './json.js';
import { MailUnavailable, sendMail } from './mailer.js';
import { msg } from './messages.js';
import type { Role } from './model.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function slugOf(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

async function deliver(mail: Parameters<typeof sendMail>[0]): Promise<void> {
  try {
    await sendMail(mail);
  } catch (error) {
    if (error instanceof MailUnavailable) throw refuse.unavailable(msg.mailUnavailable);
    throw error;
  }
}

export async function createUser(client: Queryable, name: string, email: string, password: string, confirmed: boolean): Promise<string> {
  const id = newId('usr');
  await client.query('INSERT INTO users (id, name, email, password_hash, confirmed) VALUES ($1, $2, $3, $4, $5)', [
    id, name, email, await hashPassword(password), confirmed,
  ]);
  return id;
}

export async function addMember(client: Queryable, workspaceId: string, userId: string, role: Role): Promise<void> {
  await client.query('INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [workspaceId, userId, role]);
}

export async function createWorkspace(client: Queryable, name: string, slug: string, id: string = newId('ws')): Promise<string> {
  await client.query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)', [id, name, slug]);
  return id;
}

export async function signUp(input: JsonObject): Promise<void> {
  const name = text(input.name).trim();
  const email = text(input.email).trim();
  const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (taken.rows.length > 0) throw refuse.conflict(msg.emailTaken);
  checkAccountFields({ name, email, password: input.password }, ['name', 'email', 'password']);
  try {
    await db.tx(async (client) => {
      const userId = await createUser(client, name, email, text(input.password), false);
      await addMember(client, await createWorkspace(client, `${name}'s workspace`, slugOf(name)), userId, 'owner');
      const token = newToken();
      await client.query('INSERT INTO confirm_tokens (token, user_id) VALUES ($1, $2)', [token, userId]);
      await deliver({
        to: email,
        subject: 'Confirm your Pinbyte Switchyard account',
        text: `Welcome to Pinbyte Switchyard, ${name}.\n\nConfirm your email to open your workspace:\n${config.publicUrl}/confirm/${token}\n`,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw refuse.conflict(msg.emailTaken);
    throw error;
  }
}

export async function confirmAccount(token: string): Promise<{ workspaceId: string; session: string }> {
  return db.tx(async (client) => {
    const { rows } = await client.query<{ user_id: string }>('DELETE FROM confirm_tokens WHERE token = $1 RETURNING user_id', [token]);
    const found = rows[0];
    if (found === undefined) throw refuse.notFound();
    await client.query('UPDATE users SET confirmed = true WHERE id = $1', [found.user_id]);
    return { workspaceId: (await firstWorkspaceId(client, found.user_id)) as string, session: await createSession(client, found.user_id) };
  });
}

export async function signIn(input: JsonObject): Promise<{ workspaceId: string; name: string; session: string }> {
  const user = await verifyLogin(text(input.email).trim(), text(input.password));
  if (user === null) throw refuse.wrongPassword();
  if (!user.confirmed) throw refuse.forbidden(msg.confirmFirst);
  return { workspaceId: (await firstWorkspaceId(db, user.id)) as string, name: user.name, session: await createSession(db, user.id) };
}

export async function inviteMember(workspaceId: string, inviter: { id: string; name: string }, input: JsonObject): Promise<JsonObject> {
  const email = text(input.email).trim();
  const role = input.role;
  const member = await db.query('SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND lower(u.email) = lower($2)', [workspaceId, email]);
  if (member.rows.length > 0) throw refuse.conflict(msg.alreadyMember);
  checkAccountFields({ email }, ['email']);
  if (role !== 'editor' && role !== 'viewer') throw refuse.invalid(msg.roleChoice);
  return db.tx(async (client) => {
    const workspace = await client.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    await client.query('DELETE FROM invites WHERE workspace_id = $1 AND lower(email) = lower($2)', [workspaceId, email]);
    const id = newId('iv');
    const token = newToken();
    await client.query('INSERT INTO invites (id, workspace_id, email, role, token, inviter_id) VALUES ($1, $2, $3, $4, $5, $6)', [id, workspaceId, email, role, token, inviter.id]);
    const place = workspace.rows[0]?.name ?? '';
    await deliver({
      to: email,
      subject: `${inviter.name} invited you to ${place} on Pinbyte Switchyard`,
      text: `${inviter.name} invited you to join ${place} as ${role}.\n\nAccept the invite:\n${config.publicUrl}/invite/${token}\n`,
    });
    return { invite_id: id, email, role };
  });
}

interface InviteRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: Role;
  has_account: boolean;
}

export async function findInvite(token: string): Promise<InviteRow> {
  const { rows } = await db.query<InviteRow>(
    `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role,
       EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(i.email)) AS has_account
     FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = $1`,
    [token],
  );
  const invite = rows[0];
  if (invite === undefined) throw refuse.notFound();
  return invite;
}

export async function acceptInvite(token: string, input: JsonObject): Promise<{ workspaceId: string; session: string }> {
  const invite = await findInvite(token);
  let userId: string;
  if (invite.has_account) {
    const user = await verifyLogin(invite.email, text(input.password));
    if (user === null) throw refuse.wrongPassword();
    userId = user.id;
  } else {
    checkAccountFields({ name: input.name, password: input.password }, ['name', 'password']);
  }
  return db.tx(async (client) => {
    const used = await client.query('DELETE FROM invites WHERE token = $1', [token]);
    if (used.rowCount === 0) throw refuse.notFound();
    userId = invite.has_account ? userId : await createUser(client, text(input.name).trim(), invite.email, text(input.password), true);
    await addMember(client, invite.workspace_id, userId, invite.role);
    return { workspaceId: invite.workspace_id, session: await createSession(client, userId) };
  });
}
