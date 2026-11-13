// Parts and revisions as rows, their JSON forms, and who may read what.
import type { RevisionJson } from "../shared/api";
import { foldEmail } from "../shared/text";
import { parseTine, type Model, type Values } from "../shared/tine";
import type { User } from "./auth";
import { db, type Queries } from "./db";
import { notFound } from "./errors";
import type { Ctx } from "./http";

export interface PartRow {
  slug: string;
  title: string;
  category: string;
  visibility: "public" | "private";
  ownerId: string;
  ownerName: string;
  createdAt: Date;
  headId: string;
  headN: number;
}

interface PartSql {
  slug: string;
  title: string;
  category: string;
  visibility: "public" | "private";
  owner_id: string;
  owner_name: string;
  created_at: Date;
  head_id: string;
  head_n: number;
}

export async function loadPart(queries: Queries, slug: string, lock = false): Promise<PartRow | undefined> {
  const row = await queries.row<PartSql>(
    `SELECT p.slug, p.title, p.category, p.visibility, p.owner_id, u.display_name AS owner_name, p.created_at,
            h.id AS head_id, h.n AS head_n
       FROM parts p
       JOIN users u ON u.id = p.owner_id
       JOIN LATERAL (SELECT id, n FROM revisions WHERE part_slug = p.slug ORDER BY n DESC LIMIT 1) h ON true
      WHERE p.slug = $1${lock ? " FOR UPDATE OF p" : ""}`,
    [slug],
  );
  return row && {
    slug: row.slug,
    title: row.title,
    category: row.category,
    visibility: row.visibility,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    headId: row.head_id,
    headN: row.head_n,
  };
}

/** A part that must exist: the caller has just found or created it. */
export async function requirePart(queries: Queries, slug: string, lock = false): Promise<PartRow> {
  const part = await loadPart(queries, slug, lock);
  if (!part) throw new Error(`part ${slug} is missing`);
  return part;
}

export interface RevisionRow {
  id: string;
  part_slug: string;
  n: number;
  parent_id: string | null;
  author_id: string;
  created_at: Date;
  param_values: Values;
  source_ref: string;
  evaluation_id: string;
  geometry_digest: string;
  message: string;
  restored_from: string | null;
  forked_from_revision: string | null;
  forked_from_operation: number | null;
}

export const revisionLabel = (n: number): string => `r${n}`;

export function revisionJson(row: RevisionRow): RevisionJson {
  return {
    id: row.id,
    label: revisionLabel(row.n),
    partSlug: row.part_slug,
    parentRevisionId: row.parent_id,
    authorId: row.author_id,
    createdAt: row.created_at.toISOString(),
    values: row.param_values,
    sourceRef: row.source_ref,
    evaluationId: row.evaluation_id,
    geometryDigest: row.geometry_digest,
    message: row.message,
    restoredFrom: row.restored_from,
    forkedFrom: row.forked_from_revision === null ? null : { revisionId: row.forked_from_revision, operation: row.forked_from_operation as number },
  };
}

export function loadRevision(queries: Queries, id: string): Promise<RevisionRow | undefined> {
  return queries.row<RevisionRow>("SELECT * FROM revisions WHERE id = $1", [id]);
}

/** The newest revision; a part always has one. */
export function headRevision(queries: Queries, slug: string): Promise<RevisionRow> {
  return queries.one<RevisionRow>("SELECT * FROM revisions WHERE part_slug = $1 ORDER BY n DESC LIMIT 1", [slug]);
}

export async function sourceText(queries: Queries, ref: string): Promise<string> {
  const row = await queries.row<{ text: string }>("SELECT text FROM sources WHERE ref = $1", [ref]);
  return row?.text ?? "";
}

/** The parsed model of a stored source, which was valid when it was stored. */
export function modelOf(source: string): Model {
  const parsed = parseTine(source);
  if (!parsed.ok) throw new Error(`stored source does not parse: line ${parsed.line}: ${parsed.reason}`);
  return parsed.model;
}

/** Whether the person is an invited reviewer, by verified email, of any room of the part (or of one room). */
export async function isReviewer(queries: Queries, user: Pick<User, "email" | "verified"> | null, scope: { partSlug: string } | { roomId: string }): Promise<boolean> {
  if (!user?.verified) return false;
  const filter = "roomId" in scope ? "r.id = $2" : "r.part_slug = $2";
  const found = await queries.row(
    `SELECT 1 FROM rooms r JOIN room_reviewers rr ON rr.room_id = r.id WHERE rr.email_fold = $1 AND ${filter}`,
    [foldEmail(user.email), "roomId" in scope ? scope.roomId : scope.partSlug],
  );
  return found !== undefined;
}

/** A public part is readable by anyone; a private one by its owner and by the reviewers of its rooms. */
async function canRead(ctx: Ctx, part: Pick<PartRow, "slug" | "visibility" | "ownerId">): Promise<boolean> {
  if (part.visibility === "public") return true;
  const user = await ctx.user();
  return user?.id === part.ownerId || (await isReviewer(db, user, { partSlug: part.slug }));
}

/** The part, or a 404 when it does not exist or the caller may not read it. */
export async function readablePart(ctx: Ctx, slug: string): Promise<PartRow> {
  const part = await loadPart(db, slug);
  if (!part || !(await canRead(ctx, part))) throw notFound();
  return part;
}
