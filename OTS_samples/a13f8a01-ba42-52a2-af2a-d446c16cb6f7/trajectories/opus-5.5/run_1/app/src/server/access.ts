import type { Visibility } from "../shared/types";
import { one, type Queryable } from "./db";
import { ApiError, notFound } from "./errors";
import type { UserRow } from "./auth";

export interface PenRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  title: string;
  visibility: Visibility;
  tags: string[];
  head: number;
  forked_from_pen: string | null;
  forked_from_version: number | null;
  updated_at: Date;
  likes: number;
  forks: number;
}

export const likesCountSql = "(SELECT count(*)::int FROM likes l WHERE l.pen_id = p.id)";
export const forksCountSql = "(SELECT count(*)::int FROM pens f WHERE f.forked_from_pen = p.id)";

export const penColumns = `p.id, p.owner_id, o.handle AS owner_handle, p.title, p.visibility, p.tags, p.head,
  p.forked_from_pen, p.forked_from_version, p.updated_at, ${likesCountSql} AS likes, ${forksCountSql} AS forks`;

export const penFrom = "pens p JOIN users o ON o.id = p.owner_id";

export function visibleToSql(viewerParam: string): string {
  return `(p.visibility <> 'private' OR p.owner_id = ${viewerParam})`;
}

export function canView(pen: { owner_id: string; visibility: Visibility }, viewerId: string | null): boolean {
  return pen.visibility !== "private" || pen.owner_id === viewerId;
}

export async function loadVisiblePen(db: Queryable, penId: string, viewer: UserRow | null, lock = false): Promise<PenRow> {
  const pen = await one<PenRow>(db, `SELECT ${penColumns} FROM ${penFrom} WHERE p.id = $1${lock ? " FOR UPDATE OF p" : ""}`, [penId]);
  if (!pen || !canView(pen, viewer?.id ?? null)) throw notFound();
  return pen;
}

export function requireOwner(pen: PenRow, viewer: UserRow): void {
  if (pen.owner_id !== viewer.id) throw new ApiError("forbidden");
}

export function requireVerified(viewer: UserRow): void {
  if (!viewer.verified) throw new ApiError("unverified");
}

export async function penCounts(db: Queryable, penId: string): Promise<{ likes: number; forks: number }> {
  const row = await one<{ likes: number; forks: number }>(db, `SELECT ${likesCountSql} AS likes, ${forksCountSql} AS forks FROM pens p WHERE p.id = $1`, [penId]);
  return row ?? { likes: 0, forks: 0 };
}
