/** Stored originals are read back unchanged, whole or by byte range. */

import type { Request } from "express";
import { notFound, rangeNotSatisfiable } from "../errors.js";
import { contentTypeForPath, storedFile, type AssetRow } from "../domain/assets.js";
import { assetObjectKey, getObject } from "../services/storage.js";
import type { RouteResult } from "../http.js";

interface ByteRange {
  start: number;
  end: number;
}

function parseRange(header: string | undefined, sizeBytes: number): ByteRange | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) throw rangeNotSatisfiable();
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") throw rangeNotSatisfiable();
  if (rawStart === "") {
    const length = Number(rawEnd);
    if (length === 0) throw rangeNotSatisfiable();
    return { start: Math.max(0, sizeBytes - length), end: sizeBytes - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? sizeBytes - 1 : Number(rawEnd);
  if (start > end || start >= sizeBytes) throw rangeNotSatisfiable();
  return { start, end: Math.min(end, sizeBytes - 1) };
}

export async function readAssetFile(
  asset: AssetRow,
  path: string,
  req: Request,
): Promise<RouteResult> {
  const file = await storedFile(asset.id, path);
  if (!file) throw notFound();
  const sizeBytes = Number(file.size_bytes);
  const range = parseRange(
    typeof req.headers.range === "string" ? req.headers.range : undefined,
    sizeBytes,
  );
  const key = assetObjectKey(asset.tenant_id, asset.corridor_id, asset.id, path);
  const bytes = await getObject(key, range ?? undefined);
  if (!bytes) throw notFound();

  const headers: Record<string, string> = {
    ETag: `"${file.sha256}"`,
    "Accept-Ranges": "bytes",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": contentTypeForPath(path),
    "Cache-Control": "no-transform",
  };
  if (req.query.download === "1") {
    const name = path.slice(path.lastIndexOf("/") + 1);
    headers["Content-Disposition"] = `attachment; filename="${name}"`;
  }
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${sizeBytes}`;
    return { status: 206, raw: { bytes, headers, status: 206 } };
  }
  return { status: 200, raw: { bytes, headers, status: 200 } };
}
