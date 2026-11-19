import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

export type Visibility = "private" | "unlisted" | "public";

export interface UserRow {
  id: string;
  handle: string;
  email: string;
  password_hash: string;
  verified: boolean;
}

export interface PenRow {
  id: string;
  owner_id: string;
  title: string;
  visibility: Visibility;
  head: number;
  forked_from_pen_id: string | null;
  forked_from_version: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface VersionRow {
  pen_id: string;
  number: number;
  created_at: Date;
  sha256: string;
  html: string;
  css: string;
  js: string;
  libraries: string[];
  restored_from: number | null;
  added: number;
  removed: number;
  changed_chars: number;
}

export const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(): string {
  const bytes = randomBytes(10);
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return id;
}

// The one place that decides whether a viewer may see a pen.
export function canSee(pen: PenRow, viewerId: string | null): boolean {
  if (pen.visibility === "public" || pen.visibility === "unlisted") return true;
  return pen.owner_id === viewerId;
}

export async function getPen(client: PoolClient, id: string): Promise<PenRow | null> {
  const res = await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}

export async function getVisiblePen(client: PoolClient, id: string, viewerId: string | null): Promise<PenRow | null> {
  const pen = await getPen(client, id);
  if (!pen) return null;
  return canSee(pen, viewerId) ? pen : null;
}

export async function getHead(client: PoolClient, penId: string): Promise<number> {
  const res = await client.query<{ head: number }>("SELECT head FROM pens WHERE id = $1", [penId]);
  return res.rows[0]?.head ?? 0;
}

export async function getVersionRow(client: PoolClient, penId: string, number: number): Promise<VersionRow | null> {
  const res = await client.query<VersionRow>(
    "SELECT pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars FROM versions WHERE pen_id = $1 AND number = $2",
    [penId, number],
  );
  return res.rows[0] ?? null;
}

export async function countLikes(client: PoolClient, penId: string): Promise<number> {
  const res = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM likes WHERE pen_id = $1", [penId]);
  return Number(res.rows[0]?.n ?? "0");
}

export async function countForks(client: PoolClient, penId: string): Promise<number> {
  const res = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM pens WHERE forked_from_pen_id = $1", [penId]);
  return Number(res.rows[0]?.n ?? "0");
}

export async function penTags(client: PoolClient, penId: string): Promise<string[]> {
  const res = await client.query<{ tag: string }>("SELECT tag FROM tags WHERE pen_id = $1 ORDER BY position", [penId]);
  return res.rows.map((r) => r.tag);
}

export interface ForkFrom {
  pen_id: string;
  version: number;
  title: string;
  owner: string;
}

export type ForkedFrom = ForkFrom | { removed: true } | { hidden: true } | null;

// The one place that decides how a fork credit is reported.
export async function forkedFromFor(client: PoolClient, pen: PenRow, viewerId: string | null): Promise<ForkedFrom> {
  if (!pen.forked_from_pen_id || pen.forked_from_version === null) return null;
  const source = await getPen(client, pen.forked_from_pen_id);
  if (!source) return { removed: true };
  if (!canSee(source, viewerId)) return { hidden: true };
  const owner = await client.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [source.owner_id]);
  return {
    pen_id: source.id,
    version: pen.forked_from_version,
    title: source.title,
    owner: owner.rows[0]?.handle ?? "",
  };
}

export function isoTime(d: Date): string {
  return d.toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}
