// Object downloads from this origin: console content, share links and S3 GetObject (brief:
// Downloads from this origin).
import { pipeline } from "node:stream/promises";
import type { Ctx } from "./http.js";
import type { Bucket, Version } from "./objects.js";
import { getObject, regionObjectKey } from "./storage.js";
import { pool } from "./db.js";
import { decryptStream, unwrapForWorkspace } from "./encryption.js";

const KEEP = /[A-Za-z0-9!#$&+\-.^_`|~]/;

function contentDisposition(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  let encoded = "";
  for (const byte of Buffer.from(name, "utf8")) {
    const c = String.fromCharCode(byte);
    encoded += byte < 0x80 && KEEP.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  const fallback = [...name].map((c) => (c.codePointAt(0) ?? 0) > 0x7e || c < " " || c === '"' || c === "\\" ? "_" : c).join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function downloadHeaders(key: string): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store",
    "Content-Disposition": contentDisposition(key),
  };
}

const RISKY = new Set(["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml"]);
const isRiskyType = (type: string): boolean => RISKY.has(type) || /javascript|ecmascript/i.test(type);

// Console content and share links never send a risky type; S3 GetObject returns the recorded type.
export function servedType(version: Version, recordedForS3: boolean): string {
  return recordedForS3 || !isRiskyType(version.content_type) ? version.content_type : "application/octet-stream";
}

// Opens the origin copy before any header is sent, so a storage outage can still be refused cleanly,
// and decrypts it under the version's own data key.
export async function openVersion(bucket: Bucket, version: Version): Promise<NodeJS.ReadableStream> {
  const ciphertext = await getObject(regionObjectKey(bucket.placement[0] ?? "", bucket.name, version.version_id));
  const dataKey = await unwrapForWorkspace(pool, bucket.workspace_id, version);
  return decryptStream(ciphertext, dataKey, version.part_sizes ?? [version.size]);
}

export async function streamBody(ctx: Ctx, status: number, headers: Record<string, string | number>,
                                 body: NodeJS.ReadableStream | null): Promise<void> {
  ctx.res.statusCode = status;
  ctx.res.setHeader("Date", ctx.now.toUTCString());
  for (const [name, value] of Object.entries(headers)) ctx.res.setHeader(name, value);
  if (!body || ctx.method === "HEAD") {
    ctx.res.end();
    return;
  }
  await pipeline(body, ctx.res);
}
