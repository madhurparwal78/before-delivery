import { randomBytes } from 'node:crypto';
import type { Role, User } from '../../shared/types';
import { query, queryOne } from '../db/pool';
import { passwordMatches } from '../db/seed';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  member_number: string | null;
  password_hash: string;
  kb_account_id: string | null;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    member_number: row.member_number,
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>('select * from users where lower(email) = lower($1)', [email]);
}

export async function findUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>('select * from users where id = $1', [id]);
}

export async function findUserByMemberNumber(memberNumber: string): Promise<UserRow | null> {
  return queryOne<UserRow>('select * from users where member_number = $1', [memberNumber]);
}

export async function listMembers(): Promise<UserRow[]> {
  return query<UserRow>("select * from users where role = 'member' order by sort, name");
}

export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const row = await findUserByEmail(email);
  if (!row || !passwordMatches(password, row.password_hash)) return null;
  return row;
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export async function userForSession(sessionId: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
}

export async function dropSession(sessionId: string): Promise<void> {
  await query('delete from sessions where id = $1', [sessionId]);
}

/** Remembers the Kill Bill account of a member, the first writer winning. */
export async function rememberAccountId(userId: string, accountId: string): Promise<void> {
  await query('update users set kb_account_id = $1 where id = $2 and kb_account_id is null', [
    accountId,
    userId,
  ]);
}
