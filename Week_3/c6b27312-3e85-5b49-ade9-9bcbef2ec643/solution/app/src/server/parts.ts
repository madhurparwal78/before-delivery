// The gallery with signed keyset cursors, a part's page data, and likes.
import { etagOf } from "../shared/copy";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { GalleryJson, GalleryPart, PartJson } from "../shared/api";
import { buildManifest, type Vec3 } from "../shared/tine";
import { CATEGORIES } from "./categories";
import { config } from "./config";
import { db, transaction } from "./db";
import { invalid, notFound } from "./errors";
import { emit } from "./events";
import type { Ctx } from "./http";
import { get, put, del, type Route } from "./route";
import { allowanceUsed } from "./preflight";
import { headRevision, loadRevision, modelOf, readablePart, requirePart, revisionJson, revisionLabel, sourceText, type RevisionRow } from "./records";
import { jsonReply } from "./reply";

const PAGE_SIZE = 12;
const LAST_POSITION = 2147483647;
const CURSOR_ERROR = "Start again from the first page.";

let cursorSecret = Buffer.alloc(0);

/** The cursor signing key lives in the database so every app copy on it accepts the cursors the others issue. */
export async function loadCursorSecret(): Promise<void> {
  await db.run("INSERT INTO settings (key, value) VALUES ('cursor-secret', $1) ON CONFLICT DO NOTHING", [randomBytes(32).toString("hex")]);
  const row = await db.one<{ value: string }>("SELECT value FROM settings WHERE key = 'cursor-secret'");
  cursorSecret = Buffer.from(row.value, "hex");
}

type CursorKey = (string | number)[];

interface Cursor {
  category: string | null;
  sort: string;
  key: CursorKey;
}

function signature(body: string): Buffer {
  return createHmac("sha256", cursorSecret).update(body).digest();
}

function signCursor(cursor: Cursor): string {
  const body = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}

function readCursor(text: string): Cursor | null {
  const [body = "", mac = ""] = text.split(".");
  const given = Buffer.from(mac, "base64url");
  const expected = signature(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Cursor;
}

interface GalleryRow {
  slug: string;
  title: string;
  category: string;
  created_at: Date;
  created_key: string;
  featured_position: number;
  author_id: string;
  author_name: string;
  likes: number;
  liked: boolean;
  head_id: string;
  head_n: number;
  geometry_digest: string;
  volume: number;
  bbox: Vec3;
}

/**
 * Each sort: its order, how to continue after a cursor key (`p(i)` is the i-th key's placeholder) and the key a
 * row contributes. Texts compare in the database's "C" collation, which is code-point order.
 */
const SORTS: Record<string, { order: string; after: (p: (i: number) => string) => string; key: (row: GalleryRow) => CursorKey }> = {
  featured: {
    order: "featured_position, created_at, slug",
    after: (p) => `(featured_position, created_at, slug) > (${p(0)}, ${p(1)}::timestamptz, ${p(2)})`,
    key: (r) => [r.featured_position, r.created_key, r.slug],
  },
  liked: {
    order: "likes DESC, title, slug",
    after: (p) => `(likes < ${p(0)} OR (likes = ${p(0)} AND (title, slug) > (${p(1)}, ${p(2)})))`,
    key: (r) => [r.likes, r.title, r.slug],
  },
  newest: {
    order: "created_at DESC, slug",
    after: (p) => `(created_at < ${p(0)}::timestamptz OR (created_at = ${p(0)}::timestamptz AND slug > ${p(1)}))`,
    key: (r) => [r.created_key, r.slug],
  },
  name: {
    order: "title, slug",
    after: (p) => `(title, slug) > (${p(0)}, ${p(1)})`,
    key: (r) => [r.title, r.slug],
  },
};

const galleryPart = (row: GalleryRow): GalleryPart => ({
  slug: row.slug,
  title: row.title,
  category: row.category,
  author: { id: row.author_id, displayName: row.author_name },
  likes: row.likes,
  liked: row.liked,
  createdAt: row.created_at.toISOString(),
  head: { id: row.head_id, label: revisionLabel(row.head_n), geometryDigest: row.geometry_digest, volume: row.volume, bbox: row.bbox },
});

async function gallery(ctx: Ctx) {
  const user = await ctx.user();
  const query = ctx.url.searchParams;
  const category = query.get("category");
  const sort = query.get("sort") ?? "featured";
  const errors: Record<string, string> = {};
  if (category !== null && !CATEGORIES.some((c) => c.slug === category)) errors.category = "Choose a listed category.";
  if (!Object.hasOwn(SORTS, sort)) errors.sort = "Choose a listed sort.";
  const rawCursor = query.get("cursor");
  const cursor = rawCursor === null ? null : readCursor(rawCursor);
  if (rawCursor !== null && (cursor === null || cursor.category !== category || cursor.sort !== sort)) errors.cursor = CURSOR_ERROR;
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const order = SORTS[sort] as (typeof SORTS)[string];
  const values: unknown[] = [user?.id ?? null, category];
  const keyset = cursor ? `AND ${order.after((i) => `$${values.push(cursor.key[i])}`)}` : "";
  const rows = await db.rows<GalleryRow>(
    `SELECT * FROM (
       SELECT p.slug, p.title, p.category, p.created_at,
              to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_key,
              COALESCE(p.seed_position, ${LAST_POSITION}) AS featured_position,
              p.owner_id AS author_id, u.display_name AS author_name,
              (SELECT count(*)::int FROM likes l WHERE l.part_slug = p.slug) AS likes,
              EXISTS (SELECT 1 FROM likes l WHERE l.part_slug = p.slug AND l.user_id = $1) AS liked,
              h.id AS head_id, h.n AS head_n, h.geometry_digest, e.volume, e.bbox
         FROM parts p
         JOIN users u ON u.id = p.owner_id
         JOIN LATERAL (SELECT id, n, geometry_digest, evaluation_id FROM revisions WHERE part_slug = p.slug ORDER BY n DESC LIMIT 1) h ON true
         JOIN evaluations e ON e.id = h.evaluation_id
        WHERE p.visibility = 'public' AND p.listed AND ($2::text IS NULL OR p.category = $2)
     ) g
     WHERE true ${keyset}
     ORDER BY ${order.order}
     LIMIT ${PAGE_SIZE + 1}`,
    values,
  );
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const counts = await db.rows<{ category: string; n: number }>(
    "SELECT category, count(*)::int AS n FROM parts WHERE visibility = 'public' AND listed GROUP BY category",
  );
  const countOf = (slug: string) => counts.find((c) => c.category === slug)?.n ?? 0;
  const body: GalleryJson = {
    parts: page.map(galleryPart),
    nextCursor: rows.length > PAGE_SIZE && last ? signCursor({ category, sort, key: order.key(last) }) : null,
    categories: CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, count: countOf(c.slug) })),
    total: category === null ? counts.reduce((sum, c) => sum + c.n, 0) : countOf(category),
  };
  return jsonReply(200, body);
}

// ------------------------------------------------------------------------------------------------ one part

async function partPage(ctx: Ctx) {
  const part = await readablePart(ctx, ctx.params.slug);
  const user = await ctx.user();
  const asked = ctx.url.searchParams.get("revision");
  const revision: RevisionRow | undefined = asked === null ? await headRevision(db, part.slug) : await loadRevision(db, asked);
  if (!revision || revision.part_slug !== part.slug) throw notFound();
  const source = await sourceText(db, revision.source_ref);
  const [likes, authors] = await Promise.all([
    db.one<{ n: number; liked: boolean }>(
      "SELECT count(*)::int AS n, COALESCE(bool_or(user_id = $2), false) AS liked FROM likes WHERE part_slug = $1",
      [part.slug, user?.id ?? null],
    ),
    db.rows<{ id: string; display_name: string }>(
      "SELECT DISTINCT u.id, u.display_name FROM revisions r JOIN users u ON u.id = r.author_id WHERE r.part_slug = $1",
      [part.slug],
    ),
  ]);
  const body: PartJson = {
    slug: part.slug,
    title: part.title,
    category: part.category,
    visibility: part.visibility,
    owner: { id: part.ownerId, displayName: part.ownerName },
    likes: likes.n,
    liked: likes.liked,
    headRevisionId: part.headId,
    revision: revisionJson(revision),
    source,
    manifest: buildManifest(modelOf(source), revision.param_values),
    preflightLeft: user ? null : Math.max(0, config.preflightSignedOutLimit - (await allowanceUsed(ctx.visitorId))),
    authors: Object.fromEntries(authors.map((a) => [a.id, a.display_name])),
  };
  return jsonReply(200, body, { ETag: etagOf(part.headId) });
}

// ------------------------------------------------------------------------------------------------ likes

/** Adds or removes one like record, writing its event in the same transaction; answers the part's like count. */
export async function applyLike(slug: string, userId: string, liked: boolean, at: Date): Promise<number> {
  return transaction(async (tx) => {
    await requirePart(tx, slug, true);
    const changed = liked
      ? await tx.run("INSERT INTO likes (part_slug, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [slug, userId, at])
      : await tx.run("DELETE FROM likes WHERE part_slug = $1 AND user_id = $2", [slug, userId]);
    const { n } = await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM likes WHERE part_slug = $1", [slug]);
    if (changed === 1) await emit(tx, slug, "like", null, { type: "like", partSlug: slug, likes: n });
    return n;
  });
}

function setLike(liked: boolean) {
  return async (ctx: Ctx) => {
    const user = await ctx.requireUser();
    const part = await readablePart(ctx, ctx.params.slug);
    return jsonReply(200, { liked, likes: await applyLike(part.slug, user.id, liked, new Date()) });
  };
}

export const partRoutes: Route[] = [
  get("/api/parts", gallery),
  get("/api/parts/:slug", partPage),
  put("/api/parts/:slug/like", setLike(true)),
  del("/api/parts/:slug/like", setLike(false)),
];
