import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type PoolClient } from "pg";
import { query, queryOne } from "../db.js";
import { type Currency } from "../../shared/money.js";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export type Role = "client_owner" | "teammate" | "studio_owner" | "contractor";

export interface UserRow {
  id: string;
  accountId: string | null;
  name: string;
  email: string;
  role: Role;
}

export interface ClientAccountRow {
  id: string;
  businessName: string;
  currency: Currency | null;
  killbillAccountId: string | null;
  cardLast4: string | null;
}

interface UserRecord {
  id: string;
  account_id: string | null;
  name: string;
  email: string;
  role: string;
  password_hash: string;
}

interface AccountRecord {
  id: string;
  business_name: string;
  currency: string | null;
  killbill_account_id: string | null;
  card_last4: string | null;
}

function toUser(record: UserRecord): UserRow {
  return {
    id: record.id,
    accountId: record.account_id,
    name: record.name,
    email: record.email,
    role: record.role as Role,
  };
}

function toAccount(record: AccountRecord): ClientAccountRow {
  return {
    id: record.id,
    businessName: record.business_name,
    currency: record.currency as Currency | null,
    killbillAccountId: record.killbill_account_id,
    cardLast4: record.card_last4,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function userByEmail(email: string): Promise<(UserRow & { passwordHash: string }) | null> {
  const record = await queryOne<UserRecord>(
    `select id, account_id, name, email, role, password_hash from users where lower(email) = lower($1)`,
    [email],
  );
  return record ? { ...toUser(record), passwordHash: record.password_hash } : null;
}

export async function userById(id: string): Promise<UserRow | null> {
  const record = await queryOne<UserRecord>(
    `select id, account_id, name, email, role, password_hash from users where id = $1`,
    [id],
  );
  return record ? toUser(record) : null;
}

export async function accountById(id: string): Promise<ClientAccountRow | null> {
  const record = await queryOne<AccountRecord>(
    `select id, business_name, currency, killbill_account_id, card_last4 from client_accounts where id = $1`,
    [id],
  );
  return record ? toAccount(record) : null;
}

export async function ownerOfAccount(accountId: string): Promise<UserRow | null> {
  const record = await queryOne<UserRecord>(
    `select id, account_id, name, email, role, password_hash from users
      where account_id = $1 and role = 'client_owner' order by created_at asc limit 1`,
    [accountId],
  );
  return record ? toUser(record) : null;
}

export async function contractors(): Promise<UserRow[]> {
  const records = await query<UserRecord>(
    `select id, account_id, name, email, role, password_hash from users where role = 'contractor' order by name asc`,
  );
  return records.map(toUser);
}

export async function createClientAccount(
  client: PoolClient,
  input: { businessName: string; currency: Currency | null },
): Promise<string> {
  const id = randomUUID();
  await client.query(`insert into client_accounts (id, business_name, currency) values ($1, $2, $3)`, [
    id,
    input.businessName,
    input.currency,
  ]);
  return id;
}

export async function createUser(
  client: PoolClient,
  input: { accountId: string | null; name: string; email: string; password: string; role: Role },
): Promise<UserRow> {
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  await client.query(
    `insert into users (id, account_id, name, email, password_hash, role) values ($1, $2, $3, $4, $5, $6)`,
    [id, input.accountId, input.name, input.email, passwordHash, input.role],
  );
  return { id, accountId: input.accountId, name: input.name, email: input.email, role: input.role };
}

export async function emailTaken(email: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(`select id from users where lower(email) = lower($1)`, [email]);
  return row !== null;
}

export async function setAccountCurrency(accountId: string, currency: Currency): Promise<void> {
  await query(`update client_accounts set currency = $2 where id = $1 and currency is null`, [accountId, currency]);
}

export async function setAccountCard(accountId: string, last4: string): Promise<void> {
  await query(`update client_accounts set card_last4 = $2 where id = $1`, [accountId, last4]);
}

export async function setKillbillAccount(accountId: string, killbillAccountId: string): Promise<void> {
  await query(`update client_accounts set killbill_account_id = $2 where id = $1`, [accountId, killbillAccountId]);
}

export async function createSession(userId: string | null): Promise<string> {
  const id = randomUUID();
  await query(`insert into sessions (id, user_id) values ($1, $2)`, [id, userId]);
  return id;
}

export async function sessionUser(sessionId: string): Promise<UserRow | null> {
  const record = await queryOne<UserRecord>(
    `select u.id, u.account_id, u.name, u.email, u.role, u.password_hash
       from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
  return record ? toUser(record) : null;
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(`select id from sessions where id = $1`, [sessionId]);
  return row !== null;
}

export async function attachSessionUser(sessionId: string, userId: string): Promise<void> {
  await query(`update sessions set user_id = $2 where id = $1`, [sessionId, userId]);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query(`delete from sessions where id = $1`, [sessionId]);
}

export function serializeUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountId: user.accountId,
  };
}

export function homeRouteFor(role: Role): string {
  return role === "studio_owner" ? "/studio" : "/portal";
}
