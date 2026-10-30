import type { Grower } from '../../shared/api-types';
import type { Role } from '../../shared/labels';
import { one, rows, text, type Queryable } from '../db';
import { newId } from '../domain/ids';
import type { Actor } from '../http/router';

interface UserRow {
  id: string;
  role: Role;
  personName: string;
  businessName: string;
  contactName: string;
  email: string;
  passwordHash: string;
}

function toUser(row: Record<string, unknown>): UserRow {
  return {
    id: text(row.id),
    role: text(row.role) as Role,
    personName: text(row.person_name),
    businessName: text(row.business_name),
    contactName: text(row.contact_name),
    email: text(row.email),
    passwordHash: text(row.password_hash),
  };
}

function toActor(row: Record<string, unknown>): Actor {
  const user = toUser(row);
  return {
    id: user.id,
    personName: user.personName,
    businessName: user.businessName,
    contactName: user.contactName,
    email: user.email,
    role: user.role,
  };
}

export async function findUserByEmail(
  client: Queryable,
  email: string,
): Promise<(Actor & { passwordHash: string }) | null> {
  const row = await one(client, 'select * from users where lower(email) = lower($1)', [email]);
  if (row === null) return null;
  return { ...toActor(row), passwordHash: text(row.password_hash) };
}

export async function actorForSession(client: Queryable, sessionId: string): Promise<Actor | null> {
  const row = await one(
    client,
    `select u.* from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
  return row === null ? null : toActor(row);
}

export async function createSession(client: Queryable, userId: string): Promise<string> {
  const id = newId('ses');
  await client.query('insert into sessions (id, user_id) values ($1,$2)', [id, userId]);
  return id;
}

export async function deleteSession(client: Queryable, sessionId: string): Promise<void> {
  await client.query('delete from sessions where id = $1', [sessionId]);
}

export async function listGrowers(client: Queryable): Promise<Grower[]> {
  const growerRows = await rows(
    client,
    `select id, business_name, contact_name, email from users where role = 'grower'
      order by business_name`,
  );
  return growerRows.map((row) => ({
    id: text(row.id),
    name: text(row.business_name),
    contact_name: text(row.contact_name),
    email: text(row.email),
  }));
}

export async function findGrower(client: Queryable, growerId: string): Promise<Actor | null> {
  const row = await one(client, `select * from users where id = $1 and role = 'grower'`, [growerId]);
  return row === null ? null : toActor(row);
}
