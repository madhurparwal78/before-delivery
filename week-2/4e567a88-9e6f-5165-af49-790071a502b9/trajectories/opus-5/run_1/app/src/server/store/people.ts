import { randomBytes } from 'node:crypto';
import { Queryable, db } from '../db';
import { Member, Role } from '../types';

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  team_id: string | null;
}

function toMember(row: MemberRow): Member {
  return { id: row.id, name: row.name, email: row.email, role: row.role as Role, teamId: row.team_id };
}

export async function memberByApiKey(key: string): Promise<Member | null> {
  const { rows } = await db.query<MemberRow>(
    'SELECT id, name, email, role, team_id FROM members WHERE api_key = $1',
    [key],
  );
  return rows[0] ? toMember(rows[0]) : null;
}

export async function memberByCredentials(email: string, passcode: string): Promise<Member | null> {
  const { rows } = await db.query<MemberRow>(
    'SELECT id, name, email, role, team_id FROM members WHERE lower(email) = lower($1) AND passcode = $2',
    [email, passcode],
  );
  return rows[0] ? toMember(rows[0]) : null;
}

export async function memberById(id: string): Promise<Member | null> {
  const { rows } = await db.query<MemberRow>(
    'SELECT id, name, email, role, team_id FROM members WHERE id = $1',
    [id],
  );
  return rows[0] ? toMember(rows[0]) : null;
}

export async function membersByRoles(roles: readonly Role[]): Promise<Member[]> {
  const { rows } = await db.query<MemberRow>(
    'SELECT id, name, email, role, team_id FROM members WHERE role = ANY($1) ORDER BY id',
    [roles],
  );
  return rows.map(toMember);
}

export async function membersOfTeam(teamId: string): Promise<Member[]> {
  const { rows } = await db.query<MemberRow>(
    'SELECT id, name, email, role, team_id FROM members WHERE team_id = $1 ORDER BY id',
    [teamId],
  );
  return rows.map(toMember);
}

export interface Team {
  id: string;
  name: string;
  position: number;
  grantMicro: bigint;
}

export async function allTeams(): Promise<Team[]> {
  const { rows } = await db.query<{ id: string; name: string; position: number; grant_micro: string }>(
    'SELECT id, name, position, grant_micro FROM teams ORDER BY position',
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    grantMicro: BigInt(row.grant_micro),
  }));
}

export async function teamById(id: string): Promise<Team | null> {
  const teams = await allTeams();
  return teams.find((team) => team.id === id) ?? null;
}

export async function createSession(memberId: string): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await db.query('INSERT INTO sessions (id, member_id, created_at) VALUES ($1, $2, now())', [id, memberId]);
  return id;
}

export async function memberBySession(sessionId: string): Promise<Member | null> {
  const { rows } = await db.query<MemberRow>(
    `SELECT m.id, m.name, m.email, m.role, m.team_id
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.id = $1`,
    [sessionId],
  );
  return rows[0] ? toMember(rows[0]) : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function orgName(client: Queryable = db): Promise<string> {
  const { rows } = await client.query<{ name: string }>('SELECT name FROM org WHERE id = $1', ['org']);
  return rows[0]?.name ?? '';
}
