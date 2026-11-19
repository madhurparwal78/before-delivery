import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NewPerson, Person } from "../shared/api.js";
import { one, pool, type Db } from "./db.js";
import { fail, invalid, route, type Req } from "./http.js";

// People and their Dotgain keys (DP-01). Only a hash of each key is stored; the key itself is returned once.

export interface PersonRow extends Person {
  kb_account_id: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 20);
}

export function personFields(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = body.name;
  if (typeof name !== "string" || name.trim().length < 1 || [...name].length > 80) errors.name = "Enter your name.";
  const email = body.email;
  if (typeof email !== "string" || email.length > 254 || !EMAIL.test(email)) errors.email = "Enter an email address.";
  return errors;
}

export async function insertPerson(db: Db, name: string, email: string, key = `dgk_${randomBytes(24).toString("base64url")}`, id = newId()): Promise<NewPerson> {
  await db.query("INSERT INTO people (id, name, email, key_hash, created_at) VALUES ($1, $2, $3, $4, $5)", [
    id, name, email, hashKey(key), new Date(),
  ]);
  return { id, name, email, key };
}

/** The bearer's person, or null without a usable key. */
export async function bearer(req: Req): Promise<PersonRow | null> {
  const match = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
  if (!match) return null;
  return (await one<PersonRow>(pool, "SELECT id, name, email, kb_account_id FROM people WHERE key_hash = $1", [hashKey(match[1])])) ?? null;
}

export async function requirePerson(req: Req): Promise<PersonRow> {
  return (await bearer(req)) ?? fail(401, "unauthenticated");
}

route("POST", "/api/people", async (req) => {
  const errors = personFields(req.json);
  if (Object.keys(errors).length) invalid(errors);
  const made = await insertPerson(pool, String(req.json.name), String(req.json.email));
  return { status: 201, json: made };
});

route("GET", "/api/me", async (req) => {
  const me = await requirePerson(req);
  return { status: 200, json: { id: me.id, name: me.name, email: me.email } };
});
