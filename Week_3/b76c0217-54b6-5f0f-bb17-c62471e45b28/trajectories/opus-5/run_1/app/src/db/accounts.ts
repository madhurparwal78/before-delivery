import { newId, newToken } from './ids';
import { db, type Queryable } from './pool';

export type Role = 'owner' | 'editor' | 'viewer';
export type InviteStatus = 'held' | 'sent' | 'accepted' | 'expired';

export interface User {
  id: string;
  teamId: string;
  email: string;
  name: string;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
}

export interface Invite {
  id: string;
  teamId: string;
  invitedBy: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  status: InviteStatus;
  token: string;
  createdAt: Date;
  sentAt: Date | null;
  expiresAt: Date;
}

interface UserRow {
  id: string;
  team_id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
}

interface InviteRow {
  id: string;
  team_id: string;
  invited_by: string;
  email: string;
  role: 'editor' | 'viewer';
  status: InviteStatus;
  token: string;
  created_at: Date;
  sent_at: Date | null;
  expires_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  teamId: row.team_id,
  email: row.email,
  name: row.name,
  role: row.role,
});

const toInvite = (row: InviteRow): Invite => ({
  id: row.id,
  teamId: row.team_id,
  invitedBy: row.invited_by,
  email: row.email,
  role: row.role,
  status: row.status,
  token: row.token,
  createdAt: row.created_at,
  sentAt: row.sent_at,
  expiresAt: row.expires_at,
});

export async function createTeam(q: Queryable, name: string): Promise<Team> {
  const id = newId('team');
  await q.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [id, name]);
  return { id, name };
}

export async function teamById(id: string): Promise<Team | null> {
  const { rows } = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM teams WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function countTeams(): Promise<number> {
  const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM teams');
  return Number(rows[0].count);
}

export async function createUser(
  q: Queryable,
  input: { teamId: string; email: string; name: string; passwordHash: string; role: Role },
): Promise<User> {
  const id = newId('user');
  await q.query(
    `INSERT INTO users (id, team_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.teamId, input.email, input.name, input.passwordHash, input.role],
  );
  return { id, teamId: input.teamId, email: input.email, name: input.name, role: input.role };
}

export async function findUserByEmail(
  email: string,
): Promise<{ user: User; passwordHash: string } | null> {
  const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  const row = rows[0];
  return row === undefined ? null : { user: toUser(row), passwordHash: row.password_hash };
}

export async function userById(id: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toUser(rows[0]);
}

export async function teamMembers(teamId: string): Promise<User[]> {
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM users WHERE team_id = $1
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name`,
    [teamId],
  );
  return rows.map(toUser);
}

export async function setMemberRole(userId: string, role: Role): Promise<void> {
  await db.query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
}

export async function createSession(userId: string): Promise<string> {
  const id = newId('session');
  await db.query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  return id;
}

export async function sessionUser(sessionId: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = $1`,
    [sessionId],
  );
  return rows[0] === undefined ? null : toUser(rows[0]);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function createInvite(input: {
  teamId: string;
  invitedBy: string;
  email: string;
  role: 'editor' | 'viewer';
  status: InviteStatus;
  ttlMs: number;
}): Promise<Invite> {
  const id = newId('invite');
  const token = newToken();
  const { rows } = await db.query<InviteRow>(
    `INSERT INTO invites (id, team_id, invited_by, email, role, status, token, expires_at, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' milliseconds')::interval,
             CASE WHEN $6 = 'sent' THEN now() ELSE NULL END)
     RETURNING *`,
    [id, input.teamId, input.invitedBy, input.email, input.role, input.status, token, String(input.ttlMs)],
  );
  return toInvite(rows[0]);
}

export async function listInvites(teamId: string): Promise<Invite[]> {
  const { rows } = await db.query<InviteRow>(
    'SELECT * FROM invites WHERE team_id = $1 ORDER BY created_at',
    [teamId],
  );
  return rows.map(toInvite);
}

export async function inviteById(id: string): Promise<Invite | null> {
  const { rows } = await db.query<InviteRow>('SELECT * FROM invites WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toInvite(rows[0]);
}

export async function inviteByToken(token: string): Promise<Invite | null> {
  const { rows } = await db.query<InviteRow>('SELECT * FROM invites WHERE token = $1', [token]);
  return rows[0] === undefined ? null : toInvite(rows[0]);
}

export async function pendingInvite(teamId: string, email: string): Promise<Invite | null> {
  const { rows } = await db.query<InviteRow>(
    `SELECT * FROM invites
     WHERE team_id = $1 AND email = $2 AND status IN ('held', 'sent') AND expires_at > now()`,
    [teamId, email],
  );
  return rows[0] === undefined ? null : toInvite(rows[0]);
}

export async function markInviteSent(id: string): Promise<Invite> {
  const { rows } = await db.query<InviteRow>(
    `UPDATE invites SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return toInvite(rows[0]);
}

export async function markInviteAccepted(q: Queryable, id: string): Promise<void> {
  await q.query(`UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1`, [id]);
}

export async function heldInvites(): Promise<Invite[]> {
  const { rows } = await db.query<InviteRow>(
    `SELECT * FROM invites WHERE status = 'held' AND expires_at > now() ORDER BY created_at`,
  );
  return rows.map(toInvite);
}
