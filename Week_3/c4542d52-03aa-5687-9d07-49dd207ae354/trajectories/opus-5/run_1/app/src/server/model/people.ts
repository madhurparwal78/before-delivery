import type { Access, Person, Role } from "../../shared/types.js";
import type { Transaction } from "../db.js";

export interface PersonRow {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: Role;
  access: Access;
  password_hash: string | null;
  terminated_at: Date | null;
  termination_date: string | null;
  window_ends_at: Date | null;
  warnings_at: Date[];
  warnings_sent: number;
  window_closed: boolean;
}

export const PERSON_COLUMNS = `id, name, first_name, email, role, access, password_hash,
  terminated_at, termination_date, window_ends_at, warnings_at, warnings_sent, window_closed`;

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    first_name: row.first_name,
    email: row.email,
    role: row.role,
    access: row.access,
    departure:
      row.terminated_at === null || row.termination_date === null || row.window_ends_at === null
        ? null
        : {
            terminated_at: row.terminated_at.toISOString(),
            termination_date: row.termination_date,
            window_ends_at: row.window_ends_at.toISOString(),
            warnings_at: row.warnings_at.map((at) => at.toISOString()),
          },
  };
}

export async function loadPerson(tx: Transaction, id: string): Promise<PersonRow | null> {
  return tx.queryOne<PersonRow>(`select ${PERSON_COLUMNS} from people where id = $1`, [id]);
}

export async function loadPeople(tx: Transaction): Promise<PersonRow[]> {
  return tx.query<PersonRow>(`select ${PERSON_COLUMNS} from people order by seq`);
}

export async function boardSize(tx: Transaction): Promise<number> {
  const row = await tx.queryOne<{ count: number }>(
    "select count(*)::int as count from people where role = 'board_member' and access <> 'removed'",
  );
  return row === null ? 0 : row.count;
}

export function quorumFor(members: number): number {
  return Math.floor(members / 2) + 1;
}
