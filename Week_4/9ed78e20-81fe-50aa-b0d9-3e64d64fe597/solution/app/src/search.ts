import { pool, type DB } from "./db.js";
import { validation } from "./errors.js";
import { esc } from "./html.js";
import { codePoints, readableBody } from "./domain.js";
import type { Content, Requisition, SearchItem, SearchPage } from "./types.js";
const kinds = { model: "/models/", news: "/news/", role: "/careers/" } as const;
type Kind = keyof typeof kinds;
async function index(
  db: DB,
  kind: Kind,
  slug: string,
  fields: { title: string; summary: string; body: string },
  publishedAt: string,
): Promise<void> {
  await db.query(
    `INSERT INTO search_documents(kind,slug,title,summary,body,published_at,document)
     VALUES($1,$2,$3,$4,$5,$6,setweight(to_tsvector('english',$3),'A')||setweight(to_tsvector('english',$4),'B')||setweight(to_tsvector('english',$5),'C'))
     ON CONFLICT(kind,slug) DO UPDATE SET title=$3,summary=$4,body=$5,published_at=$6,document=EXCLUDED.document`,
    [kind, slug, fields.title, fields.summary, fields.body, publishedAt],
  );
}
export const indexContent = (db: DB, c: Content): Promise<void> =>
  index(
    db,
    c.kind,
    c.slug,
    { title: c.title, summary: c.summary, body: readableBody(c) },
    c.published_at!,
  );
export const indexRole = (db: DB, r: Requisition): Promise<void> =>
  index(
    db,
    "role",
    r.slug,
    { title: r.title, summary: "", body: r.description.replace(/^## /gm, "") },
    r.opened_at!,
  );
export async function unindex(db: DB, kind: Kind, slug: string): Promise<void> {
  await db.query("DELETE FROM search_documents WHERE kind=$1 AND slug=$2", [
    kind,
    slug,
  ]);
}
interface Cursor {
  q: string;
  k: string | null;
  r: string;
  p: string;
  s: string;
  t: string;
}
const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c)).toString("base64url");
function decodeCursor(value: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(value, "base64url").toString()) as Cursor;
    return [c.q, c.r, c.p, c.s, c.t].every((v) => typeof v === "string")
      ? c
      : null;
  } catch {
    return null;
  }
}
// Marks each word whose English stem the query matches, inside a 30-word passage.
async function highlights(
  rows: { summary: string; body: string }[],
  q: string,
): Promise<string[]> {
  const query = (
    await pool.query<{ tree: string }>(
      "SELECT querytree(websearch_to_tsquery('english',$1)) AS tree",
      [q],
    )
  ).rows[0].tree;
  const wanted = new Set(
    [...query.matchAll(/(!?)'((?:[^']|'')+)'/g)]
      .filter((m) => !m[1])
      .map((m) => m[2].replaceAll("''", "'")),
  );
  const split = (text: string): string[] => text.split(/\s+/).filter(Boolean);
  const words = [
    ...new Set(rows.flatMap((r) => [...split(r.summary), ...split(r.body)])),
  ];
  const stems = new Map<string, string[]>();
  if (words.length) {
    const lexed = await pool.query<{ word: string; lexemes: string[] }>(
      "SELECT word, tsvector_to_array(to_tsvector('english',word)) AS lexemes FROM unnest($1::text[]) AS word",
      [words],
    );
    for (const row of lexed.rows) stems.set(row.word, row.lexemes);
  }
  const matched = (word: string): boolean =>
    (stems.get(word) || []).some((l) => wanted.has(l));
  return rows.map((row) => {
    const fields = [split(row.summary), split(row.body)];
    const scored = fields.map((f) => f.filter(matched).length);
    const best = scored[1] > scored[0] ? 1 : 0;
    if (!scored[best])
      return (fields[0].length ? fields[0] : fields[1])
        .slice(0, 30)
        .map(esc)
        .join(" ");
    const field = fields[best];
    let start = 0,
      most = -1;
    for (let i = 0; i < Math.max(1, field.length - 29); i++) {
      const count = field.slice(i, i + 30).filter(matched).length;
      if (count > most) {
        most = count;
        start = i;
      }
    }
    return field
      .slice(start, start + 30)
      .map((w) => (matched(w) ? `<mark>${esc(w)}</mark>` : esc(w)))
      .join(" ");
  });
}
// Exclusions decide membership only; rank weighs the words a match must contain.
const rankedTerms = (q: string): string =>
  q.replace(/(^|\s)-("[^"]*"|\S+)/g, " ").trim() || q;
export async function searchData(query: URLSearchParams): Promise<SearchPage> {
  const q = (query.get("q") || "").trim();
  const kind = query.get("kind") || null;
  const limitText = query.get("limit");
  const fields: Record<string, string> = {};
  if (!q || codePoints(q) > 200)
    fields.q = "Enter between 1 and 200 characters.";
  const limit = limitText === null ? 10 : Number(limitText);
  if (!/^\d+$/.test(limitText ?? "10") || limit < 1 || limit > 50)
    fields.limit = "Choose a limit from 1 to 50.";
  const cursorText = query.get("cursor");
  const cursor = cursorText ? decodeCursor(cursorText) : null;
  if (cursorText && (!cursor || cursor.q !== q || cursor.k !== kind))
    fields.cursor = "This cursor does not belong to this search.";
  if (Object.keys(fields).length) validation(fields);
  if (kind !== null && !Object.hasOwn(kinds, kind))
    return { query: q, kind, items: [], next_cursor: null };
  const rows = (
    await pool.query<{
      kind: Kind;
      slug: string;
      title: string;
      summary: string;
      body: string;
      published_at: Date;
      rank: string;
    }>(
      `WITH matches AS (
         SELECT kind,slug,title,summary,body,published_at,ts_rank(document,websearch_to_tsquery('english',$8))::real AS rank
         FROM search_documents
         WHERE document @@ websearch_to_tsquery('english',$1) AND ($2::text IS NULL OR kind=$2))
       SELECT kind,slug,title,summary,body,published_at,rank::text AS rank FROM matches
       WHERE $3::real IS NULL OR rank<$3::real OR (rank=$3::real AND (published_at<$4::timestamptz
         OR (published_at=$4::timestamptz AND (slug>$5 OR (slug=$5 AND kind>$6)))))
       ORDER BY rank DESC,published_at DESC,slug,kind LIMIT $7`,
      [
        q,
        kind,
        cursor?.r ?? null,
        cursor?.p ?? null,
        cursor?.s ?? null,
        cursor?.t ?? null,
        limit + 1,
        rankedTerms(q),
      ],
    )
  ).rows;
  const page = rows.slice(0, limit);
  const marked = await highlights(page, q);
  const items: SearchItem[] = page.map((r, i) => ({
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    url: kinds[r.kind] + r.slug,
    published_at: r.published_at.toISOString(),
    rank: Number(r.rank),
    highlight: marked[i],
  }));
  const last = page[page.length - 1];
  return {
    query: q,
    kind,
    items,
    next_cursor:
      rows.length > limit
        ? encodeCursor({
            q,
            k: kind,
            r: last.rank,
            p: last.published_at.toISOString(),
            s: last.slug,
            t: last.kind,
          })
        : null,
  };
}
