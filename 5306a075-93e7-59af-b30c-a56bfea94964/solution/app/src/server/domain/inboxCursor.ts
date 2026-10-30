// Inbox order and cursor (brief: Business rules › Inbox pages), adapted from kit/modules/cursor.
// Order: createdAt newest first, then id descending in byte order. The cursor binds the last position to its status.
import type { NoteStatus } from "../../shared/lifecycles.js";

export interface InboxPosition { status: NoteStatus; createdAt: string; id: string }

export function encodeCursor(position: InboxPosition): string {
  return Buffer.from(JSON.stringify([position.status, position.createdAt, position.id])).toString("base64url");
}

/** The position after which the next page starts, or null when the cursor is malformed. */
export function decodeCursor(cursor: string): InboxPosition | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => typeof v === "string")) return null;
    const [status, createdAt, id] = value as [string, string, string];
    if (!["unprocessed", "snoozed", "processed"].includes(status) || Number.isNaN(Date.parse(createdAt))) return null;
    return { status: status as NoteStatus, createdAt, id };
  } catch {
    return null;
  }
}

/** SQL for the inbox order; `after` restricts to rows strictly after a position ($n = createdAt, $n+1 = id). */
export const INBOX_ORDER = "n.created_at DESC, n.id DESC";
export const afterPosition = (createdAtParam: number, idParam: number): string =>
  `(n.created_at, n.id) < ($${createdAtParam}::timestamptz, $${idParam}::text COLLATE "C")`;
