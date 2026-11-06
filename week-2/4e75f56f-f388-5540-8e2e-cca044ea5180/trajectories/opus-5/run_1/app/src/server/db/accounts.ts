import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { newId, randomToken } from './ids.js';
import { pool, type Queryable } from './pool.js';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 32;

export type Role = 'practitioner' | 'clinic' | 'director' | 'registrar' | 'frontdesk';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly clinicName: string | null;
}

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  clinic_name: string | null;
  password_hash: string;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    clinicName: row.clinic_name,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split('$');
  if (scheme !== 'scrypt' || saltPart === undefined || hashPart === undefined) return false;
  const expected = Buffer.from(hashPart, 'base64');
  const derived = (await scrypt(password, Buffer.from(saltPart, 'base64'), expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function findAccountByEmail(
  client: Queryable,
  email: string,
): Promise<(Account & { passwordHash: string }) | null> {
  const result = await client.query<AccountRow>(
    'select id, name, email, role, clinic_name, password_hash from accounts where email_lower = $1',
    [email.trim().toLowerCase()],
  );
  const row = result.rows[0];
  return row === undefined ? null : { ...toAccount(row), passwordHash: row.password_hash };
}

export interface NewAccount {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: Role;
  readonly clinicName: string | null;
}

export async function insertAccount(client: Queryable, input: NewAccount): Promise<Account | null> {
  const id = newId('acc');
  const passwordHash = await hashPassword(input.password);
  const result = await client.query<AccountRow>(
    `insert into accounts (id, name, email, email_lower, password_hash, role, clinic_name)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (email_lower) do nothing
     returning id, name, email, role, clinic_name, password_hash`,
    [
      id,
      input.name,
      input.email,
      input.email.trim().toLowerCase(),
      passwordHash,
      input.role,
      input.clinicName,
    ],
  );
  const row = result.rows[0];
  return row === undefined ? null : toAccount(row);
}

export async function createSession(accountId: string): Promise<string> {
  const token = randomToken();
  await pool.query('insert into sessions (token, account_id) values ($1, $2)', [token, accountId]);
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('delete from sessions where token = $1', [token]);
}

export async function accountForSession(token: string): Promise<Account | null> {
  const result = await pool.query<AccountRow>(
    `select a.id, a.name, a.email, a.role, a.clinic_name, a.password_hash
     from sessions s join accounts a on a.id = s.account_id
     where s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  return row === undefined ? null : toAccount(row);
}
