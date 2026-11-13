// Repository over Postgres. Every single-winner rule is decided by SQL with
// row locking or conditional updates, never by in-process state.

import type { Pool, PoolClient } from "pg";
import type { Reference, Reel, ReelSummary, Sheet, SheetStopSnapshot } from "../shared/domain.js";
import { sizeText } from "../shared/domain.js";

interface ReferenceRow {
  id: string; state: string; version: number; title: string; maker: string | null;
  year: number | null; materials: string[]; finish: string | null; colour_family: string;
  source_url: string | null; source_note: string | null; notes: string | null;
  width_tenths: number; height_tenths: number; depth_tenths: number;
  swatch: string; swatch_source: string; captured_at: Date; trashed_at: Date | null;
  purge_at: Date | null; photo_content_type: string; photo_bytes: string | number;
  photo_sha256: string; photo_width: number; photo_height: number;
}

export type { ReferenceRow };

export function toIsoSecond(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function rowToReference(row: ReferenceRow): Reference {
  return {
    id: row.id,
    state: row.state === "trashed" ? "trashed" : "stored",
    version: row.version,
    title: row.title,
    maker: row.maker,
    year: row.year,
    materials: row.materials ?? [],
    finish: row.finish,
    colour_family: row.colour_family as Reference["colour_family"],
    source_url: row.source_url,
    source_note: row.source_note,
    notes: row.notes,
    size_tenths_mm: { width: row.width_tenths, height: row.height_tenths, depth: row.depth_tenths },
    size_text: sizeText({ width: row.width_tenths, height: row.height_tenths, depth: row.depth_tenths }),
    swatch: row.swatch,
    swatch_source: row.swatch_source === "eyedropper" ? "eyedropper" : "computed",
    captured_at: toIsoSecond(row.captured_at),
    trashed_at: row.trashed_at ? toIsoSecond(row.trashed_at) : null,
    purge_at: row.purge_at ? toIsoSecond(row.purge_at) : null,
    photo: {
      original_url: `/api/references/${row.id}/original`,
      display_url: `/api/references/${row.id}/display`,
      content_type: row.photo_content_type === "image/png" ? "image/png" : "image/jpeg",
      bytes: Number(row.photo_bytes),
      sha256: row.photo_sha256,
      width: row.photo_width,
      height: row.photo_height,
    },
  };
}

export interface NewReference {
  id: string; title: string; maker: string | null; year: number | null;
  materials: string[]; finish: string | null; colour_family: string;
  source_url: string | null; source_note: string | null; notes: string | null;
  widthTenths: number; heightTenths: number; depthTenths: number;
  capturedAt: Date; photoContentType: string; photoBytes: number;
  photoSha256: string; photoWidth: number; photoHeight: number;
}

const REF_COLUMNS = `id, state, version, title, maker, year, materials, finish, colour_family,
  source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
  swatch, swatch_source, captured_at, trashed_at, purge_at,
  photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height`;

export async function insertReference(pool: Pool | PoolClient, r: NewReference, swatch: string): Promise<Reference> {
  const { rows } = await pool.query(
    `INSERT INTO "references" (id, title, maker, year, materials, finish, colour_family,
       source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
       swatch, captured_at, photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING ${REF_COLUMNS}`,
    [r.id, r.title, r.maker, r.year, r.materials, r.finish, r.colour_family, r.source_url,
     r.source_note, r.notes, r.widthTenths, r.heightTenths, r.depthTenths, swatch, r.capturedAt,
     r.photoContentType, r.photoBytes, r.photoSha256, r.photoWidth, r.photoHeight],
  );
  return rowToReference(rows[0] as ReferenceRow);
}

export async function getReference(pool: Pool | PoolClient, id: string): Promise<Reference | null> {
  const { rows } = await pool.query(`SELECT ${REF_COLUMNS} FROM "references" WHERE id = $1`, [id]);
  return rows[0] ? rowToReference(rows[0] as ReferenceRow) : null;
}

export async function listStored(pool: Pool, ids?: string[]): Promise<Reference[]> {
  const { rows } = ids
    ? await pool.query(`SELECT ${REF_COLUMNS} FROM "references" WHERE id = ANY($1) AND state = 'stored'`, [ids])
    : await pool.query(`SELECT ${REF_COLUMNS} FROM "references" WHERE state = 'stored' ORDER BY captured_at DESC`);
  return (rows as ReferenceRow[]).map(rowToReference);
}

interface StopRow {
  reel_id: string; position: number; reference_id: string;
  reference: ReferenceRow;
}

const STOP_JOIN = `SELECT rs.reel_id, rs.position, rs.reference_id,
  r.id AS ref_id, r.state, r.version, r.title, r.maker, r.year, r.materials, r.finish,
  r.colour_family, r.source_url, r.source_note, r.notes, r.width_tenths, r.height_tenths,
  r.depth_tenths, r.swatch, r.swatch_source, r.captured_at, r.trashed_at, r.purge_at,
  r.photo_content_type, r.photo_bytes, r.photo_sha256, r.photo_width, r.photo_height
  FROM reel_stops rs JOIN "references" r ON r.id = rs.reference_id`;

export async function getReel(pool: Pool | PoolClient, id: string): Promise<Reel | null> {
  const reelRes = await pool.query(`SELECT id, name, demo, version FROM reels WHERE id = $1`, [id]);
  if (reelRes.rows.length === 0) return null;
  const { rows } = await pool.query(`${STOP_JOIN} WHERE rs.reel_id = $1 ORDER BY rs.position`, [id]);
  return {
    id: reelRes.rows[0].id,
    name: reelRes.rows[0].name,
    demo: reelRes.rows[0].demo,
    version: reelRes.rows[0].version,
    stops: rows.map((row) => ({
      position: row.position,
      reference: rowToReference({
        id: row.ref_id, state: row.state, version: row.version, title: row.title,
        maker: row.maker, year: row.year, materials: row.materials, finish: row.finish,
        colour_family: row.colour_family, source_url: row.source_url, source_note: row.source_note,
        notes: row.notes, width_tenths: row.width_tenths, height_tenths: row.height_tenths,
        depth_tenths: row.depth_tenths, swatch: row.swatch, swatch_source: row.swatch_source,
        captured_at: row.captured_at, trashed_at: row.trashed_at, purge_at: row.purge_at,
        photo_content_type: row.photo_content_type, photo_bytes: row.photo_bytes,
        photo_sha256: row.photo_sha256, photo_width: row.photo_width, photo_height: row.photo_height,
      } as ReferenceRow),
    })),
  };
}

export interface ReelSummaryRow { id: string; name: string; demo: boolean; version: number; stop_count: number; playable_count: number }

export async function listReels(pool: Pool): Promise<ReelSummaryRow[]> {
  const { rows } = await pool.query(`
    SELECT rl.id, rl.name, rl.demo, rl.version,
      count(rs.reference_id)::int AS stop_count,
      count(rs.reference_id) FILTER (WHERE r.state = 'stored')::int AS playable_count
    FROM reels rl
    LEFT JOIN reel_stops rs ON rs.reel_id = rl.id
    LEFT JOIN "references" r ON r.id = rs.reference_id
    GROUP BY rl.id ORDER BY rl.created_at`);
  return rows as ReelSummaryRow[];
}

export function rowToSheet(row: { id: string; reel_id: string; state: string; paper: string; unit: string;
  requested_at: Date; ready_at: Date | null; pdf_bytes: string | number | null; pdf_sha256: string | null;
  stops: SheetStopSnapshot[] }): Sheet {
  return {
    id: row.id,
    reel_id: row.reel_id,
    state: row.state as Sheet["state"],
    paper: row.paper as Sheet["paper"],
    unit: row.unit as Sheet["unit"],
    requested_at: toIsoSecond(row.requested_at),
    ready_at: row.ready_at ? toIsoSecond(row.ready_at) : null,
    pdf_url: row.state === "ready" ? `/api/sheets/${row.id}/pdf` : null,
    pdf_bytes: row.pdf_bytes === null ? null : Number(row.pdf_bytes),
    pdf_sha256: row.pdf_sha256,
    stops: row.stops,
  };
}

export async function getSheet(pool: Pool, id: string): Promise<Sheet | null> {
  const { rows } = await pool.query(
    `SELECT id, reel_id, state, paper, unit, requested_at, ready_at, pdf_bytes, pdf_sha256, stops
     FROM sheets WHERE id = $1`, [id]);
  return rows[0] ? rowToSheet(rows[0]) : null;
}

export async function listSheets(pool: Pool, reelId: string): Promise<Sheet[]> {
  const { rows } = await pool.query(
    `SELECT id, reel_id, state, paper, unit, requested_at, ready_at, pdf_bytes, pdf_sha256, stops
     FROM sheets WHERE reel_id = $1 ORDER BY requested_at DESC`, [reelId]);
  return (rows as never[]).map((r) => rowToSheet(r as never));
}
