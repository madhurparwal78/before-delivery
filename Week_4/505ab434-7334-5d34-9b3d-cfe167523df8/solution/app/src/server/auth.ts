// Passwords (scrypt) and sessions (random tokens in PostgreSQL).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { pool, type Tx } from "./db.ts";
import type { Role } from "../shared/domain.ts";
import type { Principal } from "../shared/api.ts";

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  const expected = Buffer.from(key, "base64");
  return timingSafeEqual(await derive(password, Buffer.from(salt, "base64")), expected);
}

export const newToken = (): string => randomBytes(32).toString("base64url");

export async function startSession(tx: Tx, principalId: string): Promise<string> {
  const token = newToken();
  await tx.q("INSERT INTO sessions (token, principal_id) VALUES ($1, $2)", [token, principalId]);
  return token;
}

interface PrincipalRow {
  id: string;
  display_name: string;
  role: Role;
  organisation_id: string;
}

export const toPrincipal = (row: PrincipalRow): Principal => ({
  id: row.id,
  displayName: row.display_name,
  role: row.role,
  organisationId: row.organisation_id,
});

export async function principalForSession(token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  const { rows } = await pool.query<PrincipalRow>(
    `SELECT p.id, p.display_name, p.role, p.organisation_id FROM sessions s JOIN principals p ON p.id = s.principal_id
     WHERE s.token = $1`,
    [token],
  );
  return rows[0] ? toPrincipal(rows[0]) : null;
}
