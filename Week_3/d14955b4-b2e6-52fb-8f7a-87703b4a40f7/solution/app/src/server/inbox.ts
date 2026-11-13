import { THREAD_STATUSES } from '../shared/types.js';
import type { Role, InboxBody, InboxRow, RuleBody, ThreadStatus } from '../shared/types.js';
import { pool } from './db.js';
import { validation } from './http.js';
import { topicsAllowed } from './permissions.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const isThreadStatus = (value: string): value is ThreadStatus => (THREAD_STATUSES as readonly string[]).includes(value);

interface Cursor {
  status: ThreadStatus;
  q: string;
  at: string;
  id: string;
}

const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify([cursor.status, cursor.q, cursor.at, cursor.id])).toString('base64url');

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 4 || !parsed.every((part) => typeof part === 'string' && !part.includes('\u0000'))) return null;
    const [status, q, at, id] = parsed as [string, string, string, string];
    if (!isThreadStatus(status) || new Date(at).toISOString() !== at) return null;
    return { status, q, at, id };
  } catch {
    return null;
  }
}

interface InboxQuery {
  status: ThreadStatus;
  q: string;
  limit: number;
  cursor: Cursor | null;
}

export function parseInboxQuery(params: URLSearchParams): InboxQuery {
  const fields: Record<string, string> = {};
  const rawStatus = params.get('status') ?? 'waiting';
  if (!isThreadStatus(rawStatus)) fields.status = 'Choose waiting, answered or closed.';
  const status = isThreadStatus(rawStatus) ? rawStatus : 'waiting';
  const q = (params.get('q') ?? '').replaceAll('\u0000', '');
  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > MAX_LIMIT) fields.limit = 'Choose a page size from 1 to 100.';
  }
  let cursor: Cursor | null = null;
  const rawCursor = params.get('cursor');
  if (rawCursor !== null) {
    cursor = decodeCursor(rawCursor);
    if (!cursor || cursor.status !== status || cursor.q !== q) fields.cursor = 'Start the list again.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { status, q, limit, cursor };
}

const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

const VISIBLE = `
  select t.id, t.status, t.topic, t.player_id, t.waiting_since, t.last_player_message_at, p.name as player_name
    from threads t
    join players p on p.game_id = t.game_id and p.id = t.player_id
   where t.game_id = $1 and t.topic = any($2::text[])
     and ($3::text is null or (
          p.name ilike $3 or p.id ilike $3
          or exists (select 1 from messages m where m.game_id = t.game_id and m.player_id = t.player_id and m.kind = 'player' and m.body ilike $3)
          or (t.topic = any($4::text[]) and exists (
                select 1 from events e join messages m on m.id = e.message_id
                 where m.game_id = t.game_id and m.player_id = t.player_id and e.verdict = 'accepted' and e.type = 'purchase.receipt'
                   and (e.receipt_id ilike $3 or e.item ilike $3)))))`;

export async function inbox(viewer: { role: Role; rules: readonly RuleBody[] }, gameId: string, query: InboxQuery): Promise<InboxBody> {
  const readable = topicsAllowed(viewer, 'read');
  const searchable = topicsAllowed(viewer, 'receipts');
  const pattern = query.q === '' ? null : likePattern(query.q);
  const base = [gameId, readable, pattern, searchable];
  const counted = await pool.query<{ status: ThreadStatus; n: number }>(`with visible as (${VISIBLE}) select status, count(*)::int as n from visible group by status`, base);
  const counts: Record<ThreadStatus, number> = { waiting: 0, answered: 0, closed: 0 };
  for (const row of counted.rows) counts[row.status] = row.n;
  const ascending = query.status === 'waiting';
  const params: unknown[] = [...base, query.status];
  let after = '';
  if (query.cursor) {
    params.push(query.cursor.at, query.cursor.id);
    after = `and (last_player_message_at, id) ${ascending ? '>' : '<'} ($6::timestamptz, $7)`;
  }
  params.push(query.limit + 1);
  const direction = ascending ? 'asc' : 'desc';
  const { rows } = await pool.query<{
    id: string; status: ThreadStatus; topic: InboxRow['topic']; player_id: string; player_name: string; waiting_since: Date | null;
    last_player_message_at: Date; after_text: string;
  }>(
    `with visible as (${VISIBLE})
     select v.*, (select vd.line->>'after' from messages m join verdicts vd on vd.message_id = m.id and vd.stage = 'sanitiser'
                   where m.game_id = $1 and m.player_id = v.player_id and m.kind = 'player' order by m.created_at desc, m.seq desc limit 1) as after_text
       from visible v where status = $5 ${after}
      order by last_player_message_at ${direction}, id ${direction} limit $${params.length}`,
    params,
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    counts,
    threads: page.map((row) => ({
      id: row.id,
      status: row.status,
      topic: row.topic,
      player: { id: row.player_id, name: row.player_name },
      first_line: [...(row.after_text as string).trimStart().split('\n')[0] as string].slice(0, 120).join(''),
      last_player_message_at: row.last_player_message_at.toISOString(),
      waiting_since: row.waiting_since ? row.waiting_since.toISOString() : null,
    })),
    next_cursor: rows.length > query.limit && last ? encodeCursor({ status: query.status, q: query.q, at: last.last_player_message_at.toISOString(), id: last.id }) : null,
  };
}

