import { one, query } from '../db.js';
import { passwordMatches, randomId } from '../ids.js';
import type { Person } from '../../shared/types.js';

export interface PersonRow extends Person {
  password_hash: string;
  availability: string;
  is_owner: boolean;
}

export async function personByEmail(email: string): Promise<PersonRow | null> {
  return one<PersonRow>(
    `select id, name, email, handle, password_hash, availability, is_owner from people where lower(email) = lower($1)`,
    [email],
  );
}


export async function personBySession(sessionId: string): Promise<PersonRow | null> {
  return one<PersonRow>(
    `select p.id, p.name, p.email, p.handle, p.password_hash, p.availability, p.is_owner
     from sessions s join people p on p.id = s.person_id where s.id = $1`,
    [sessionId],
  );
}

export async function signIn(email: string, password: string): Promise<{ person: PersonRow; sessionId: string } | null> {
  const person = await personByEmail(email);
  if (person === null || !passwordMatches(password, person.password_hash)) return null;
  const sessionId = randomId('sess');
  await query(`insert into sessions (id, person_id) values ($1, $2)`, [sessionId, person.id]);
  return { person, sessionId };
}

export async function signOut(sessionId: string): Promise<void> {
  await query(`delete from sessions where id = $1`, [sessionId]);
}

export function publicPerson(person: PersonRow): Person {
  return { id: person.id, name: person.name, email: person.email, handle: person.handle };
}

export async function workspace(): Promise<{
  id: string;
  owner_id: string;
  opening_minutes: number;
  opening_month: string;
  carried_storage_bytes: number;
}> {
  const found = await one<{
    id: string;
    owner_id: string;
    opening_minutes: number;
    opening_month: string;
    carried_storage_bytes: number;
  }>(`select id, owner_id, opening_minutes, opening_month, carried_storage_bytes from workspace limit 1`);
  if (found === null) throw new Error('the workspace is not seeded');
  return found;
}

export async function peopleOnProject(projectId: string): Promise<{ person: PersonRow; role: string }[]> {
  const rows = await query<PersonRow & { role: string }>(
    `select p.id, p.name, p.email, p.handle, p.password_hash, p.availability, p.is_owner, m.role
     from members m join people p on p.id = m.person_id where m.project_id = $1
     order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, p.name`,
    [projectId],
  );
  return rows.map((row) => ({ person: row, role: row.is_owner ? 'owner' : row.role }));
}
