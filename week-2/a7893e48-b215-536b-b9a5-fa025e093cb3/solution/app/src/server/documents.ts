import { all, type Db } from "./db.js";
import { documentKey, objectReadable } from "./s3.js";

export type DocumentKind = "liability" | "food_handler";

export interface DocumentRow {
  id: string; renter_id: string; kind: DocumentKind; valid_from: string; expires_on: string;
  content_type: string; size_bytes: number; uploaded_at: Date; reminder_queued_at: Date | null;
}

export interface CheckedDocument extends DocumentRow { readable: boolean }

/** A renter's documents of one kind, each marked with whether its stored object can be read. */
export async function checkedDocuments(db: Db, renterId: string, kind: DocumentKind): Promise<CheckedDocument[]> {
  const rows = await all<DocumentRow>(db, "SELECT * FROM documents WHERE renter_id = $1 AND kind = $2", [renterId, kind]);
  const readable = await Promise.all(rows.map((row) => objectReadable(documentKey(row.renter_id, row.id))));
  return rows.map((row, index) => ({ ...row, readable: readable[index] ?? false }));
}

export type Coverage = { status: "current" | "expired" | "missing"; expires_on: string | null };

/**
 * A renter's status for one document kind on a local date (brief: Binder links): current when a
 * readable document covers the date (latest expiry wins), else expired when one ended before it,
 * else missing.
 */
export function coverage(documents: CheckedDocument[], date: string): Coverage {
  const covering = documents.filter((doc) => doc.readable && doc.valid_from <= date && date <= doc.expires_on);
  if (covering.length > 0) return { status: "current", expires_on: covering.map((doc) => doc.expires_on).sort().at(-1) ?? null };
  const lapsed = documents.filter((doc) => doc.expires_on < date);
  if (lapsed.length > 0) return { status: "expired", expires_on: lapsed.map((doc) => doc.expires_on).sort().at(-1) ?? null };
  return { status: "missing", expires_on: null };
}
