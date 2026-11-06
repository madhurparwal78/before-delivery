import type { IncomingMessage } from "node:http";
import { ApiError } from "../errors";
import { JSON_LIMIT, PHOTO_REQUEST_LIMIT } from "./context";

// Reading request bodies with the boundary size limits.

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise<Buffer>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners("data");
        reject(new ApiError(413, "too_large", "That request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function declaredLength(req: IncomingMessage): number {
  const raw = req.headers["content-length"];
  if (raw === undefined) return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}

// Body handling for JSON endpoints. Precedence: too_large, unsupported_media_type,
// then invalid_json — decided here once for every route.
export async function readJsonBody(req: IncomingMessage): Promise<{ raw: Buffer; body: Record<string, unknown> }> {
  const declared = declaredLength(req);
  if (declared > JSON_LIMIT) {
    throw new ApiError(413, "too_large", "That request is too large.");
  }
  const raw = await readBody(req, JSON_LIMIT);
  const empty = raw.length === 0;
  if (declared === 0 && empty) {
    return { raw, body: {} };
  }
  if (empty) return { raw, body: {} };
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  const base = contentType.split(";")[0].trim();
  if (base !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Send JSON for this request.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { raw, body: {} };
  }
  return { raw, body: parsed as Record<string, unknown> };
}

// Body handling for the photo upload endpoint: multipart, bounded by the whole-request
// limit; the file's own limit is judged later, before any storage.
export type ParsedMultipart = { fileField: Buffer | null; fileName: string | null };

export async function readPhotoBody(req: IncomingMessage): Promise<{ raw: Buffer; boundary: string | null; contentType: string }> {
  const declared = declaredLength(req);
  if (declared > PHOTO_REQUEST_LIMIT) {
    throw new ApiError(413, "too_large", "That request is too large.");
  }
  const raw = await readBody(req, PHOTO_REQUEST_LIMIT);
  if (raw.length === 0) {
    throw new ApiError(415, "unsupported_media_type", "Send a photo file for this request.");
  }
  const contentType = req.headers["content-type"] ?? "";
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base !== "multipart/form-data") {
    throw new ApiError(415, "unsupported_media_type", "Send a photo file for this request.");
  }
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2]) : null;
  return { raw, boundary: boundary ? boundary.trim() : null, contentType };
}

export function parseMultipartFile(raw: Buffer, boundary: string | null, fieldName: string): ParsedMultipart {
  if (!boundary) return { fileField: null, fileName: null };
  const delim = Buffer.from(`--${boundary}`);
  let index = raw.indexOf(delim);
  while (index !== -1) {
    const next = raw.indexOf(delim, index + delim.length);
    if (next === -1) break;
    const part = raw.subarray(index + delim.length, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const nameMatch = headers.match(/name="([^"]*)"/i);
      const fileMatch = headers.match(/filename="([^"]*)"/i);
      const isFile = fileMatch !== null;
      if (nameMatch && nameMatch[1] === fieldName) {
        const content = part.subarray(headerEnd + 4);
        const trailing = content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a ? content.subarray(0, content.length - 2) : content;
        return { fileField: isFile ? Buffer.from(trailing) : null, fileName: fileMatch ? fileMatch[1] : null };
      }
    }
    index = next;
  }
  return { fileField: null, fileName: null };
}
