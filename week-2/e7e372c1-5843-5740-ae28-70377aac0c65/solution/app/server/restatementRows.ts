import { eachRow, ROW_KEYS, type RowKey } from "../shared/domain.ts";

export type StoredRows = Record<RowKey, string | null>;

/** Reads the jsonb `rows` column; every row key is present, null when not yet entered. */
export function rowsOf(stored: unknown): StoredRows {
  const entries = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? new Map(Object.entries(stored)) : new Map<string, unknown>();
  return eachRow((key) => {
    const value = entries.get(key);
    return typeof value === "string" ? value : null;
  });
}

export function rowsJson(rows: StoredRows): string {
  return JSON.stringify(Object.fromEntries(ROW_KEYS.map((key) => [key, rows[key]])));
}
