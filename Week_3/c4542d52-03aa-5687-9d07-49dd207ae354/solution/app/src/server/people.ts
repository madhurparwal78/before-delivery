import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Person, Role } from "../shared/types.js";
import { isUniqueViolation, nextId, only, query, transaction, type Queryable } from "./db.js";
import { ApiError, conflict, notFound, validation } from "./errors.js";
import { leaverWarnings } from "./deadlines.js";
import { iso } from "./time.js";

export type PersonRow = {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: Role;
  access: "active" | "removed" | "none";
  password_hash: string | null;
  terminated_at: Date | null;
  termination_date: string | null;
  window_ends_at: Date | null;
  warnings_sent: number;
};

export function presentPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    first_name: row.first_name,
    email: row.email,
    role: row.role,
    access: row.access,
    departure:
      row.terminated_at && row.termination_date && row.window_ends_at
        ? {
            terminated_at: iso(row.terminated_at),
            termination_date: row.termination_date,
            window_ends_at: iso(row.window_ends_at),
            warnings_at: leaverWarnings(row.terminated_at, row.window_ends_at).map(iso),
          }
        : null,
  };
}

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", hash = ""] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function signIn(email: unknown, password: unknown): Promise<{ person: Person; token: string }> {
  const invalidCredentials = new ApiError(401, "invalid_credentials", "That email and password don't match a Tidecraft register account.");
  if (typeof email !== "string" || typeof password !== "string") throw invalidCredentials;
  const [row] = await query<PersonRow>("SELECT * FROM people WHERE lower(email) = lower($1)", [email.trim()]);
  if (!row || row.password_hash === null) throw invalidCredentials;
  const matches = await passwordMatches(password, row.password_hash);
  if (!matches) throw invalidCredentials;
  if (row.access === "removed") throw new ApiError(401, "access_removed", "Your access to the Tidecraft register has ended.");
  if (row.access !== "active") throw invalidCredentials;
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token_hash, person_id) VALUES ($1, $2)", [tokenHash(token), row.id]);
  return { person: presentPerson(row), token };
}

export async function personForToken(token: string): Promise<Person | null> {
  const [row] = await query<PersonRow>(
    `SELECT p.* FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token_hash = $1 AND p.access = 'active'`,
    [tokenHash(token)],
  );
  return row ? presentPerson(row) : null;
}

export async function endSession(token: string): Promise<void> {
  await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function personRow(db: Queryable, id: string): Promise<PersonRow> {
  const [row] = await db.query<PersonRow>("SELECT * FROM people WHERE id = $1", [id]);
  if (!row) throw notFound();
  return row;
}

export async function listPeople(): Promise<Person[]> {
  const rows = await query<PersonRow>("SELECT * FROM people ORDER BY id");
  return rows.map(presentPerson);
}

const ASSIGNABLE: Role[] = ["option_holder", "investor", "board_member"];
const isAssignable = (value: unknown): value is Role => typeof value === "string" && (ASSIGNABLE as string[]).includes(value);

export async function addPerson(body: Record<string, unknown>): Promise<Person> {
  const fields: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = body.password;
  if (name.length < 1 || name.length > 120) fields.name = "Enter a name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = "Enter an email address.";
  if (!isAssignable(body.role)) fields.role = "Choose a role.";
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    fields.password = "Enter a password of 12 to 128 characters.";
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  const passwordHash = await hashPassword(String(password));
  const emailTaken = validation({ email: "That email is already on the register." });
  return transaction(async (tx) => {
    const id = await nextId(tx, "person_number", "PER-", 3);
    const rows = await tx.query<PersonRow>(
      `INSERT INTO people (id, name, first_name, email, role, access, password_hash)
       VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING *`,
      [id, name, name.split(/\s+/)[0], email, body.role, passwordHash],
    );
    tx.emit({ to: null, type: "changed", data: { topics: ["people"] } });
    return presentPerson(only(rows));
  }).catch((error: unknown) => {
    throw isUniqueViolation(error) ? emailTaken : error;
  });
}

export async function changeRole(actor: Person, id: string, role: unknown): Promise<Person> {
  return transaction(async (tx) => {
    const target = await tx.query<PersonRow>("SELECT * FROM people WHERE id = $1 FOR UPDATE", [id]);
    if (!target[0]) throw notFound();
    if (id === actor.id) throw conflict("own_role", "You can't change your own role.");
    if (target[0].role === "leaver") throw conflict("person_is_leaver", "A leaver's role can't be changed.");
    if (!isAssignable(role)) throw validation({ role: "Choose a role." });
    const rows = await tx.query<PersonRow>("UPDATE people SET role = $2 WHERE id = $1 RETURNING *", [id, role]);
    tx.emit({ to: id, type: "role.changed", data: { role } });
    tx.emit({ to: null, type: "changed", data: { topics: ["people", "board", "grants", "registry"] } });
    return presentPerson(only(rows));
  });
}

export async function removeAccess(actor: Person, id: string): Promise<Person> {
  return transaction(async (tx) => {
    const target = await tx.query<PersonRow>("SELECT * FROM people WHERE id = $1 FOR UPDATE", [id]);
    if (!target[0]) throw notFound();
    if (id === actor.id) throw conflict("own_role", "You can't remove your own access.");
    if (target[0].access === "removed") throw conflict("access_already_removed", "Access was already removed for this person.");
    const rows = await tx.query<PersonRow>("UPDATE people SET access = 'removed' WHERE id = $1 RETURNING *", [id]);
    await tx.query("DELETE FROM sessions WHERE person_id = $1", [id]);
    tx.emit({ to: id, type: "access.removed", data: {} });
    tx.emit({ to: null, type: "changed", data: { topics: ["people", "board"] } });
    return presentPerson(only(rows));
  });
}
