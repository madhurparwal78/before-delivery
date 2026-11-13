import { validation } from '../errors';
import { FIELD } from '../../shared/copy';
import type { ThreadStatus } from '../../shared/types';

/** The one place inbox ordering and cursors are decided. */

export interface InboxCursor {
  status: ThreadStatus;
  q: string;
  at: string;
  id: string;
}

export function sortDirection(status: ThreadStatus): 'ASC' | 'DESC' {
  return status === 'waiting' ? 'ASC' : 'DESC';
}

export function orderClause(status: ThreadStatus): string {
  const direction = sortDirection(status);
  return `ORDER BY t.last_player_message_at ${direction}, t.id ${direction}`;
}

/** Each page continues strictly after the last thread of the previous page. */
export function cursorClause(status: ThreadStatus, atParam: number, idParam: number): string {
  const comparison = sortDirection(status) === 'ASC' ? '>' : '<';
  return `AND (t.last_player_message_at, t.id) ${comparison} ($${atParam}::timestamptz, $${idParam}::text)`;
}

export function encodeCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, status: ThreadStatus, q: string): InboxCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw validation({ cursor: FIELD.cursor });
  }
  if (typeof parsed !== 'object' || parsed === null) throw validation({ cursor: FIELD.cursor });
  const candidate = parsed as Partial<InboxCursor>;
  if (
    typeof candidate.status !== 'string' ||
    typeof candidate.q !== 'string' ||
    typeof candidate.at !== 'string' ||
    typeof candidate.id !== 'string' ||
    candidate.status !== status ||
    candidate.q !== q
  ) {
    throw validation({ cursor: FIELD.cursor });
  }
  return { status, q, at: candidate.at, id: candidate.id };
}
