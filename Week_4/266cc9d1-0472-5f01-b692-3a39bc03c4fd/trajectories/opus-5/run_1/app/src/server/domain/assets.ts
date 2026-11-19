/**
 * Survey assets: manifest declaration, the storage-confirmation rule and reads.
 * A file is stored only once object storage reports the declared size and digest.
 */

import { LIMITS } from "../config.js";
import { query, queryOne, withTransaction, type Tx } from "../db.js";
import {
  ApiError,
  FIELD_MESSAGES,
  checksumMismatch,
  conflict,
  invalidCzml,
  notFound,
  validationFailed,
  type FieldErrors,
} from "../errors.js";
import { newId } from "../ids.js";
import {
  ObjectWriteRejected,
  assetObjectKey,
  assetPrefix,
  deleteObject,
  getObject,
  headObject,
  listKeys,
  putObject,
  sha256Hex,
} from "../services/storage.js";
import { parseCzml, storeTrack } from "./flight.js";
import type { CorridorGeometry } from "../../shared/corridor.js";
import type { AssetKind } from "../../shared/format.js";

export interface AssetRow {
  id: string;
  tenant_id: string;
  corridor_id: string;
  kind: AssetKind;
  state: "pending" | "stored" | "rejected";
  rejected_reason: string | null;
  created_at: Date;
  stored_at: Date | null;
}

export interface AssetFileRow {
  path: string;
  size_bytes: string | number;
  sha256: string;
  state: "pending" | "stored" | "rejected";
}

export interface ManifestFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

function validPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return false;
  const segments = value.split("/");
  return segments.every(
    (segment) => PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..",
  );
}

/** Validates a declared manifest, reporting every bad field at once. */
export function validateManifest(body: unknown): { kind: AssetKind; files: ManifestFile[] } {
  const fields: FieldErrors = {};
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const kind = record.kind;
  const validKind = kind === "tileset" || kind === "terrain" || kind === "czml";
  if (!validKind) fields.kind = FIELD_MESSAGES.assetKind;

  const rawFiles = record.files;
  const files: ManifestFile[] = [];
  if (
    !Array.isArray(rawFiles) ||
    rawFiles.length < 1 ||
    rawFiles.length > LIMITS.maxManifestFiles
  ) {
    fields.files = FIELD_MESSAGES.filesCount;
  } else {
    rawFiles.forEach((entry, index) => {
      const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
        string,
        unknown
      >;
      if (!validPath(item.path)) fields[`files.${index}.path`] = FIELD_MESSAGES.filePath;
      const sizeBytes = item.size_bytes;
      if (
        typeof sizeBytes !== "number" ||
        !Number.isInteger(sizeBytes) ||
        sizeBytes < 1 ||
        sizeBytes > LIMITS.fileBodyBytes
      ) {
        fields[`files.${index}.size_bytes`] = FIELD_MESSAGES.fileSize;
      }
      if (typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) {
        fields[`files.${index}.sha256`] = FIELD_MESSAGES.fileSha256;
      }
      if (
        validPath(item.path) &&
        typeof sizeBytes === "number" &&
        typeof item.sha256 === "string"
      ) {
        files.push({ path: item.path, sizeBytes, sha256: item.sha256 });
      }
    });

    if (files.length === rawFiles.length) {
      const paths = new Set(files.map((file) => file.path));
      if (paths.size !== files.length) {
        fields.files = FIELD_MESSAGES.filesUnique;
      } else if (validKind) {
        if (kind === "tileset" && !paths.has("tileset.json")) {
          fields.files = FIELD_MESSAGES.filesTileset;
        } else if (kind === "terrain" && !paths.has("layer.json")) {
          fields.files = FIELD_MESSAGES.filesTerrain;
        } else if (
          kind === "czml" &&
          (files.length !== 1 || !files[0].path.toLowerCase().endsWith(".czml"))
        ) {
          fields.files = FIELD_MESSAGES.filesCzml;
        }
      }
    }
  }

  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return { kind: kind as AssetKind, files };
}

export async function declareAsset(
  tenantId: string,
  corridorId: string,
  kind: AssetKind,
  files: ManifestFile[],
  assetId = newId("ast"),
): Promise<AssetRow> {
  return withTransaction(async (tx) => {
    const asset = await tx.queryOne<AssetRow>(
      `INSERT INTO assets (id, tenant_id, corridor_id, kind, state)
       VALUES ($1,$2,$3,$4,'pending')
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [assetId, tenantId, corridorId, kind],
    );
    for (const [position, file] of files.entries()) {
      await tx.query(
        `INSERT INTO asset_files (asset_id, path, size_bytes, sha256, state, position)
         VALUES ($1,$2,$3,$4,'pending',$5)
         ON CONFLICT (asset_id, path) DO NOTHING`,
        [assetId, file.path, file.sizeBytes, file.sha256, position],
      );
    }
    if (asset) return asset;
    const existing = await tx.queryOne<AssetRow>("SELECT * FROM assets WHERE id = $1", [assetId]);
    if (!existing) throw notFound();
    return existing;
  });
}

export async function findAsset(assetId: string): Promise<AssetRow | null> {
  return queryOne<AssetRow>("SELECT * FROM assets WHERE id = $1", [assetId]);
}

export async function listAssetFiles(assetId: string): Promise<AssetFileRow[]> {
  return query<AssetFileRow>(
    `SELECT path, size_bytes, sha256, state FROM asset_files
     WHERE asset_id = $1 ORDER BY position, path`,
    [assetId],
  );
}

export interface AssetPayload {
  id: string;
  corridor_id: string;
  kind: AssetKind;
  state: string;
  rejected_reason: string | null;
  files: { path: string; size_bytes: number; sha256: string; state: string }[];
  created_at: string;
  stored_at: string | null;
}

export async function assetPayload(asset: AssetRow): Promise<AssetPayload> {
  const files = await listAssetFiles(asset.id);
  return {
    id: asset.id,
    corridor_id: asset.corridor_id,
    kind: asset.kind,
    state: asset.state,
    rejected_reason: asset.rejected_reason,
    files: files.map((file) => ({
      path: file.path,
      size_bytes: Number(file.size_bytes),
      sha256: file.sha256,
      state: file.state,
    })),
    created_at: asset.created_at.toISOString(),
    stored_at: asset.stored_at ? asset.stored_at.toISOString() : null,
  };
}

export async function listCorridorAssets(corridorId: string): Promise<AssetRow[]> {
  return query<AssetRow>(
    "SELECT * FROM assets WHERE corridor_id = $1 ORDER BY created_at DESC, id DESC",
    [corridorId],
  );
}

export async function activeAssets(
  corridorId: string,
): Promise<{ tileset: string | null; terrain: string | null; czml: string | null }> {
  const rows = await query<{ kind: AssetKind; id: string }>(
    `SELECT kind, id FROM assets
     WHERE corridor_id = $1 AND state = 'stored'
     ORDER BY stored_at DESC, id DESC`,
    [corridorId],
  );
  const pick = (kind: AssetKind): string | null => rows.find((row) => row.kind === kind)?.id ?? null;
  return { tileset: pick("tileset"), terrain: pick("terrain"), czml: pick("czml") };
}

/** Rejects the asset and removes every object already written under its prefix. */
async function rejectAsset(
  asset: AssetRow,
  reason: "checksum_mismatch" | "invalid_czml",
  path: string | null,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE assets SET state = 'rejected', rejected_reason = $2, stored_at = NULL
       WHERE id = $1 AND state <> 'rejected'`,
      [asset.id, reason],
    );
    await tx.query(
      "UPDATE asset_files SET state = 'rejected' WHERE asset_id = $1 AND state <> 'rejected'",
      [asset.id],
    );
    if (path) {
      await tx.query("UPDATE asset_files SET state = 'rejected' WHERE asset_id = $1 AND path = $2", [
        asset.id,
        path,
      ]);
    }
  });
  const prefix = assetPrefix(asset.tenant_id, asset.corridor_id, asset.id);
  for (const key of await listKeys(prefix)) {
    await deleteObject(key);
  }
}

export interface StoreFileResult {
  asset: AssetRow;
  file: AssetFileRow;
}

/**
 * Writes one declared file and confirms it with object storage. The asset
 * becomes stored exactly once, when every file in its manifest is stored.
 */
export async function storeAssetFile(
  asset: AssetRow,
  path: string,
  bytes: Uint8Array,
  corridor: CorridorGeometry,
): Promise<StoreFileResult> {
  const manifest = await queryOne<AssetFileRow>(
    "SELECT path, size_bytes, sha256, state FROM asset_files WHERE asset_id = $1 AND path = $2",
    [asset.id, path],
  );
  if (!manifest) throw notFound();
  if (asset.state === "rejected") {
    throw conflict("asset_rejected", "This asset was rejected and cannot take more files.");
  }

  const key = assetObjectKey(asset.tenant_id, asset.corridor_id, asset.id, path);
  const declaredSize = Number(manifest.size_bytes);

  if (manifest.state === "stored") {
    const existing = await getObject(key);
    if (existing && Buffer.from(existing).equals(Buffer.from(bytes))) {
      return { asset, file: manifest };
    }
    throw conflict("file_already_stored", "This file is already stored with different bytes.");
  }

  if (bytes.byteLength !== declaredSize) {
    await rejectAsset(asset, "checksum_mismatch", path);
    throw checksumMismatch("size_bytes");
  }

  try {
    await putObject(key, bytes, manifest.sha256);
  } catch (error) {
    if (error instanceof ObjectWriteRejected) {
      await rejectAsset(asset, "checksum_mismatch", path);
      throw checksumMismatch("sha256");
    }
    throw error;
  }

  const facts = await headObject(key);
  if (!facts || facts.sizeBytes !== declaredSize) {
    await rejectAsset(asset, "checksum_mismatch", path);
    throw checksumMismatch("size_bytes");
  }
  if (facts.sha256Hex !== manifest.sha256) {
    await rejectAsset(asset, "checksum_mismatch", path);
    throw checksumMismatch("sha256");
  }

  let parsedTrack: ReturnType<typeof parseCzml> | null = null;
  if (asset.kind === "czml") {
    try {
      parsedTrack = parseCzml(bytes, corridor);
    } catch (error) {
      await rejectAsset(asset, "invalid_czml", path);
      if (error instanceof ApiError) throw error;
      throw invalidCzml();
    }
  }

  const result = await withTransaction(async (tx) => {
    const locked = await tx.queryOne<AssetRow>("SELECT * FROM assets WHERE id = $1 FOR UPDATE", [
      asset.id,
    ]);
    if (!locked) throw notFound();
    if (locked.state === "rejected") return null;

    await tx.query(
      "UPDATE asset_files SET state = 'stored' WHERE asset_id = $1 AND path = $2 AND state = 'pending'",
      [asset.id, path],
    );
    const pending = await tx.queryOne<{ count: string }>(
      "SELECT count(*)::text AS count FROM asset_files WHERE asset_id = $1 AND state <> 'stored'",
      [asset.id],
    );
    if (Number(pending?.count ?? "1") === 0 && locked.state === "pending") {
      if (parsedTrack) await storeTrack(tx, asset.id, parsedTrack);
      await tx.query(
        "UPDATE assets SET state = 'stored', stored_at = now() WHERE id = $1 AND state = 'pending'",
        [asset.id],
      );
    }
    const updatedAsset = await tx.queryOne<AssetRow>("SELECT * FROM assets WHERE id = $1", [
      asset.id,
    ]);
    const updatedFile = await tx.queryOne<AssetFileRow>(
      "SELECT path, size_bytes, sha256, state FROM asset_files WHERE asset_id = $1 AND path = $2",
      [asset.id, path],
    );
    return { asset: updatedAsset!, file: updatedFile! };
  });

  if (!result) {
    await deleteObject(key);
    throw conflict("asset_rejected", "This asset was rejected and cannot take more files.");
  }
  return result;
}

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json",
  czml: "application/json",
  glb: "model/gltf-binary",
  ktx2: "image/ktx2",
  terrain: "application/vnd.quantized-mesh",
};

export function contentTypeForPath(path: string): string {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export async function storedFile(assetId: string, path: string): Promise<AssetFileRow | null> {
  return queryOne<AssetFileRow>(
    `SELECT path, size_bytes, sha256, state FROM asset_files
     WHERE asset_id = $1 AND path = $2 AND state = 'stored'`,
    [assetId, path],
  );
}
