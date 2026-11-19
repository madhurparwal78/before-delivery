import { createHash, randomUUID } from "node:crypto";
import { recordActivity } from "./activity.ts";
import { CAN_EDIT, isUuid, OWNER_ONLY, requireMember, requireRole, roleIn } from "./access.ts";
import type { Database, Queryable } from "./db.ts";
import { rows } from "./db.ts";
import { ApiError, assetNotReady, notFound, storageUnavailable, validation, writeJson } from "./errors.ts";
import type { Router } from "./http.ts";
import { requireUser } from "./http.ts";
import type { Storage } from "./storage.ts";
import { StorageDown } from "./storage.ts";
import type { AssetDoc, AssetKind, AssetStatus, Dependents } from "../shared/types.ts";

type AssetState = AssetStatus | "deleted";

const ASSET_TRANSITIONS: Record<AssetState, readonly AssetState[]> = {
  uploading: ["ready", "upload failed"],
  ready: ["deleted"],
  "upload failed": ["deleted"],
  deleted: [],
};

export function assetKey(setId: string, assetId: string): string {
  return `sets/${setId}/assets/${assetId}`;
}

interface AssetRow {
  id: string;
  name: string;
  kind: AssetKind;
  size: number;
  sha256: string;
  status: AssetStatus;
  content_type: string;
  created_at: Date;
  dep_layers: { id: string; name: string }[];
  dep_materials: { layer_id: string; name: string }[];
  dep_scripts: { id: string; name: string }[];
}

const ASSET_SELECT = `
  SELECT a.id, a.name, a.kind, a.size, a.sha256, a.status, a.content_type, a.created_at,
    COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name) ORDER BY l.name, l.id)
              FROM layers l WHERE l.set_id = a.set_id AND l.model_asset_id = a.id), '[]'::json) AS dep_layers,
    COALESCE((SELECT json_agg(json_build_object('layer_id', l.id, 'name', l.name) ORDER BY l.name, l.id)
              FROM layers l WHERE l.set_id = a.set_id
                AND (l.material->>'albedo_texture_id' = a.id::text OR l.material->>'emissive_texture_id' = a.id::text)),
             '[]'::json) AS dep_materials,
    COALESCE((SELECT json_agg(json_build_object('id', sc.id, 'name', sc.name) ORDER BY sc.name, sc.id)
              FROM scripts sc WHERE sc.set_id = a.set_id AND sc.asset_ids ? a.id::text), '[]'::json) AS dep_scripts
  FROM assets a`;

function dependentsOf(row: AssetRow): Dependents {
  return {
    count: row.dep_layers.length + row.dep_materials.length + row.dep_scripts.length,
    layers: row.dep_layers,
    materials: row.dep_materials,
    scripts: row.dep_scripts,
  };
}

const assetDoc = (row: AssetRow): AssetDoc => ({
  id: row.id, name: row.name, kind: row.kind, size: row.size, sha256: row.sha256, status: row.status,
  created_at: row.created_at.toISOString(), dependents: dependentsOf(row),
});

export async function listAssets(q: Queryable, setId: string): Promise<AssetDoc[]> {
  return (await rows<AssetRow>(q, `${ASSET_SELECT} WHERE a.set_id = $1 ORDER BY a.created_at, a.id`, [setId])).map(assetDoc);
}

async function findAsset(q: Queryable, setId: string, assetId: string): Promise<AssetRow | null> {
  if (!isUuid(assetId)) return null;
  const [found] = await rows<AssetRow>(q, `${ASSET_SELECT} WHERE a.set_id = $1 AND a.id = $2`, [setId, assetId]);
  return found ?? null;
}

async function moveAsset(q: Queryable, id: string, from: AssetStatus, to: AssetState): Promise<void> {
  if (!ASSET_TRANSITIONS[from].includes(to)) throw new Error(`asset cannot move from ${from} to ${to}`);
  if (to === "deleted") await q.query("DELETE FROM assets WHERE id = $1", [id]);
  else await q.query("UPDATE assets SET status = $2 WHERE id = $1", [id, to]);
}

export function sniff(kind: AssetKind, bytes: Buffer): string | null {
  if (kind === "model") return bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "glTF" && bytes.readUInt32LE(4) === 2 ? "model/gltf-binary" : null;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg" : null;
}

async function insertUploading(
  q: Queryable,
  asset: { id: string; setId: string; name: string; kind: AssetKind; size: number; sha256: string; contentType: string },
): Promise<void> {
  await q.query(
    "INSERT INTO assets (id, set_id, name, kind, size, sha256, status, content_type) VALUES ($1,$2,$3,$4,$5,$6,'uploading',$7)",
    [asset.id, asset.setId, asset.name, asset.kind, asset.size, asset.sha256, asset.contentType],
  );
}

/** Records an asset whose bytes were already stored and confirmed, moving it uploading → ready like an upload does. */
export async function registerReadyAsset(
  q: Queryable,
  asset: { id: string; setId: string; name: string; kind: AssetKind; bytes: Buffer; contentType: string; sha256: string },
): Promise<void> {
  await insertUploading(q, { ...asset, size: asset.bytes.length });
  await moveAsset(q, asset.id, "uploading", "ready");
}

export class Assets {
  private readonly db: Database;
  private readonly storage: Storage;

  constructor(db: Database, storage: Storage) {
    this.db = db;
    this.storage = storage;
  }

  register(router: Router): void {
    router.add("POST", "/api/sets/:id/assets", { body: "upload" }, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, CAN_EDIT);
      const user = requireUser(ctx);
      const kind = ctx.form?.fields.get("kind");
      const file = ctx.form?.file;
      if (kind !== "model" && kind !== "texture") throw validation({ kind: "Kind must be model or texture" });
      if (!file || file.bytes.length === 0) throw validation({ file: "Choose a file to upload" });
      const contentType = sniff(kind, file.bytes);
      if (!contentType) throw validation({ file: kind === "model" ? "Models must be binary glTF (.glb)" : "Textures must be PNG or JPEG" });
      const id = randomUUID();
      const name = (file.filename.split(/[\\/]/).pop() ?? "").trim().slice(0, 80) || "asset";
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      await insertUploading(this.db, { id, setId: membership.setId, name, kind, size: file.bytes.length, sha256, contentType });
      try {
        await this.storage.putConfirmed(assetKey(membership.setId, id), file.bytes, contentType);
      } catch (error) {
        if (!(error instanceof StorageDown)) throw error;
        await moveAsset(this.db, id, "uploading", "upload failed");
        await recordActivity(this.db, membership.setId, user.id, "asset.upload", id, `Upload of ${name} failed`);
        const failed = await findAsset(this.db, membership.setId, id);
        throw storageUnavailable({ asset: failed ? assetDoc(failed) : undefined });
      }
      await moveAsset(this.db, id, "uploading", "ready");
      await recordActivity(this.db, membership.setId, user.id, "asset.upload", id, `Uploaded ${name}`);
      const ready = await findAsset(this.db, membership.setId, id);
      writeJson(ctx.res, 201, { asset: ready ? assetDoc(ready) : undefined });
    });

    router.add("GET", "/api/sets/:id/assets", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      writeJson(ctx.res, 200, { assets: await listAssets(this.db, membership.setId) });
    });

    router.add("GET", "/api/assets/:assetId/content", {}, async (ctx) => {
      const user = requireUser(ctx);
      const assetId = ctx.params["assetId"] ?? "";
      const [found] = isUuid(assetId) ? await rows<{ set_id: string }>(this.db, "SELECT set_id FROM assets WHERE id = $1", [assetId]) : [];
      if (!found || !(await roleIn(this.db, found.set_id, user.id))) throw notFound();
      const asset = await findAsset(this.db, found.set_id, assetId);
      if (!asset) throw notFound();
      if (asset.status !== "ready") throw assetNotReady(asset.name);
      const bytes = await this.readObject(found.set_id, assetId);
      ctx.res.writeHead(200, {
        "content-type": asset.content_type, "content-length": bytes.length, "X-Content-SHA256": asset.sha256, "cache-control": "private, max-age=3600",
      });
      ctx.res.end(bytes);
    });

    router.add("DELETE", "/api/sets/:id/assets/:assetId", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const user = requireUser(ctx);
      const asset = await findAsset(this.db, membership.setId, ctx.params["assetId"] ?? "");
      if (!asset) throw notFound();
      requireRole(membership, OWNER_ONLY);
      if (asset.status === "uploading") throw assetNotReady(asset.name);
      const dependents = dependentsOf(asset);
      if (dependents.count > 0) throw new ApiError(409, "asset_in_use", `${asset.name} is still in use`, { dependents });
      const shows = await rows<{ number: number }>(this.db, 
        "SELECT number FROM show_versions WHERE set_id = $1 AND status IN ('published','storing') AND asset_ids ? $2 ORDER BY number",
        [membership.setId, asset.id],
      );
      if (shows.length > 0) {
        throw new ApiError(409, "asset_in_shows", `${asset.name} is part of published show versions`, { show_versions: shows.map((row) => row.number) });
      }
      try {
        await this.storage.remove(assetKey(membership.setId, asset.id));
      } catch (error) {
        if (!(error instanceof StorageDown)) throw error;
        if (asset.status === "ready") throw storageUnavailable();
      }
      await moveAsset(this.db, asset.id, asset.status, "deleted");
      await recordActivity(this.db, membership.setId, user.id, "asset.delete", asset.id, `Deleted ${asset.name}`);
      ctx.res.writeHead(204);
      ctx.res.end();
    });
  }

  async readObject(setId: string, assetId: string): Promise<Buffer> {
    try {
      const bytes = await this.storage.get(assetKey(setId, assetId));
      if (!bytes) throw notFound();
      return bytes;
    } catch (error) {
      if (error instanceof StorageDown) throw storageUnavailable();
      throw error;
    }
  }
}

