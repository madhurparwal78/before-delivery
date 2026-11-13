// The one inbox ordering and cursor decision.
import { query } from './db';
import { TOPICS, decide, type Action, type StoredRule, type ThreadStatus, type Topic } from './domain';

export interface InboxRow {
  id: string;
  status: ThreadStatus;
  topic: Topic;
  player_id: string;
  player_name: string;
  first_line: string;
  last_player_message_at: Date;
  waiting_since: Date | null;
}

export interface CursorState {
  status: ThreadStatus;
  q: string;
  position: string;
}

export interface InboxFilter {
  gameId: string;
  status: ThreadStatus;
  q: string;
  developer: boolean;
  rules: StoredRule[];
  countOnly: boolean;
  limit?: number;
  cursor?: CursorState | null;
}

export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, status: ThreadStatus, q: string): CursorState | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<CursorState>;
    if (typeof parsed.position !== 'string') return null;
    if (parsed.status !== status || parsed.q !== q) return null;
    return { status, q, position: parsed.position };
  } catch {
    return null;
  }
}

const SORT_KEY = 'COALESCE(t.last_player_message_at, \'infinity\')';

const ORDER: Record<ThreadStatus, string> = {
  waiting: `${SORT_KEY} ASC, t.id ASC`,
  answered: `${SORT_KEY} DESC, t.id DESC`,
  closed: `${SORT_KEY} DESC, t.id DESC`,
};

export async function inboxQuery(filter: InboxFilter): Promise<{ rows: InboxRow[]; total: number; nextCursor: string | null }> {
  const params: unknown[] = [filter.gameId, filter.status];
  let where = '';
  if (!filter.developer) {
    const readable = TOPICS.filter((topic) => decide(filter.rules, 'read', topic).allowed);
    if (readable.length === 0) return { rows: [], total: 0, nextCursor: null };
    params.push(readable);
    where += ` AND t.topic = ANY($${params.length})`;
  }
  const search = filter.q.trim().toLowerCase();
  if (search !== '') {
    params.push(`%${search}%`);
    const like = `$${params.length}`;
    let receiptsBranch = '';
    if (filter.developer) {
      receiptsBranch = `
      OR EXISTS (
        SELECT 1 FROM purchases pu
         WHERE pu.game_id = t.game_id
           AND (LOWER(pu.receipt_id) LIKE ${like} OR LOWER(pu.item) LIKE ${like})
           AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.kind = 'event' AND m.event_receipt_id = pu.receipt_id)
      )`;
    }
    where += ` AND (
      EXISTS (SELECT 1 FROM players p WHERE p.id = t.player_id AND p.game_id = t.game_id AND (LOWER(p.name) LIKE ${like} OR LOWER(p.id) LIKE ${like}))
      OR EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.kind = 'player' AND LOWER(COALESCE(m.body, '')) LIKE ${like})${receiptsBranch}
    )`;
  }
  const countSql = `SELECT count(*)::int AS total FROM threads t WHERE t.game_id = $1 AND t.status = $2${where}`;
  const countResult = await query<{ total: number }>(countSql, params as never[]);
  const total = countResult.rows[0].total;
  if (filter.countOnly) return { rows: [], total, nextCursor: null };

  const pageParams = [...params];
  if (filter.cursor) {
    const [stamp, id] = filter.cursor.position.split('|');
    pageParams.push(stamp, id);
    const direction = filter.status === 'waiting' ? '>' : '<';
    where += ` AND (${SORT_KEY}, t.id) ${direction} ($${pageParams.length - 1}::timestamptz, $${pageParams.length})`;
  }
  const limit = filter.limit ?? 25;
  pageParams.push(limit + 1);
  const sql = `
    SELECT t.id, t.status, t.topic, t.player_id, t.waiting_since, t.last_player_message_at,
           to_char(t.last_player_message_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS last_player_stamp,
           (SELECT p.name FROM players p WHERE p.id = t.player_id AND p.game_id = t.game_id) AS player_name,
           LEFT(COALESCE((SELECT m.body FROM messages m WHERE m.thread_id = t.id AND m.kind = 'player' ORDER BY m.created_at DESC, m.id DESC LIMIT 1), ''), 120) AS first_line
      FROM threads t
     WHERE t.game_id = $1 AND t.status = $2${where}
     ORDER BY ${ORDER[filter.status]}
     LIMIT $${pageParams.length}`;
  const result = await query<InboxRow & { last_player_stamp: string | null }>(sql, pageParams as never[]);
  let nextCursor: string | null = null;
  const rows: InboxRow[] = result.rows.map(({ last_player_stamp, ...row }) => {
    void last_player_stamp;
    return row;
  });
  if (rows.length > limit) {
    rows.length = limit;
    const lastRaw = result.rows[limit - 1];
    const stamp = lastRaw.last_player_stamp === null ? 'infinity' : `${lastRaw.last_player_stamp}Z`;
    nextCursor = encodeCursor({ status: filter.status, q: filter.q, position: `${stamp}|${lastRaw.id}` });
  }
  return { rows, total, nextCursor };
}

export function actionAllowedOn(rules: StoredRule[], action: Action, topic: Topic): boolean {
  return decide(rules, action, topic).allowed;
}
