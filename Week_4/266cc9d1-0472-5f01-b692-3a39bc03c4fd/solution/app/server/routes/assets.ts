// Asset declaration, upload with storage confirmation, and byte-exact file reads.
import type { Db } from "../db.js";
import {
  ASSET_COLUMNS,
  assetJson,
  contentTypeFor,
  declareAsset,
  fileJson,
  filesOf,
  loadAsset,
  objectPrefix,
  storeConflict,
  storeFile,
  validateManifest,
  type AssetFileRow,
  type AssetRow,
} from "../domain/assets.js";
import { loadCorridor, type CorridorRecord } from "../domain/corridor.js";
import { fail } from "../http/errors.js";
import { errorReply, json, noInput, staffRoute, type BaseContext, type Reply, type Route } from "../http/pipeline.js";
import { monitor } from "../monitor.js";
import { getObject } from "../storage.js";

interface StoredFile {
  corridor: CorridorRecord;
  asset: AssetRow;
  file: AssetFileRow;
}

/** A stored file of the tenant's asset (optionally of one corridor); anything else answers 404. */
export async function loadStoredFile(db: Db, tenantId: string, assetId: string, path: string, corridorId?: string): Promise<StoredFile> {
  const asset = await loadAsset(db, tenantId, assetId, false);
  if (corridorId !== undefined && asset.corridor_id !== corridorId) throw fail.notFound();
  const file = (await filesOf(db, asset.id)).find((f) => f.path === path);
  if (file === undefined || file.state !== "stored") throw fail.notFound();
  return { corridor: await loadCorridor(db, tenantId, asset.corridor_id), asset, file };
}

/** A single `bytes=a-b`, `bytes=a-` or `bytes=-n` range inside the file; other headers serve the whole file. */
export function readRange(ctx: BaseContext, sizeBytes: number): string | undefined {
  const header = ctx.req.headers.range;
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return undefined;
  const start = match[1] === "" ? sizeBytes - Number(match[2]) : Number(match[1]);
  if (start >= sizeBytes || (match[1] === "" && Number(match[2]) === 0)) throw fail.rangeNotSatisfiable();
  return `bytes=${match[1]}-${match[2]}`;
}

/** Streams the stored bytes unchanged; the ETag is the stored SHA-256. */
export async function fileReply(ctx: BaseContext, stored: StoredFile, range: string | undefined): Promise<Reply> {
  if (!monitor.storageOk()) throw fail.storageUnavailable();
  const { corridor, asset, file } = stored;
  const object = await getObject(objectPrefix(corridor.tenantId, corridor.id, asset.id) + file.path, range);
  if (object.status === 416) throw fail.rangeNotSatisfiable();
  const headers: Record<string, string> = {
    etag: `"${file.sha256}"`,
    "accept-ranges": "bytes",
    "content-type": contentTypeFor(file.path),
    "content-length": object.headers.get("content-length") ?? String(file.size_bytes),
  };
  const contentRange = object.headers.get("content-range");
  if (contentRange !== null) headers["content-range"] = contentRange;
  if (ctx.query.get("download") === "1") {
    headers["content-disposition"] = `attachment; filename="${file.path.slice(file.path.lastIndexOf("/") + 1)}"`;
  }
  if (object.body === null) return { status: object.status, headers };
  return { status: object.status, headers, stream: object.body };
}

async function assetsOf(db: Db, corridorId: string): Promise<Record<string, unknown>[]> {
  const found = await db.query<AssetRow>(
    `SELECT ${ASSET_COLUMNS} FROM assets WHERE corridor_id = $1 ORDER BY created_at DESC, id DESC`,
    [corridorId],
  );
  return Promise.all(found.rows.map(async (a) => assetJson(a, await filesOf(db, a.id))));
}

export const assetRoutes: Route[] = [
  staffRoute({
    method: "POST",
    path: "/api/corridors/:id/assets",
    body: "manifest",
    role: "survey_processor",
    load: (ctx) => loadCorridor(ctx.db, ctx.staff.tenantId, ctx.params.id ?? ""),
    validate: (ctx) => {
      const manifest = validateManifest(ctx.json);
      if ("fields" in manifest) throw fail.validation(manifest.fields);
      return manifest;
    },
    perform: async (ctx, corridor, manifest) => {
      const asset = await declareAsset(ctx.db, corridor.id, manifest.kind, manifest.files);
      return json(201, { asset: assetJson(asset, await filesOf(ctx.db, asset.id)) });
    },
  }),

  staffRoute({
    method: "GET",
    path: "/api/corridors/:id/assets",
    load: (ctx) => loadCorridor(ctx.db, ctx.staff.tenantId, ctx.params.id ?? ""),
    validate: noInput,
    perform: async (ctx, corridor) => json(200, { assets: await assetsOf(ctx.db, corridor.id) }),
  }),

  staffRoute({
    method: "GET",
    path: "/api/assets/:id",
    load: (ctx) => loadAsset(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", false),
    validate: noInput,
    perform: async (ctx, asset) => json(200, { asset: assetJson(asset, await filesOf(ctx.db, asset.id)) }),
  }),

  staffRoute({
    method: "PUT",
    path: "/api/assets/:id/files/*path",
    body: "file",
    role: "survey_processor",
    load: async (ctx) => {
      const asset = await loadAsset(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", true);
      const file = (await filesOf(ctx.db, asset.id)).find((f) => f.path === ctx.params.path);
      if (file === undefined) throw fail.notFound();
      return { asset, file, corridor: await loadCorridor(ctx.db, ctx.staff.tenantId, asset.corridor_id) };
    },
    conflict: (ctx, { asset, file }) => {
      const conflict = storeConflict(asset, file, ctx.bytes);
      if (conflict !== null) throw conflict;
    },
    validate: noInput,
    perform: async (ctx, { asset, file, corridor }) => {
      const result = await storeFile(ctx.db, corridor, asset, file, ctx.bytes);
      if (result.kind === "refused") return errorReply(result.error);
      const files = await filesOf(ctx.db, asset.id);
      const stored = files.find((f) => f.path === file.path) ?? file;
      return json(200, { asset: assetJson(result.asset, files), file: fileJson(stored) });
    },
  }),

  staffRoute({
    method: "GET",
    path: "/api/assets/:id/files/*path",
    load: (ctx) => loadStoredFile(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", ctx.params.path ?? ""),
    validate: (ctx, stored) => readRange(ctx, stored.file.size_bytes),
    perform: (ctx, stored, range) => fileReply(ctx, stored, range),
  }),
];
