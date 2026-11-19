// Survey assets: the manifest rule, object keys, and the storage-confirmation rule.
import { firstRow, newId, type Db } from "../db.js";
import { ApiError, fail } from "../http/errors.js";
import { monitor } from "../monitor.js";
import { deleteObject, listKeys, putObject, sha256Hex, statObject, StorageChecksumRefused } from "../storage.js";
import type { CorridorRecord } from "./corridor.js";
import { parseTrack, writeTrack } from "./flight.js";

export type AssetKind = "tileset" | "terrain" | "czml";
type AssetState = "pending" | "stored" | "rejected";

export interface AssetRow {
  id: string;
  corridor_id: string;
  kind: AssetKind;
  state: AssetState;
  rejected_reason: "checksum_mismatch" | "invalid_czml" | null;
  created_at: Date;
  stored_at: Date | null;
}

export interface AssetFileRow {
  asset_id: string;
  position: number;
  path: string;
  size_bytes: number;
  sha256: string;
  state: AssetState;
}

interface ManifestFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export const ASSET_COLUMNS = "id, corridor_id, kind, state, rejected_reason, created_at, stored_at";
const FILE_LIMIT = 50_000_000;
const PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function objectPrefix(tenantId: string, corridorId: string, assetId: string): string {
  return `tenants/${tenantId}/corridors/${corridorId}/assets/${assetId}/`;
}

export function contentTypeFor(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = {
    json: "application/json",
    czml: "application/json",
    glb: "model/gltf-binary",
    ktx2: "image/ktx2",
    terrain: "application/vnd.quantized-mesh",
  };
  return path.includes(".") ? (types[extension] ?? "application/octet-stream") : "application/octet-stream";
}

function validPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length >= 1 &&
    path.length <= 512 &&
    PATH_PATTERN.test(path) &&
    path.split("/").every((segment) => segment !== "." && segment !== "..")
  );
}

/** Validates a declared manifest; the published field messages on failure. */
export function validateManifest(json: Record<string, unknown>): { kind: AssetKind; files: ManifestFile[] } | { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const kind = json.kind;
  const validKind = kind === "tileset" || kind === "terrain" || kind === "czml";
  if (!validKind) fields.kind = "Choose tileset, terrain or czml.";

  const entries = Array.isArray(json.files) ? (json.files as unknown[]) : [];
  const files: ManifestFile[] = [];
  if (!Array.isArray(json.files) || entries.length < 1 || entries.length > 2000) {
    fields.files = "Declare between 1 and 2,000 files.";
  } else {
    entries.forEach((entry, i) => {
      const item = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const size = item.size_bytes;
      const digest = item.sha256;
      if (!validPath(item.path)) fields[`files.${i}.path`] = "Use a relative path of letters, digits, dot, dash and underscore segments.";
      if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > FILE_LIMIT) {
        fields[`files.${i}.size_bytes`] = "Each file must be between 1 and 50,000,000 bytes.";
      }
      if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
        fields[`files.${i}.sha256`] = "Give the SHA-256 as 64 lowercase hex characters.";
      }
      if (validPath(item.path) && typeof size === "number" && typeof digest === "string") {
        files.push({ path: item.path, sizeBytes: size, sha256: digest });
      }
    });
    const paths = entries.map((e) => (e !== null && typeof e === "object" ? (e as Record<string, unknown>).path : undefined));
    if (new Set(paths).size !== paths.length) fields.files = "Each path may appear once.";
    else if (kind === "tileset" && !paths.includes("tileset.json")) fields.files = "A tileset must include tileset.json.";
    else if (kind === "terrain" && !paths.includes("layer.json")) fields.files = "A terrain pyramid must include layer.json.";
    else if (kind === "czml" && !(paths.length === 1 && typeof paths[0] === "string" && paths[0].toLowerCase().endsWith(".czml"))) {
      fields.files = "A flight track is exactly one .czml file.";
    }
  }
  if (Object.keys(fields).length > 0 || !validKind) return { fields };
  return { kind, files };
}

export async function filesOf(db: Db, assetId: string): Promise<AssetFileRow[]> {
  const found = await db.query<AssetFileRow>(
    "SELECT asset_id, position, path, size_bytes, sha256, state FROM asset_files WHERE asset_id = $1 ORDER BY position",
    [assetId],
  );
  return found.rows;
}

export function fileJson(file: AssetFileRow): Record<string, unknown> {
  return { path: file.path, size_bytes: file.size_bytes, sha256: file.sha256, state: file.state };
}

export function assetJson(asset: AssetRow, files: AssetFileRow[]): Record<string, unknown> {
  return {
    id: asset.id,
    corridor_id: asset.corridor_id,
    kind: asset.kind,
    state: asset.state,
    rejected_reason: asset.rejected_reason,
    files: files.map(fileJson),
    created_at: asset.created_at.toISOString(),
    stored_at: asset.stored_at === null ? null : asset.stored_at.toISOString(),
  };
}

export async function declareAsset(db: Db, corridorId: string, kind: AssetKind, files: ManifestFile[], id = newId("ast")): Promise<AssetRow> {
  const inserted = await db.query<AssetRow>(
    `INSERT INTO assets (id, corridor_id, kind) VALUES ($1, $2, $3) RETURNING ${ASSET_COLUMNS}`,
    [id, corridorId, kind],
  );
  await db.query(
    `INSERT INTO asset_files (asset_id, position, path, size_bytes, sha256)
     SELECT $1, ord - 1, path, size_bytes, sha256
       FROM unnest($2::text[], $3::bigint[], $4::text[]) WITH ORDINALITY AS f(path, size_bytes, sha256, ord)`,
    [id, files.map((f) => f.path), files.map((f) => f.sizeBytes), files.map((f) => f.sha256)],
  );
  return firstRow(inserted);
}

/** The corridor's most recently stored asset of each kind. */
export async function activeAssets(db: Db, corridorId: string): Promise<Record<AssetKind, string | null>> {
  const found = await db.query<{ kind: AssetKind; id: string }>(
    `SELECT DISTINCT ON (kind) kind, id FROM assets WHERE corridor_id = $1 AND state = 'stored'
      ORDER BY kind, stored_at DESC, id DESC`,
    [corridorId],
  );
  const active: Record<AssetKind, string | null> = { tileset: null, terrain: null, czml: null };
  for (const row of found.rows) active[row.kind] = row.id;
  return active;
}

/**
 * The tenant's asset, or 404. With `lock` the row stays locked for the transaction, so the
 * confirmations of one asset run one at a time.
 */
export async function loadAsset(db: Db, tenantId: string, assetId: string, lock: boolean): Promise<AssetRow> {
  const found = await db.query<AssetRow>(
    `SELECT a.id, a.corridor_id, a.kind, a.state, a.rejected_reason, a.created_at, a.stored_at
       FROM assets a JOIN corridors c ON c.id = a.corridor_id
      WHERE a.id = $1 AND c.tenant_id = $2 ${lock ? "FOR UPDATE OF a" : ""}`,
    [assetId, tenantId],
  );
  const asset = found.rows[0];
  if (asset === undefined) throw fail.notFound();
  return asset;
}

async function rejectAsset(db: Db, asset: AssetRow, prefix: string, reason: "checksum_mismatch" | "invalid_czml"): Promise<void> {
  await db.query("UPDATE assets SET state = 'rejected', rejected_reason = $2 WHERE id = $1", [asset.id, reason]);
  await db.query("UPDATE asset_files SET state = 'rejected' WHERE asset_id = $1", [asset.id]);
  for (const key of await listKeys(prefix)) await deleteObject(key);
}

type StoreResult = { kind: "stored"; asset: AssetRow } | { kind: "refused"; error: ApiError };

/** Conflicts known before any bytes are written: a rejected asset, or different bytes for a stored file. */
export function storeConflict(asset: AssetRow, file: AssetFileRow, bytes: Buffer): ApiError | null {
  if (asset.state === "rejected") return fail.conflict("asset_rejected", "This asset was rejected; declare it again.");
  if (file.state === "stored" && sha256Hex(bytes) !== file.sha256) {
    return fail.conflict("file_already_stored", "This file is already stored with different bytes.");
  }
  return null;
}

/**
 * The storage-confirmation rule. The object is written with the declared SHA-256 as its checksum
 * so storage refuses other bytes; the file is stored only when storage then reports the declared
 * size and SHA-256. Any mismatch rejects the asset and deletes every object under its prefix. The
 * asset is stored exactly once, when its last file is, with one stored time; a flight track must
 * also parse. The caller holds the asset row lock (loadAsset with lock).
 */
export async function storeFile(
  db: Db,
  corridor: CorridorRecord,
  asset: AssetRow,
  file: AssetFileRow,
  bytes: Buffer,
): Promise<StoreResult> {
  const prefix = objectPrefix(corridor.tenantId, corridor.id, asset.id);
  if (file.state === "stored") return { kind: "stored", asset };
  if (bytes.length !== file.size_bytes) {
    await rejectAsset(db, asset, prefix, "checksum_mismatch");
    return { kind: "refused", error: fail.checksumMismatch("size_bytes") };
  }
  if (!monitor.storageOk()) throw fail.storageUnavailable();
  try {
    await putObject(prefix + file.path, bytes, file.sha256, contentTypeFor(file.path));
  } catch (error) {
    if (!(error instanceof StorageChecksumRefused)) throw error;
    await rejectAsset(db, asset, prefix, "checksum_mismatch");
    return { kind: "refused", error: fail.checksumMismatch("sha256") };
  }
  const reported = await statObject(prefix + file.path);
  if (reported.sizeBytes !== file.size_bytes || reported.sha256 !== file.sha256) {
    await rejectAsset(db, asset, prefix, "checksum_mismatch");
    return { kind: "refused", error: reported.sizeBytes !== file.size_bytes ? fail.checksumMismatch("size_bytes") : fail.checksumMismatch("sha256") };
  }
  await db.query("UPDATE asset_files SET state = 'stored' WHERE asset_id = $1 AND path = $2", [asset.id, file.path]);

  const remaining = await db.query("SELECT 1 FROM asset_files WHERE asset_id = $1 AND state <> 'stored' LIMIT 1", [asset.id]);
  if (remaining.rowCount !== 0) return { kind: "stored", asset };
  if (asset.kind === "czml") {
    const track = parseTrack(bytes, corridor.line);
    if (track === null) {
      await rejectAsset(db, asset, prefix, "invalid_czml");
      return { kind: "refused", error: fail.invalidCzml() };
    }
    await writeTrack(db, asset.id, track);
  }
  const stored = await db.query<AssetRow>(
    `UPDATE assets SET state = 'stored', stored_at = clock_timestamp() WHERE id = $1 AND state = 'pending'
     RETURNING ${ASSET_COLUMNS}`,
    [asset.id],
  );
  return { kind: "stored", asset: firstRow(stored) };
}
