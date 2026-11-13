import { createHash } from "node:crypto";
import { COPY } from "../shared/copy";
import { MAX_EXTENT, MIN_EXTENT, MODEL_ERROR_COPY, UNIT_SCALE, UPLOAD_UNITS, extentOf, modelBounds, parseModel } from "../shared/gltf";
import { CAN_EDIT, logActivity, projectAccess, requireMember, requireRole } from "./access";
import { pool, one, tx } from "./db";
import { notFound, storageUnavailable, validation } from "./errors";
import { route, type Ctx, type Reply } from "./http";
import { newId } from "./ids";
import { assetJson, type AssetRow } from "./scenes";
import { s3 } from "./services/s3";

type AssetKind = "glb" | "gltf" | "png" | "jpeg";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NAME_MAX = 120;

const ASSET_CONTENT_TYPE: Record<string, string> = { glb: "model/gltf-binary", gltf: "model/gltf+json", png: "image/png", jpeg: "image/jpeg" };

function validFileName(name: string | null): name is string {
  if (name === null || [...name].length < 1 || [...name].length > NAME_MAX) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return ![...name].some((char) => {
    const code = char.codePointAt(0) as number;
    return code <= 0x1f || code === 0x7f;
  });
}

interface Classified {
  kind: AssetKind;
  extentMetres: number | null;
  scale: number | null;
  unit: string | null;
}

function classify(bytes: Buffer, unit: string, fields: Record<string, string>): Classified | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return { kind: "png", extentMetres: null, scale: null, unit: null };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "jpeg", extentMetres: null, scale: null, unit: null };
  const model = parseModel(bytes);
  if (!model.ok) {
    fields.file = MODEL_ERROR_COPY[model.error];
    return null;
  }
  const bounds = modelBounds(model.json);
  if (!bounds) {
    fields.file = COPY.uploadDamaged;
    return null;
  }
  if (!(UPLOAD_UNITS as readonly string[]).includes(unit)) {
    fields.unit = COPY.uploadUnit;
    return null;
  }
  const scale = UNIT_SCALE[unit];
  const extent = extentOf(bounds) * scale;
  if (extent < MIN_EXTENT || extent > MAX_EXTENT) {
    fields.file = COPY.uploadExtent;
    return null;
  }
  return { kind: model.kind, extentMetres: extent, scale, unit };
}

async function uploadAsset(ctx: Ctx): Promise<Reply> {
  const project = await projectAccess(ctx.params.pid, ctx.user);
  requireRole(project.role, CAN_EDIT);
  const sha256 = createHash("sha256").update(ctx.raw).digest("hex");
  const existing = await one<AssetRow>(pool, "SELECT * FROM assets WHERE project_id = $1 AND sha256 = $2", [ctx.params.pid, sha256]);
  if (existing) return { status: 200, json: { asset: assetJson(existing) } };
  await s3.ping();
  const fields: Record<string, string> = {};
  const name = ctx.query.get("name");
  if (!validFileName(name)) fields.name = COPY.uploadName;
  const unit = ctx.query.get("unit") ?? "m";
  const classified = classify(ctx.raw, unit, fields);
  if (!classified && !fields.file && !fields.unit) fields.file = COPY.uploadType;
  if (Object.keys(fields).length > 0 || !classified) throw validation(fields);
  await s3.put(`assets/${ctx.params.pid}/${sha256}`, ctx.raw);
  const id = newId();
  const created = await tx(async (db) => {
    const row = await one<AssetRow>(
      db,
      `INSERT INTO assets (id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (project_id, sha256) DO NOTHING RETURNING *`,
      [id, ctx.params.pid, name, classified.kind, ctx.raw.length, sha256, classified.unit, classified.scale, classified.extentMetres, ctx.now],
    );
    if (!row) return null;
    await db.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [ctx.params.pid, ctx.now]);
    await logActivity(db, project.workspaceId, ctx.user.id, "asset.uploaded", name as string, ctx.now);
    return row;
  });
  if (!created) {
    const winner = (await one<AssetRow>(pool, "SELECT * FROM assets WHERE project_id = $1 AND sha256 = $2", [ctx.params.pid, sha256])) as AssetRow;
    return { status: 200, json: { asset: assetJson(winner) } };
  }
  return { status: 201, json: { asset: assetJson(created) } };
}

export async function assetBytesReply(projectId: string, asset: Pick<AssetRow, "kind" | "sha256">): Promise<Reply> {
  const bytes = await s3.get(`assets/${projectId}/${asset.sha256}`);
  if (!bytes) throw storageUnavailable();
  return { status: 200, bytes, headers: { "content-type": ASSET_CONTENT_TYPE[asset.kind], etag: `"${asset.sha256}"`, "cache-control": "private, max-age=0, must-revalidate" } };
}

async function downloadOriginal(ctx: Ctx): Promise<Reply> {
  const asset = await one<AssetRow & { project_id: string; workspace_id: string }>(
    pool,
    "SELECT a.*, p.workspace_id FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.id = $1",
    [ctx.params.aid],
  );
  if (!asset) throw notFound();
  await requireMember(asset.workspace_id, ctx.user);
  return assetBytesReply(asset.project_id, asset);
}

export function registerAssetRoutes(): void {
  route("POST", "/api/projects/:pid/assets", uploadAsset, { upload: true });
  route("GET", "/api/assets/:aid/original", downloadOriginal);
}
