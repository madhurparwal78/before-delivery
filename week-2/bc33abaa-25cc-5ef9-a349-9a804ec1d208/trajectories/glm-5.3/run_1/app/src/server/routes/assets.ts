import { Router } from "express";
import { randomBytes } from "node:crypto";
import { query } from "../db";
import { errors, requireAuth, assertNotReadOnly } from "../http";
import { audit } from "../audit";
import { storage } from "../services";
import type { Request } from "express";

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function canUpload(role: string): boolean {
  return role === "owner" || role === "editor";
}

/** Upload checks read the complete bytes and run in the brief's order. */
function checkUpload(kind: unknown, name: unknown, bytes: Buffer): { kind?: "model" | "texture"; error?: ReturnType<typeof errors.validation> | ReturnType<typeof errors.fileTooLarge> | ReturnType<typeof errors.unsupportedType> } {
  if (kind !== "model" && kind !== "texture") {
    return { error: errors.validation({ kind: "Kind must be model or texture" }) };
  }
  if (typeof name !== "string" || name.length < 1 || name.length > 120 || name.includes("/") || name.includes("\\") || name.includes("..") || /[\x00-\x1f]/.test(name)) {
    return { error: errors.validation({ file: "File name is not allowed" }) };
  }
  const lower = name.toLowerCase();
  if (kind === "model") {
    if (bytes.length > 20_000_000) return { error: errors.fileTooLarge(20_000_000) };
    // Binary glTF 2.0: magic "glTF", version 2, total length equals the file size.
    const isGlb =
      bytes.length >= 12 &&
      bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46 &&
      bytes.readUInt32LE(4) === 2 &&
      bytes.readUInt32LE(8) === bytes.length;
    if (!isGlb || !lower.endsWith(".glb")) return { error: errors.unsupportedType() };
    return { kind: "model" };
  }
  if (bytes.length > 8_000_000) return { error: errors.fileTooLarge(8_000_000) };
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isPng && lower.endsWith(".png")) {
    const dims = pngDimensions(bytes);
    if (!dims || dims.width > 4096 || dims.height > 4096) return { error: errors.validation({ file: "Texture is larger than 4096 by 4096 pixels" }) };
    return { kind: "texture" };
  }
  if (isJpeg && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) {
    const dims = jpegDimensions(bytes);
    if (!dims || dims.width > 4096 || dims.height > 4096) return { error: errors.validation({ file: "Texture is larger than 4096 by 4096 pixels" }) };
    return { kind: "texture" };
  }
  return { error: errors.unsupportedType() };
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  // IHDR starts at a fixed offset in a standard PNG: width at 16, height at 20.
  if (bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return { width, height };
    }
    const length = bytes.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return null;
}

assetsRouter.post("/", async (req: Request, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (!canUpload(caller.member.role)) throw errors.forbidden();
    const ws = caller.member.workspace_id;
    await assertNotReadOnly(ws);
    const kind = req.body?.kind;
    const file = req.file;
    if (!file) throw errors.validation({ file: "File is required" });
    const check = checkUpload(kind, file.originalname, file.buffer);
    if (check.error) throw check.error;
    const id = `ast_${randomBytes(9).toString("hex")}`;
    if (!(await storage().check())) throw errors.serviceUnavailable("file_storage");
    await storage().put(storage().assetKey(ws, id), file.buffer, file.mimetype || "application/octet-stream");
    await query(
      "INSERT INTO assets (id, workspace_id, kind, name, bytes, content_type, uploaded_by_id, uploaded_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, ws, check.kind, file.originalname, file.buffer.length, file.mimetype || "application/octet-stream", caller.member.id, caller.member.name],
    );
    audit(caller, "asset.uploaded", { type: "asset", id });
    res.status(201).json({ id, kind: check.kind, name: file.originalname, bytes: file.buffer.length, contentType: file.mimetype || "application/octet-stream" });
  } catch (e) {
    next(e);
  }
});

assetsRouter.get("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const rows = await query("SELECT * FROM assets WHERE workspace_id = $1 ORDER BY created_at", [ws]);
    res.json({
      assets: rows.rows.map((r) => {
        const row = r as { id: string; kind: string; name: string; bytes: number; content_type: string; uploaded_by_id: string; uploaded_by_name: string; created_at: Date };
        return {
          id: row.id,
          kind: row.kind,
          name: row.name,
          bytes: row.bytes,
          contentType: row.content_type,
          uploadedBy: { kind: "member" as const, id: row.uploaded_by_id, name: row.uploaded_by_name },
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

assetsRouter.get("/:assetId/file", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const row = (await query("SELECT * FROM assets WHERE workspace_id = $1 AND id = $2", [ws, req.params.assetId])).rows[0] as { content_type: string } | undefined;
    if (!row) throw errors.notFound();
    const data = await storage().get(storage().assetKey(ws, req.params.assetId));
    if (!data) throw errors.notFound();
    res.setHeader("Content-Type", row.content_type);
    res.send(data);
  } catch (e) {
    next(e);
  }
});
