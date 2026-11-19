import { db, type Queryable } from '../db.js';
import { fetchPerson } from '../services/directory.js';
import type { Person, PersonKind, StaffRole } from '../../shared/types.js';

interface CacheRow {
  id: string;
  name: string;
  email: string;
  firm: string;
  kind: string;
  staff_role: string | null;
}

const asPerson = (row: CacheRow): Person => ({
  id: row.id,
  name: row.name,
  email: row.email,
  firm: row.firm,
  kind: row.kind === 'partner' ? 'partner' : 'staff',
  staffRole: (row.staff_role as StaffRole | null) ?? null,
});

/**
 * The directory is the system of record for people. This mirror keeps the name, firm and kind
 * of people the drive already knows, so sessions, access checks and grant changes keep working
 * while the directory is unreachable. Every directory answer refreshes it.
 */
export const rememberPerson = async (person: Person, tx: Queryable = db): Promise<void> => {
  await tx.query(
    `INSERT INTO directory_cache (id, name, email, firm, kind, staff_role, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, email = EXCLUDED.email, firm = EXCLUDED.firm,
       kind = EXCLUDED.kind, staff_role = EXCLUDED.staff_role, updated_at = now()`,
    [person.id, person.name, person.email, person.firm, person.kind, person.staffRole],
  );
};

export const knownPerson = async (id: string, tx: Queryable = db): Promise<Person | null> => {
  const { rows } = await tx.query<CacheRow>('SELECT * FROM directory_cache WHERE id = $1', [id]);
  const row = rows[0];
  return row === undefined ? null : asPerson(row);
};

/** Looks the person up in the directory when it is reachable, otherwise in the mirror. */
export const lookupPerson = async (id: string): Promise<Person | null> => {
  const fresh = await fetchPerson(id);
  if (fresh === null) return null;
  await rememberPerson(fresh);
  return fresh;
};

export const kindFilter = (value: unknown): PersonKind | null =>
  value === 'staff' || value === 'partner' ? value : null;
