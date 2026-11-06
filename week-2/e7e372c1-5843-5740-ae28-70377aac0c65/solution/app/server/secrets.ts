import { randomBytes } from "node:crypto";
import { one, text, type Queryable } from "./db.ts";

/** Generated on first start and kept in Postgres, so every app copy sharing the database agrees. */
export async function secretValue(q: Queryable, name: string): Promise<string> {
  await q.query("INSERT INTO app_secrets (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING", [
    name,
    randomBytes(32).toString("hex"),
  ]);
  const row = await one(q, "SELECT value FROM app_secrets WHERE name = $1", [name]);
  if (!row) throw new Error("secret missing after insert");
  return text(row, "value");
}

export const SESSION_SECRET = "session-signing-key";
export const TICK_SECRET = "tick-key";
