// Reading request bodies.
import type { Queryable } from "../db.ts";
import type { FieldErrors } from "../errors.ts";
import { DRAFT_PREFIX } from "./store.ts";
import { isRecord } from "../json.ts";

export function bodyRecord(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {};
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

export function stringList(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().replace(/^@/u, "")).filter((item) => item !== "");
}

export function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

const TITLE_MAX = 255;

export function checkTitle(errors: FieldErrors, title: string): void {
  const bare = title.startsWith(DRAFT_PREFIX) ? title.slice(DRAFT_PREFIX.length) : title;
  if (bare.trim() === "") errors.add("title", "Title can't be blank.");
  else if (title.trim().length > TITLE_MAX) errors.add("title", "Title is too long (255 characters at most).");
}

/** Adds an error for each username that is not a person. */
export async function checkUsers(q: Queryable, errors: FieldErrors, field: string, names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  const known = new Set((await q.q<{ username: string }>("SELECT username FROM users WHERE username = ANY($1)", [names])).map((row) => row.username));
  for (const name of names) if (!known.has(name)) errors.add(field, `User @${name} doesn't exist.`);
}
