import type { MediaRecord } from "../../shared/types";
import { codePoints } from "../../shared/codepoints";
import { FIELD_ERRORS } from "../../shared/copy";
import { SEARCH_CODEPOINTS_MAX, SEARCH_TERMS_MAX } from "../../shared/limits";
import { one, pool, query, tx, type Db } from "../db";
import { AppError, invalid, notFound } from "../errors";
import { kv } from "../kv";
import { decodeCursor, encodeCursor, pageLimit } from "../cursor";
import { deleteObject, getObject, headObject } from "../s3";
import { computePeaks } from "./peaks";
import { giveBackStorage } from "../allowance";

interface MediaRow {
  id: string;
  name: string;
  kind: MediaRecord["kind"];
  folder: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sample_rate: number | null;
  seq: number;
}

export const mediaWords = (name: string, folder: string): string[] => `${name} ${folder}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Titles of the projects whose live clips or named cuts use each file, in title order. */
async function usage(db: Db, ids: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await query<{ media_id: string; title: string }>(
    `SELECT DISTINCT media_id, title FROM (
       SELECT c.media_id, p.title FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.media_id = ANY($1)
       UNION
       SELECT e->>'media_id', p.title FROM cuts k JOIN projects p ON p.id = k.project_id,
         jsonb_array_elements(k.snapshot->'clips') e WHERE e->>'media_id' = ANY($1)
     ) used ORDER BY title`,
    [ids],
    db,
  );
  const byMedia = new Map<string, string[]>();
  for (const row of rows) byMedia.set(row.media_id, [...(byMedia.get(row.media_id) ?? []), row.title]);
  return byMedia;
}

async function mediaRecords(db: Db, rows: readonly MediaRow[]): Promise<MediaRecord[]> {
  const used = await usage(db, rows.map((row) => row.id));
  return rows.map(({ seq: _seq, ...row }) => ({ ...row, used_in: used.get(row.id) ?? [] }));
}

export async function mediaById(db: Db, id: string): Promise<MediaRecord | null> {
  const row = await one<MediaRow>("SELECT * FROM media WHERE id = $1", [id], db);
  return row ? (await mediaRecords(db, [row]))[0] ?? null : null;
}

function parseSearch(q: string | null): string[] {
  if (q === null) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length > SEARCH_TERMS_MAX || codePoints(q) > SEARCH_CODEPOINTS_MAX) throw invalid({ q: FIELD_ERRORS.q });
  return terms.map((term) => term.toLowerCase());
}

export async function listMedia(params: URLSearchParams): Promise<{ items: MediaRecord[]; next_cursor: string | null }> {
  const terms = parseSearch(params.get("q"));
  const limit = pageLimit(params.get("limit"), 50);
  const cursor = decodeCursor(params.get("cursor"));
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const folder = params.get("folder");
  if (folder !== null) where.push(`folder = ${bind(folder)}`);
  for (const term of terms) where.push(`EXISTS (SELECT 1 FROM unnest(words) w WHERE starts_with(w, ${bind(term)}))`);
  if (cursor) where.push(`(folder, name, id) > (${bind(cursor.sortValue)}, ${bind(cursor.extra)}, ${bind(cursor.id)})`);
  const rows = await query<MediaRow>(
    `SELECT * FROM media ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY folder, name, id LIMIT ${bind(limit + 1)}`,
    values,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await mediaRecords(pool, page),
    next_cursor: rows.length > limit && last ? encodeCursor(last.folder, last.id, last.name) : null,
  };
}

export async function deleteMedia(id: string): Promise<void> {
  const row = await tx(async (db) => {
    const found = await one<MediaRow>("SELECT * FROM media WHERE id = $1 FOR UPDATE", [id], db);
    if (!found) throw notFound();
    const titles = (await usage(db, [id])).get(id);
    if (titles?.length) throw new AppError("media_in_use", { file: found.name, projects: titles.join(", ") }, { projects: titles });
    await db.query("DELETE FROM media WHERE id = $1", [id]);
    return found;
  });
  await deleteObject(`media/${row.sha256}`);
  await kv.del(`gatecut:peaks:${row.sha256}`);
  await giveBackStorage(row.bytes);
}

/** Peaks of the first channel in 1,000 buckets, computed once per checksum and kept in Valkey. */
export async function peaksOf(id: string): Promise<number[]> {
  const row = await one<MediaRow & { src_num: number }>("SELECT * FROM media WHERE id = $1", [id]);
  if (!row || row.kind !== "wav") throw notFound();
  const key = `gatecut:peaks:${row.sha256}`;
  const kept = await kv.get(key);
  if (kept) return JSON.parse(kept) as number[];
  const stored = await headObject(`media/${row.sha256}`);
  if (!stored) throw notFound();
  const peaks = await computePeaks(stored.size, (range) => getObject(`media/${row.sha256}`, range));
  await kv.set(key, JSON.stringify(peaks));
  return peaks;
}
