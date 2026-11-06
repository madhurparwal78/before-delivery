// Small shared server helpers: ids, counters and request-body field readers.

import { randomBytes } from "node:crypto";
import { one, type Db } from "./db.js";

export function newId(): string {
  return randomBytes(12).toString("base64url");
}

/** The next value of a named counter, atomically across copies. */
export async function nextCounter(db: Db, name: string): Promise<number> {
  const row = await one<{ value: number }>(
    db,
    `INSERT INTO counters (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value`,
    [name],
  );
  return row?.value ?? 1;
}

export type Body = Record<string, unknown>;

/** A JSON body as an object; anything else reads as an empty object, so field rules answer it. */
export function asObject(value: unknown): Body {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Body) : {};
}

export function str(body: Body, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
