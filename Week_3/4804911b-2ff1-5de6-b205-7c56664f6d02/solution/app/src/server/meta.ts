import { db } from "./db.js";

let copy: string | null = null;

/** The copy's random id, written once at first seed. */
export async function copyId(): Promise<string> {
  if (copy) return copy;
  const r = await db.query("SELECT value FROM meta WHERE key = 'copy_id'");
  copy = r.rows[0]!.value as string;
  return copy;
}

export async function metaNumber(key: string): Promise<number> {
  return Number((await db.query("SELECT value FROM meta WHERE key = $1", [key])).rows[0]?.value ?? 0);
}
