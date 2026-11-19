import { hashSecret, newId, newPersonKey } from '../domain/ids.js';
import type { Db } from './db.js';

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  killbill_account_id: string | null;
}

const COLUMNS = 'id, name, email, killbill_account_id';

export async function insertPerson(
  db: Db,
  name: string,
  email: string,
): Promise<{ person: PersonRow; key: string }> {
  const key = newPersonKey();
  const result = await db.query<PersonRow>(
    `insert into people (id, name, email, key_hash) values ($1, $2, $3, $4) returning ${COLUMNS}`,
    [newId('per'), name, email, hashSecret(key)],
  );
  return { person: result.rows[0] as PersonRow, key };
}

export async function insertSeedPerson(
  db: Db,
  id: string,
  name: string,
  email: string,
  key: string,
): Promise<void> {
  await db.query(
    'insert into people (id, name, email, key_hash) values ($1, $2, $3, $4) on conflict (id) do nothing',
    [id, name, email, hashSecret(key)],
  );
}

export async function findPersonByKey(db: Db, key: string): Promise<PersonRow | null> {
  const result = await db.query<PersonRow>(
    `select ${COLUMNS} from people where key_hash = $1`,
    [hashSecret(key)],
  );
  return result.rows[0] ?? null;
}

export async function findPersonByEmail(db: Db, email: string): Promise<PersonRow | null> {
  const result = await db.query<PersonRow>(
    `select ${COLUMNS} from people where lower(email) = lower($1) order by created_at limit 1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findPersonById(db: Db, id: string): Promise<PersonRow | null> {
  const result = await db.query<PersonRow>(`select ${COLUMNS} from people where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function setKillbillAccount(
  db: Db,
  personId: string,
  accountId: string,
): Promise<void> {
  await db.query('update people set killbill_account_id = $2 where id = $1', [personId, accountId]);
}
