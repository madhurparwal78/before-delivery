import { query } from './db.js';
import type { Person, Role } from '../shared/types.js';

export interface PersonRecord {
  id: string;
  displayName: string;
  email: string;
  colour: string;
  isConsultant: boolean;
  passwordHash: string;
}

const byId = new Map<string, PersonRecord>();
const byEmail = new Map<string, PersonRecord>();

export async function loadPeople(): Promise<void> {
  const result = await query<{
    id: string;
    display_name: string;
    email: string;
    colour: string;
    is_consultant: boolean;
    password_hash: string;
  }>('select id, display_name, email, colour, is_consultant, password_hash from people');
  byId.clear();
  byEmail.clear();
  for (const row of result.rows) {
    const record: PersonRecord = {
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      colour: row.colour,
      isConsultant: row.is_consultant,
      passwordHash: row.password_hash,
    };
    byId.set(record.id, record);
    byEmail.set(record.email.toLowerCase(), record);
  }
}

export function personById(id: string): PersonRecord {
  const record = byId.get(id);
  if (!record) throw new Error(`Unknown person ${id}`);
  return record;
}

export function personByEmail(email: string): PersonRecord | null {
  return byEmail.get(email.trim().toLowerCase()) ?? null;
}

/** The public person projection: never another person's email. */
export function personObject(id: string, role?: Role): Person {
  const record = personById(id);
  const person: Person = { personId: record.id, displayName: record.displayName, colour: record.colour };
  if (role) person.role = role;
  return person;
}
