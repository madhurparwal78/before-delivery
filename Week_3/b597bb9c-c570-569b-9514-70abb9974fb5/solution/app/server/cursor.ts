import { FIELD_ERRORS } from "../shared/copy";
import { PAGE_DEFAULT, PAGE_MAX } from "../shared/limits";
import { invalid } from "./errors";

type Key = string | number;

interface Cursor {
  sortValue: Key;
  id: Key;
  extra: Key;
}

/** Opaque keyset cursor over (sort value, extra, id): base64url of the position after the last item. */
export function encodeCursor(sortValue: Key, id: Key, extra: Key = ""): string {
  return Buffer.from(JSON.stringify([sortValue, extra, id])).toString("base64url");
}

/** The decoded position, null when no cursor was sent, or a 422 on `cursor` when it is malformed. */
export function decodeCursor(cursor: string | null): Cursor | null {
  if (cursor === null) return null;
  const bad = invalid({ cursor: FIELD_ERRORS.cursor });
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const isKey = (item: unknown): item is Key => typeof item === "string" || (typeof item === "number" && Number.isFinite(item));
    if (Array.isArray(value) && value.length === 3 && value.every(isKey)) return { sortValue: value[0] as Key, extra: value[1] as Key, id: value[2] as Key };
  } catch {
    throw bad;
  }
  throw bad;
}

/** A page size of 1 to 100 (default given), or a 422 on `limit`. */
export function pageLimit(raw: string | null, fallback: number = PAGE_DEFAULT): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > PAGE_MAX) throw invalid({ limit: FIELD_ERRORS.limit });
  return value;
}
