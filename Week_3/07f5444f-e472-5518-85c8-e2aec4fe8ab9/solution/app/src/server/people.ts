// People, sessions and the role table.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Chair, Role, User } from "../shared/api.js";
import { STRING_SECTIONS } from "./domain/copies.js";
import { SECTION_NAMES } from "../shared/api.js";
import { rows, type Db } from "./db.js";
import { forbidden, unauthenticated } from "./errors.js";
import type { Request } from "./http.js";

const SESSION_COOKIE = "qw_session";
const IDLE_LIMIT_SECONDS = 12 * 60 * 60;

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  chair_key: string | null;
  chair_number: number | null;
}

export interface Person extends User {
  /** The chair this person plays from, with the part chair key it reads (`vn2`, `fl1`). */
  seat: { key: string; number: number | null } | null;
}


export function chairOf(row: Pick<PersonRow, "chair_key" | "chair_number">, partName: string | null): Chair | null {
  if (row.chair_key === null) return null;
  const section = STRING_SECTIONS[row.chair_key];
  if (section !== undefined && row.chair_number !== null) {
    const name = SECTION_NAMES[section];
    return { key: row.chair_key, section: name, number: row.chair_number, label: `${name} · chair ${String(row.chair_number).padStart(2, "0")}` };
  }
  const name = partName ?? row.chair_key;
  return { key: row.chair_key, section: name, number: null, label: name };
}

export function personOf(row: PersonRow & { part_name: string | null }): Person {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    chair: chairOf(row, row.part_name),
    seat: row.chair_key === null ? null : { key: row.chair_key, number: row.chair_number },
  };
}

export const PERSON_SELECT = `
  SELECT p.id, p.name, p.email, p.role, p.chair_key, p.chair_number, p.passcode_hash,
         (SELECT cp.name FROM catalogue_parts cp WHERE cp.chair_key = p.chair_key LIMIT 1) AS part_name
  FROM people p`;

export function userOf(person: Person): User {
  return { id: person.id, name: person.name, email: person.email, role: person.role, chair: person.chair };
}

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(passcode, salt, 32).toString("hex")}`;
}

export function passcodeMatches(passcode: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(passcode, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function startSession(db: Db, personId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, person_id, last_seen_at) VALUES ($1, $2, now())", [tokenHash(token), personId]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${IDLE_LIMIT_SECONDS}`;
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function sessionToken(request: Request): string | null {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

/** The signed-in person, read from the database on every request (401 otherwise). */
export async function authenticate(db: Db, request: Request): Promise<Person> {
  const token = sessionToken(request);
  if (!token) throw unauthenticated();
  const [row] = await rows<PersonRow & { part_name: string | null }>(
    db,
    `WITH touched AS (
       UPDATE sessions SET last_seen_at = now()
       WHERE token_hash = $1 AND last_seen_at > now() - make_interval(secs => $2)
       RETURNING person_id)
     ${PERSON_SELECT} JOIN touched t ON t.person_id = p.id`,
    [tokenHash(token), IDLE_LIMIT_SECONDS],
  );
  if (!row) throw unauthenticated();
  return personOf(row);
}

export async function endSession(db: Db, request: Request): Promise<void> {
  const token = sessionToken(request);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

/** Role letters as the brief's role table writes them. */
const ROLE_LETTER: Record<Role, "P" | "A" | "S" | "Y"> = {
  principal_librarian: "P",
  assistant_librarian: "A",
  section_principal: "S",
  player: "Y",
};

/** Step 4 of the error order: 403 unless the person's role is one of `letters`. */
export function requireRole(person: Person, letters: string): void {
  if (!letters.includes(ROLE_LETTER[person.role])) throw forbidden();
}

export function hasRole(person: Person, letters: string): boolean {
  return letters.includes(ROLE_LETTER[person.role]);
}

/** A section principal acts for the part of their own section. */
export function ownSectionPart(person: Person, partChairKey: string): boolean {
  return person.role === "section_principal" && person.seat?.key === partChairKey;
}
