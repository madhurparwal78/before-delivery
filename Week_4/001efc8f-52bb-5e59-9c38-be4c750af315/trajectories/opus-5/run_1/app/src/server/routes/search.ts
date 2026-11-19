import { query, queryOne } from '../db';
import { LIMITS } from '../config';
import { isoOf } from '../clock';
import { FieldErrors } from '../errors';
import { FIELD_COPY } from '../../shared/copy';
import { decodeCursor, encodeCursor } from '../domain/paging';
import { parsePageLimit } from '../domain/validate';
import type { Route } from '../http/router';
import { queryParam, requireUser, sendJson, type RequestContext } from '../http/context';
import type { SearchResult } from '../../shared/api';

/**
 * The one literal search matcher. Terms are plain substrings, so `%`, `_` and
 * `\` carry no special meaning, and a row matches when every distinct term
 * appears in its current text or its stored file name.
 */
export function searchTerms(raw: string, errors: FieldErrors): string[] {
  const trimmed = raw.trim();
  if ([...trimmed].length < LIMITS.searchQueryMin) {
    errors.add('q', FIELD_COPY.qTooShort);
    return [];
  }
  if ([...trimmed].length > LIMITS.searchQueryMax) {
    errors.add('q', FIELD_COPY.qTooLong);
    return [];
  }
  const words = trimmed.split(/\s+/).filter((word) => word.length > 0);
  if (words.length > LIMITS.searchTermsMax) {
    errors.add('q', FIELD_COPY.qTooManyWords);
    return [];
  }
  const distinct: string[] = [];
  for (const word of words) {
    const lowered = word.toLowerCase();
    if (!distinct.includes(lowered)) distinct.push(lowered);
  }
  return distinct;
}

interface SearchRow {
  message_id: string;
  attachment_id: string | null;
  kind_rank: number;
  sent_at: Date;
  channel_id: string;
  channel_name: string;
  thread_root_id: string | null;
  author_name: string;
  snippet: string;
}

function matchClause(column: string, terms: string[], firstParam: number): string {
  return terms.map((_, index) => `position($${firstParam + index} in lower(${column})) > 0`).join(' AND ');
}

async function search(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const errors = new FieldErrors();
  const raw = queryParam(ctx, 'q') ?? '';
  const terms = searchTerms(raw, errors);
  const limit = parsePageLimit(queryParam(ctx, 'limit'), errors);
  const cursor = decodeCursor(queryParam(ctx, 'before'), 4, errors);
  errors.throwIfAny();

  const params: unknown[] = [user.id, user.workspace_id, ...terms];
  const firstTermParam = 3;
  const base = `
    WITH readable AS (
      SELECT m.id, m.channel_id, m.text, m.sent_at, m.thread_root_id, m.author_id
      FROM messages m
      JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
      WHERE m.workspace_id = $2 AND m.deleted = false
    ),
    matches AS (
      SELECT r.id AS message_id, NULL::uuid AS attachment_id, 0 AS kind_rank, r.sent_at,
             r.channel_id, c.name AS channel_name, r.thread_root_id, author.name AS author_name,
             left(r.text, 160) AS snippet
      FROM readable r
      JOIN channels c ON c.id = r.channel_id
      JOIN users author ON author.id = r.author_id
      WHERE ${matchClause('r.text', terms, firstTermParam)}
      UNION ALL
      SELECT r.id AS message_id, a.id AS attachment_id, 1 AS kind_rank, r.sent_at,
             r.channel_id, c.name AS channel_name, r.thread_root_id, author.name AS author_name,
             left(a.filename, 160) AS snippet
      FROM attachments a
      JOIN readable r ON r.id = a.message_id
      JOIN channels c ON c.id = r.channel_id
      JOIN users author ON author.id = r.author_id
      WHERE ${matchClause('a.filename', terms, firstTermParam)}
    )`;

  const totalRow = await queryOne<{ total: number }>(`${base} SELECT count(*)::int AS total FROM matches`, params);

  let clause = '';
  if (cursor !== null) {
    const start = params.length + 1;
    clause = ` WHERE (sent_at, message_id::text, -kind_rank, coalesce(attachment_id::text, '')) <
      ($${start}::timestamptz, $${start + 1}::text, $${start + 2}::int, $${start + 3}::text)`;
    params.push(cursor[0], cursor[1], Number(cursor[2]), cursor[3]);
  }

  const rows = await query<SearchRow>(
    `${base}
     SELECT * FROM matches ${clause}
     ORDER BY sent_at DESC, message_id::text DESC, kind_rank ASC, attachment_id::text DESC
     LIMIT ${limit}`,
    params,
  );

  const results: SearchResult[] = rows.map((row) => {
    const result: SearchResult = {
      kind: row.attachment_id === null ? 'message' : 'photo',
      message_id: row.message_id,
      channel: { id: row.channel_id, name: row.channel_name },
      thread_root_id: row.thread_root_id,
      author_name: row.author_name,
      snippet: row.snippet,
      sent_at: isoOf(row.sent_at),
    };
    if (row.attachment_id !== null) result.attachment_id = row.attachment_id;
    return result;
  });

  const last = rows[rows.length - 1];
  sendJson(ctx, 200, {
    query: raw.trim(),
    total: totalRow?.total ?? 0,
    results,
    next_cursor:
      rows.length < limit || last === undefined
        ? null
        : encodeCursor([
            last.sent_at.toISOString(),
            last.message_id,
            String(-last.kind_rank),
            last.attachment_id ?? '',
          ]),
  });
}

export const searchRoutes: Route[] = [{ method: 'GET', pattern: '/api/search', handler: search }];
