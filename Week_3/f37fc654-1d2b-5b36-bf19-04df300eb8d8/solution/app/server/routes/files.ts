// Venue files (brief: API › Files, Business rules › Uploads).
import { createHash, randomUUID } from "node:crypto";
import { requireCaller } from "../auth.js";
import { commissionFor } from "../commissions.js";
import { one, pool, query } from "../db.js";
import { ApiError, fail, invalid, ok, UUID, type Request, type Router } from "../http.js";
import { getObject, putObject } from "../providers/s3.js";
import { cleanFileName } from "../../shared/format.js";
import { FILE_KINDS, contentTypeFor, type FileKind } from "../rules/content.js";

const MULTIPART_SLACK = 65_536;
const UPLOAD_LIMIT = FILE_KINDS.installation_glb.limitBytes + MULTIPART_SLACK;

interface Part {
  name: string;
  fileName: string | null;
  data: Buffer;
}

function multipart(req: Request): Part[] {
  const type = req.headers["content-type"] ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!/^multipart\/form-data/i.test(type) || !boundary) return [];
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let at = req.raw.indexOf(marker);
  while (at !== -1) {
    const start = at + marker.length;
    if (req.raw.subarray(start, start + 2).toString() === "--") break;
    const headerEnd = req.raw.indexOf("\r\n\r\n", start);
    const next = req.raw.indexOf(marker, headerEnd);
    if (headerEnd === -1 || next === -1) break;
    const headers = req.raw.subarray(start, headerEnd).toString("utf8");
    const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? "";
    const fileName = /filename="([^"]*)"/i.exec(headers)?.[1] ?? null;
    parts.push({ name, fileName, data: req.raw.subarray(headerEnd + 4, next - 2) });
    at = next;
  }
  return parts;
}

interface FileRow {
  id: string; commission_id: string; kind: FileKind; file_name: string; content_type: string; size_bytes: number; sha256: string; status: string; created_at: Date;
}

const fileView = (f: FileRow) => ({
  id: f.id, kind: f.kind, fileName: f.file_name, contentType: f.content_type, sizeBytes: f.size_bytes, sha256: f.sha256, status: f.status, createdAt: f.created_at.toISOString(),
});

export const fileKey = (commissionId: string, fileId: string): string => `commissions/${commissionId}/files/${fileId}`;

async function upload(req: Request) {
  const parts = multipart(req);
  const kindPart = parts.find((p) => p.name === "kind");
  const filePart = parts.find((p) => p.name === "file");
  const kind = kindPart?.data.toString("utf8").trim() ?? "";
  const known = kind in FILE_KINDS ? FILE_KINDS[kind as FileKind] : null;
  const shown = cleanFileName(filePart?.fileName ?? "file");
  if (known && filePart && filePart.data.length > known.limitBytes) {
    throw new ApiError(413, { error: { code: "file_too_large", message: `${shown} is over the ${known.limitBytes}-byte limit for a ${known.label}.`, limitBytes: known.limitBytes } });
  }
  if (known && req.raw.length > known.limitBytes + MULTIPART_SLACK) fail(413, "body_too_large");
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  if (!known) invalid({ kind: "Pick brief_pdf, venue_photo or installation_glb." });
  const contentType = filePart && filePart.data.length ? contentTypeFor(kind as FileKind, filePart.data) : null;
  if (!filePart || !contentType) invalid({ file: `${shown} isn't a ${known.label}.` });
  const id = randomUUID();
  await putObject(fileKey(c.id, id), filePart.data, contentType);
  const row = await one<FileRow & Record<string, unknown>>(
    `INSERT INTO files (id, commission_id, kind, file_name, content_type, size_bytes, sha256, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'stored') RETURNING *`,
    [id, c.id, kind, shown, contentType, filePart.data.length, createHash("sha256").update(filePart.data).digest("hex")],
  );
  return ok(fileView(row as FileRow), 201);
}

async function list(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const rows = await query<FileRow & Record<string, unknown>>("SELECT * FROM files WHERE commission_id = $1 ORDER BY created_at", [c.id]);
  return ok({ files: rows.map(fileView) });
}

async function content(req: Request) {
  const caller = await requireCaller(req);
  if (!UUID.test(req.params.id)) fail(404, "not_found");
  const file = await one<FileRow & Record<string, unknown>>("SELECT * FROM files WHERE id = $1", [req.params.id]);
  if (!file) fail(404, "not_found");
  await commissionFor(pool, caller, file.commission_id, ["owner", "producer"]);
  const bytes = await getObject(fileKey(file.commission_id, file.id));
  return { status: 200, bytes, headers: { "Content-Type": file.content_type, "Cache-Control": "private, no-store" } };
}

export function registerFiles(router: Router): void {
  router.add("POST", "/api/commissions/:id/files", upload, UPLOAD_LIMIT);
  router.add("GET", "/api/commissions/:id/files", list);
  router.add("GET", "/api/files/:id/content", content);
}
