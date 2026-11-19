import type { PoolClient } from 'pg';
import { officeLocalFromIso, termIsOpen, type PersonRow, type Role } from './domain/visibility.js';

export type { PersonRow, Role };

export function mapPerson(row: Record<string, unknown>): PersonRow {
  return {
    id: String(row.id),
    full_name: String(row.full_name),
    email: String(row.email),
    handle: String(row.handle),
    role: row.role as Role,
    status: String(row.status),
    aliases: (row.aliases as string[]) ?? [],
    term_starts_on: row.term_starts_on ? String(row.term_starts_on).slice(0, 10) : null,
    term_ends_on: row.term_ends_on ? String(row.term_ends_on).slice(0, 10) : null,
    left_at: row.left_at ? new Date(row.left_at as string) : null,
    first_signed_in_at: row.first_signed_in_at ? new Date(row.first_signed_in_at as string) : null
  };
}

/** Person states, in the published precedence order: left, travelling, on_term, invited, active. */
export function personStatus(person: PersonRow, travellingNow: boolean, now: Date): string {
  if (person.status === 'left' || person.left_at !== null) return 'left';
  if (travellingNow) return 'travelling';
  if (person.role === 'outside_bookkeeper' && termIsOpen(person, now)) return 'on_term';
  if (person.first_signed_in_at === null) return 'invited';
  return 'active';
}

export async function loadScopes(client: PoolClient, personId: string): Promise<Set<string>> {
  const rows = await client.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [personId]);
  return new Set(rows.rows.map((row) => String(row.vault_id)));
}

