import type { NoteStatus } from '../../shared/types';

/**
 * The one definition of the inbox order and its cursor: newest createdAt first,
 * then id in descending byte order, bound to the filter it was issued for.
 */

export interface InboxCursor {
  status: NoteStatus;
  createdAt: string;
  id: string;
}

export function encodeInboxCursor(cursor: InboxCursor): string {
  const payload = `${cursor.status}\u0000${cursor.createdAt}\u0000${cursor.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeInboxCursor(raw: string): InboxCursor | null {
  let payload: string;
  try {
    payload = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = payload.split('\u0000');
  if (parts.length !== 3) return null;
  const [status, createdAt, id] = parts;
  if (status !== 'unprocessed' && status !== 'snoozed' && status !== 'processed') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u.test(createdAt)) return null;
  if (id === '') return null;
  return { status, createdAt, id };
}

/** SQL predicate selecting the notes strictly after a cursor position. */
export function inboxAfterCursorSql(atParam: number, idParam: number): string {
  return (
    `(notes.created_at < $${atParam}::timestamptz OR (notes.created_at = $${atParam}::timestamptz` +
    ` AND notes.id COLLATE "C" < $${idParam}::text COLLATE "C"))`
  );
}

export const INBOX_ORDER_SQL = 'ORDER BY notes.created_at DESC, notes.id COLLATE "C" DESC';
