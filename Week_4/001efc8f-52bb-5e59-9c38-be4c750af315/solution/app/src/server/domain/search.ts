import { pool, rows, one } from "../db.js";
import { FIELD, invalid } from "../errors.js";
import type { Viewer } from "../http.js";
import { encodeCursor, instantCursor, type PageParams } from "./cursor.js";

const Q_MIN = 2;
const Q_MAX = 200;
const Q_WORDS = 8;
const SNIPPET = 160;

// The query caps, checked in order on the trimmed query; returns the distinct lower-cased terms.
function searchTerms(raw: string | null): { query: string; terms: string[] } {
  const query = (raw ?? "").trim();
  if ([...query].length < Q_MIN) throw invalid({ q: FIELD.qShort });
  if ([...query].length > Q_MAX) throw invalid({ q: FIELD.qLong });
  const words = query.split(/\s+/);
  if (words.length > Q_WORDS) throw invalid({ q: FIELD.qWords });
  return { query, terms: [...new Set(words.map((w) => w.toLowerCase()))] };
}

// Literal matching: every distinct term is a case-insensitive substring (strpos, so % _ \ are
// ordinary characters), within channels the searcher currently belongs to.
const MATCHES = `
WITH mine AS (
  SELECT c.id, c.name FROM channels c JOIN memberships mb ON mb.channel_id = c.id AND mb.user_id = $1 WHERE c.workspace_id = $2
), hits AS (
  SELECT 'message'::text AS kind, m.id AS message_id, NULL::uuid AS attachment_id, m.channel_id, m.thread_root_id,
         m.author_id, left(m.text, ${SNIPPET}) AS snippet, m.sent_at, 1 AS rank, '' AS attachment_key
    FROM messages m
   WHERE m.channel_id IN (SELECT id FROM mine) AND m.deleted_at IS NULL
     AND (SELECT bool_and(strpos(lower(m.text), lower(t)) > 0) FROM unnest($3::text[]) AS t)
  UNION ALL
  SELECT 'photo', a.message_id, a.id, a.channel_id, m.thread_root_id, a.uploaded_by, left(a.filename, ${SNIPPET}), m.sent_at, 0, a.id::text
    FROM attachments a JOIN messages m ON m.id = a.message_id
   WHERE a.channel_id IN (SELECT id FROM mine) AND a.state = 'stored' AND m.deleted_at IS NULL
     AND (SELECT bool_and(strpos(lower(a.filename), lower(t)) > 0) FROM unnest($3::text[]) AS t)
)`;

type SearchJson = {
  query: string;
  total: number;
  results: {
    kind: "message" | "photo";
    message_id: string;
    attachment_id?: string;
    channel: { id: string; name: string };
    thread_root_id: string | null;
    author_name: string;
    snippet: string;
    sent_at: string;
  }[];
  next_cursor: string | null;
};

export async function search(viewer: Viewer, raw: string | null, page: PageParams): Promise<SearchJson> {
  const { query, terms } = searchTerms(raw);
  const cursor = instantCursor(page.before, 4);
  const params = [viewer.id, viewer.workspace.id, terms];
  const found = await rows<{
    kind: "message" | "photo"; message_id: string; attachment_id: string | null; channel_id: string; channel_name: string;
    thread_root_id: string | null; author_name: string; snippet: string; sent_at: Date; rank: number; attachment_key: string;
  }>(
    pool,
    `${MATCHES}
     SELECT h.*, c.name AS channel_name, u.name AS author_name FROM hits h
       JOIN channels c ON c.id = h.channel_id JOIN users u ON u.id = h.author_id
      ${cursor ? "WHERE (h.sent_at, h.message_id::text, h.rank, h.attachment_key) < ($4::timestamptz, $5, $6::int, $7)" : ""}
      ORDER BY h.sent_at DESC, h.message_id::text DESC, h.rank DESC, h.attachment_key DESC
      LIMIT $${cursor ? 8 : 4}`,
    cursor ? [...params, cursor[0], cursor[1], Number(cursor[2]), cursor[3], page.limit + 1] : [...params, page.limit + 1],
  );
  const total = await one<{ total: number }>(pool, `${MATCHES} SELECT count(*)::int AS total FROM hits`, params);
  const pageRows = found.slice(0, page.limit);
  const last = pageRows[pageRows.length - 1];
  return {
    query,
    total: total?.total ?? 0,
    results: pageRows.map((r) => ({
      kind: r.kind,
      message_id: r.message_id,
      ...(r.attachment_id ? { attachment_id: r.attachment_id } : {}),
      channel: { id: r.channel_id, name: r.channel_name },
      thread_root_id: r.thread_root_id,
      author_name: r.author_name,
      snippet: r.snippet,
      sent_at: r.sent_at.toISOString(),
    })),
    next_cursor: found.length > page.limit && last ? encodeCursor([last.sent_at.toISOString(), last.message_id, String(last.rank), last.attachment_key]) : null,
  };
}
