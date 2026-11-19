import type { Zone } from "../shared/protocol.js";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { one, query, type Db } from "./db.js";
import { notFound } from "./http.js";

export interface Person {
  id: string;
  worldId: string;
  email: string;
  displayName: string;
  timeZone: Zone;
  siteRole: "member" | "moderator";
  avatarId: string | null;
  hideAbove: string | null;
}

interface PersonRow {
  id: string;
  world_id: string;
  email: string;
  display_name: string;
  time_zone: Zone;
  site_role: "member" | "moderator";
  avatar_id: string | null;
  hide_above: string | null;
}

const PERSON_COLUMNS = "p.id, p.world_id, p.email, p.display_name, p.time_zone, p.site_role, p.avatar_id, p.hide_above";

const toPerson = (row: PersonRow): Person => ({
  id: row.id,
  worldId: row.world_id,
  email: row.email,
  displayName: row.display_name,
  timeZone: row.time_zone,
  siteRole: row.site_role,
  avatarId: row.avatar_id,
  hideAbove: row.hide_above,
});

export const newId = (): string => randomUUID();
export const newToken = (): string => randomBytes(24).toString("hex");
const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(`${salt.toString("hex")}:${key.toString("hex")}`))),
  );
}

export function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt = "", key = ""] = stored.split(":");
  return new Promise((resolve, reject) =>
    scrypt(password, Buffer.from(salt, "hex"), 32, (error, derived) =>
      error ? reject(error) : resolve(timingSafeEqual(derived, Buffer.from(key, "hex"))),
    ),
  );
}

export async function openLogin(personId: string): Promise<string> {
  const token = newToken();
  await query("INSERT INTO auth_tokens (token_hash, person_id) VALUES ($1, $2)", [digest(token), personId]);
  return token;
}

export const closeLogin = (token: string): Promise<unknown> => query("DELETE FROM auth_tokens WHERE token_hash = $1", [digest(token)]);

export async function personForLogin(token: string | undefined): Promise<Person | null> {
  if (!token) return null;
  const row = await one<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM auth_tokens t JOIN people p ON p.id = t.person_id
     WHERE t.token_hash = $1 AND p.confirmed AND NOT p.suspended`,
    [digest(token)],
  );
  return row ? toPerson(row) : null;
}

async function personById(id: string, worldId: string, db?: Db): Promise<Person | null> {
  const row = await one<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM people p WHERE p.id = $1 AND p.world_id = $2`, [id, worldId], db);
  return row ? toPerson(row) : null;
}

export async function requirePerson(id: string, worldId: string, db?: Db): Promise<Person> {
  const found = await personById(id, worldId, db);
  if (!found) throw notFound();
  return found;
}
