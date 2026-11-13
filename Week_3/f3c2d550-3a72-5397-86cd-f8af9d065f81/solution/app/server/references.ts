import { randomBytes } from "node:crypto";
import type { Library, Reference, SearchResult, Trash } from "../shared/api.js";
import { sizeText } from "../shared/sizes.js";
import { addSeconds, isoSeconds, now } from "./clock.js";
import { config } from "./config.js";
import { pool, query, transaction, type Queryable } from "./db.js";
import { ApiError, validationError } from "./errors.js";
import { COPY, parseFacts, parsePoint, type Facts, type RawFields } from "./facts.js";
import { UndecodablePhoto, measurePhoto } from "./images.js";
import {
  MAX_PHOTO_BYTES,
  exceedsPixelLimit,
  readHeader,
  type PhotoHeader,
} from "./photo.js";
import { confirmSearchWrites, matchReferences, recordSearchUpdate, type SearchFilters } from "./search.js";
import { homeZone } from "./settings.js";
import { StorageUnavailable, deleteObject, getObject, putConfirmed, putObject, sha256Hex } from "./storage.js";
import { currentYear, startOfLocalDay } from "./zones.js";

export interface ReferenceRow {
  seq: number;
  id: string;
  state: "stored" | "trashed" | "purged";
  version: number;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string;
  colour_family: Reference["colour_family"];
  source_url: string | null;
  source_note: string;
  notes: string;
  width_tenths: number;
  height_tenths: number;
  depth_tenths: number;
  swatch: string;
  swatch_source: Reference["swatch_source"];
  captured_at: Date;
  trashed_at: Date | null;
  purge_at: Date | null;
  photo_content_type: Reference["photo"]["content_type"];
  photo_bytes: number;
  photo_sha256: string;
  photo_width: number;
  photo_height: number;
}

export const newId = (prefix: string): string => `${prefix}_${randomBytes(10).toString("hex")}`;

export const originalKey = (id: string, contentType: string): string =>
  `references/${id}/original.${contentType === "image/png" ? "png" : "jpg"}`;
export const displayKey = (id: string): string => `references/${id}/display.jpg`;

export function toReference(row: ReferenceRow): Reference {
  const size = { width: row.width_tenths, height: row.height_tenths, depth: row.depth_tenths };
  return {
    id: row.id,
    state: row.state === "trashed" ? "trashed" : "stored",
    version: row.version,
    title: row.title,
    maker: row.maker,
    year: row.year,
    materials: row.materials,
    finish: row.finish,
    colour_family: row.colour_family,
    source_url: row.source_url,
    source_note: row.source_note,
    notes: row.notes,
    size_tenths_mm: size,
    size_text: { mm: sizeText(size, "mm"), in: sizeText(size, "in") },
    swatch: row.swatch,
    swatch_source: row.swatch_source,
    captured_at: isoSeconds(row.captured_at),
    trashed_at: row.trashed_at ? isoSeconds(row.trashed_at) : null,
    purge_at: row.purge_at ? isoSeconds(row.purge_at) : null,
    photo: {
      original_url: `/api/references/${row.id}/original`,
      display_url: `/api/references/${row.id}/display`,
      content_type: row.photo_content_type,
      bytes: row.photo_bytes,
      sha256: row.photo_sha256,
      width: row.photo_width,
      height: row.photo_height,
    },
  };
}

/** A reference that is stored or trashed; a purged or unknown one is not found. */
export async function findReference(id: string, client: Queryable = pool, lock = false): Promise<ReferenceRow> {
  const [row] = await query<ReferenceRow>(
    `SELECT * FROM deck_reference WHERE id = $1 AND state <> 'purged' ${lock ? "FOR UPDATE" : ""}`,
    [id],
    client,
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

export async function findReferences(ids: readonly string[], client: Queryable = pool): Promise<ReferenceRow[]> {
  const rows = await query<ReferenceRow>("SELECT * FROM deck_reference WHERE id = ANY($1) AND state <> 'purged'", [ids], client);
  return ids.flatMap((id) => rows.filter((row) => row.id === id));
}

export async function listLibrary(filters: { colour_family?: string; material?: string; finish?: string }): Promise<Library> {
  const zone = await homeZone();
  const todayStartsAt = startOfLocalDay(now(), zone);
  const rows = await query<ReferenceRow>(
    `SELECT * FROM deck_reference
     WHERE state = 'stored'
       AND ($1::text IS NULL OR colour_family = $1)
       AND ($2::text IS NULL OR $2 = ANY(materials))
       AND ($3::text IS NULL OR finish = $3)
     ORDER BY captured_at DESC, seq DESC`,
    [filters.colour_family ?? null, filters.material ?? null, filters.finish ?? null],
  );
  return {
    zone,
    today_starts_at: isoSeconds(todayStartsAt),
    saved_today: rows.filter((row) => row.captured_at >= todayStartsAt).map(toReference),
    earlier: rows.filter((row) => row.captured_at < todayStartsAt).map(toReference),
  };
}

const PHOTO_COPY = "Add a JPEG or PNG photograph.";
const PHOTO_BYTES_COPY = "Use a photograph of 15,000,000 bytes or less.";
const PHOTO_PIXELS_COPY = "Use a photograph of 40 megapixels or less.";

interface CaptureInput {
  fields: RawFields;
  photo: Buffer | null;
}

async function latestYear(): Promise<number> {
  return currentYear(now(), await homeZone());
}

function checkPhoto(photo: Buffer | null): { header: PhotoHeader | null; error: string | null } {
  if (!photo || photo.length === 0) return { header: null, error: PHOTO_COPY };
  if (photo.length > MAX_PHOTO_BYTES) return { header: null, error: PHOTO_BYTES_COPY };
  const header = readHeader(photo);
  if (!header) return { header: null, error: PHOTO_COPY };
  if (exceedsPixelLimit(header)) return { header: null, error: PHOTO_PIXELS_COPY };
  return { header, error: null };
}

function captureSwatchPoint(fields: RawFields): { point: { x: number; y: number } | null; errors: Record<string, string> } {
  const hasX = fields.swatch_x !== undefined && fields.swatch_x !== "";
  const hasY = fields.swatch_y !== undefined && fields.swatch_y !== "";
  if (!hasX && !hasY) return { point: null, errors: {} };
  if (hasX !== hasY) return { point: null, errors: { [hasX ? "swatch_y" : "swatch_x"]: COPY.point } };
  return parsePoint(fields.swatch_x, fields.swatch_y, ["swatch_x", "swatch_y"]);
}

/** Capture: checks everything, stores the original and the display crop, confirms them, then creates the reference. */
export async function captureReference({ fields, photo }: CaptureInput): Promise<Reference> {
  const parsed = parseFacts(fields, { latestYear: await latestYear(), stored: null });
  const swatchPoint = captureSwatchPoint(fields);
  const checked = checkPhoto(photo);
  const errors = { ...parsed.errors, ...swatchPoint.errors };
  if (checked.error) errors.photo = checked.error;
  const { header } = checked;
  if (Object.keys(errors).length > 0 || !header || !photo) throw validationError(errors);

  let measurement;
  try {
    measurement = await measurePhoto({ bytes: photo, header, point: swatchPoint.point, crop: true });
  } catch (error) {
    if (error instanceof UndecodablePhoto) throw validationError({ photo: PHOTO_COPY });
    throw error;
  }
  const facts = parsed.facts as Facts;
  const id = newId("ref");
  const contentType = header.type === "png" ? "image/png" : "image/jpeg";
  const written: string[] = [];
  try {
    await putConfirmed(originalKey(id, contentType), photo, contentType);
    written.push(originalKey(id, contentType));
    if (!measurement.display) throw new Error("the display crop was not made");
    await putObject(displayKey(id), measurement.display, "image/jpeg");
    written.push(displayKey(id));
    const capturedAt = new Date(Math.floor(now().getTime() / 1000) * 1000);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO deck_reference (id, state, version, title, maker, year, materials, finish, colour_family, source_url,
           source_note, notes, width_tenths, height_tenths, depth_tenths, swatch, swatch_source, captured_at,
           photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height)
         VALUES ($1, 'stored', 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          id, facts.title, facts.maker, facts.year, facts.materials, facts.finish, facts.colour_family, facts.source_url,
          facts.source_note, facts.notes, facts.size.width, facts.size.height, facts.size.depth,
          measurement.sampled ?? measurement.computed, measurement.sampled ? "eyedropper" : "computed", capturedAt,
          contentType, photo.length, sha256Hex(photo), header.width, header.height,
        ],
      );
      await recordSearchUpdate(client, id);
    });
  } catch {
    await Promise.allSettled(written.map((key) => deleteObject(key)));
    throw new ApiError("storage_unavailable");
  }
  await confirmSearchWrites();
  return toReference(await findReference(id));
}

function parseVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** Facts edit: carries the version it was based on; of two edits on one version exactly one wins. */
export async function editReference(id: string, raw: RawFields): Promise<Reference> {
  const year = await latestYear();
  await transaction(async (client) => {
    const row = await findReference(id, client, true);
    if (row.state === "trashed") throw new ApiError("reference_trashed");
    const version = parseVersion(raw.version);
    if (version !== null && version !== row.version) throw new ApiError("reference_version_conflict");
    const stored: Facts = {
      title: row.title, maker: row.maker, year: row.year, materials: row.materials, finish: row.finish,
      colour_family: row.colour_family, source_url: row.source_url, source_note: row.source_note, notes: row.notes,
      size: { width: row.width_tenths, height: row.height_tenths, depth: row.depth_tenths },
    };
    const parsed = parseFacts(raw, { latestYear: year, stored: { facts: stored } });
    const errors = version === null ? { ...parsed.errors, version: COPY.version } : parsed.errors;
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const next = { ...stored, ...parsed.facts };
    await client.query(
      `UPDATE deck_reference SET version = version + 1, title = $2, maker = $3, year = $4, materials = $5, finish = $6,
         colour_family = $7, source_url = $8, source_note = $9, notes = $10, width_tenths = $11, height_tenths = $12,
         depth_tenths = $13 WHERE id = $1`,
      [
        id, next.title, next.maker, next.year, next.materials, next.finish, next.colour_family, next.source_url,
        next.source_note, next.notes, next.size.width, next.size.height, next.size.depth,
      ],
    );
    await recordSearchUpdate(client, id);
  });
  await confirmSearchWrites();
  return toReference(await findReference(id));
}

/** stored → trashed. */
export async function trashReference(id: string): Promise<Reference> {
  await transaction(async (client) => {
    const row = await findReference(id, client, true);
    if (row.state === "trashed") throw new ApiError("already_trashed");
    const trashedAt = now();
    await client.query(
      "UPDATE deck_reference SET state = 'trashed', version = version + 1, trashed_at = $2, purge_at = $3 WHERE id = $1",
      [id, trashedAt, addSeconds(trashedAt, config.trashRetentionSeconds)],
    );
    await recordSearchUpdate(client, id);
  });
  await confirmSearchWrites();
  return toReference(await findReference(id));
}

/** The restore window: restoring is allowed up to and including `purge_at`. */
const restoreWindowOpen = (row: ReferenceRow): boolean => row.purge_at !== null && now() <= row.purge_at;

/** trashed → stored, within the window; past it the reference is purged at once. */
export async function restoreReference(id: string): Promise<Reference> {
  const [existing] = await query<ReferenceRow>("SELECT * FROM deck_reference WHERE id = $1", [id]);
  if (!existing) throw new ApiError("not_found");
  if (existing.state === "purged") throw new ApiError("restore_window_closed");
  if (existing.state === "trashed" && !restoreWindowOpen(existing)) {
    await purgeReference(id);
    throw new ApiError("restore_window_closed");
  }
  await transaction(async (client) => {
    const row = await findReference(id, client, true);
    if (row.state !== "trashed") throw new ApiError("not_trashed");
    await client.query(
      "UPDATE deck_reference SET state = 'stored', version = version + 1, trashed_at = NULL, purge_at = NULL WHERE id = $1",
      [id],
    );
    await recordSearchUpdate(client, id);
  });
  await confirmSearchWrites();
  return toReference(await findReference(id));
}

/** trashed → purged: the objects, the search document and the reel stops all go. */
async function purgeReference(id: string): Promise<void> {
  const purged = await transaction(async (client) => {
    const [row] = await query<ReferenceRow>(
      "SELECT * FROM deck_reference WHERE id = $1 AND state = 'trashed' FOR UPDATE SKIP LOCKED",
      [id],
      client,
    );
    if (!row) return false;
    await deleteObject(originalKey(id, row.photo_content_type));
    await deleteObject(displayKey(id));
    await client.query("UPDATE reel SET version = version + 1 WHERE id IN (SELECT reel_id FROM reel_stop WHERE reference_id = $1)", [id]);
    await client.query("DELETE FROM reel_stop WHERE reference_id = $1", [id]);
    await client.query("UPDATE deck_reference SET state = 'purged' WHERE id = $1", [id]);
    await recordSearchUpdate(client, id);
    return true;
  });
  if (purged) await confirmSearchWrites();
}

/** Purges every trashed reference past its `purge_at`; called by the sweep every couple of seconds. */
export async function purgeDue(): Promise<void> {
  const due = await query<{ id: string }>("SELECT id FROM deck_reference WHERE state = 'trashed' AND purge_at < $1", [now()]);
  for (const { id } of due) await purgeReference(id);
}

async function readOriginal(row: ReferenceRow): Promise<Buffer> {
  const bytes = await getObject(originalKey(row.id, row.photo_content_type));
  if (!bytes) throw new ApiError("storage_unavailable");
  return bytes;
}

/** Swatch from the eyedropper at a point, or back to the computed colour when the point is null. */
export async function changeSwatch(id: string, rawPoint: { x: unknown; y: unknown } | null): Promise<Reference> {
  const row = await findReference(id);
  if (row.state === "trashed") throw new ApiError("reference_trashed");
  const parsedPoint = rawPoint ? parsePoint(rawPoint.x, rawPoint.y, ["x", "y"]) : null;
  if (parsedPoint && !parsedPoint.point) throw validationError(parsedPoint.errors);
  let bytes: Buffer;
  try {
    bytes = await readOriginal(row);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
    throw error;
  }
  const header = readHeader(bytes);
  if (!header) throw new ApiError("storage_unavailable");
  const measurement = await measurePhoto({ bytes, header, point: parsedPoint?.point ?? null, crop: false });
  await transaction(async (client) => {
    const current = await findReference(id, client, true);
    if (current.state === "trashed") throw new ApiError("reference_trashed");
    await client.query(
      "UPDATE deck_reference SET swatch = $2, swatch_source = $3, version = version + 1 WHERE id = $1",
      [id, measurement.sampled ?? measurement.computed, measurement.sampled ? "eyedropper" : "computed"],
    );
    await recordSearchUpdate(client, id);
  });
  await confirmSearchWrites();
  return toReference(await findReference(id));
}

/** The stored photograph bytes for the original or the display crop. */
export async function readPhoto(id: string, kind: "original" | "display"): Promise<{ bytes: Buffer; contentType: string }> {
  const row = await findReference(id);
  const key = kind === "original" ? originalKey(id, row.photo_content_type) : displayKey(id);
  let bytes: Buffer | null;
  try {
    bytes = await getObject(key);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
    throw error;
  }
  if (!bytes) throw new ApiError("storage_unavailable");
  return { bytes, contentType: kind === "original" ? row.photo_content_type : "image/jpeg" };
}

/** Search answers from the index while it is up and from the library's own records otherwise. */
export async function searchLibrary(text: string, filters: SearchFilters): Promise<SearchResult> {
  const matches = await matchReferences(text, filters);
  const rows = await findReferences(matches.ids);
  return { source: matches.source, results: rows.filter((row) => row.state === "stored").map(toReference) };
}

export async function listTrash(): Promise<Trash> {
  const instant = now();
  const rows = await query<ReferenceRow>("SELECT * FROM deck_reference WHERE state = 'trashed' ORDER BY trashed_at DESC, seq DESC");
  return {
    server_now: isoSeconds(instant),
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      maker: row.maker,
      trashed_at: isoSeconds(row.trashed_at ?? instant),
      purge_at: isoSeconds(row.purge_at ?? instant),
      seconds_left: Math.max(0, Math.floor(((row.purge_at ?? instant).getTime() - instant.getTime()) / 1000)),
    })),
  };
}
