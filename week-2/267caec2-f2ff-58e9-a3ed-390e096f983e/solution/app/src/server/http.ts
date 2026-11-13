import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { refuse } from "./errors.js";

// The server boundary (brief: Server boundary): origin, body size and content type, checked on the raw request.

const JSON_LIMIT = 65536;
const MULTIPART_LIMIT = 8100000;

export interface Upload {
  name: string;
  data: Buffer;
}

export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  upload: Upload | null;
  sessionToken: string | null;
}

export interface ApiResult {
  status: number;
  json?: unknown;
  bytes?: { data: Buffer; type: string };
  headers?: Record<string, string>;
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function mediaType(headers: IncomingHttpHeaders): string {
  return (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Reads the whole body, or reports that it passed `limit` (the rest is drained so the client hears the answer). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  const chunks: Buffer[] = [];
  let size = 0;
  let over = declared > limit;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) over = true;
    if (!over) chunks.push(chunk);
  }
  return over ? null : Buffer.concat(chunks);
}

function sameOrigin(headers: IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === headers.host;
  } catch {
    return false;
  }
}

function parseMultipart(body: Buffer, contentType: string): Upload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return null;
  const delimiter = Buffer.from(`--${marker}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? "";
      if (/name="file"/i.test(disposition)) {
        const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? "";
        return { name: filename, data: part.subarray(split + 4) };
      }
    }
    start = next;
  }
  return null;
}

function cookie(headers: IncomingHttpHeaders, name: string): string | null {
  for (const pair of (headers.cookie ?? "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export const SESSION_COOKIE = "cutline_session";

/** Applies the boundary rules in the brief's order (origin, 413, 415) and parses what passed. */
export async function readApiRequest(req: IncomingMessage, url: URL, uploadRoute: boolean): Promise<ApiRequest> {
  const method = req.method ?? "GET";
  const type = mediaType(req.headers);
  const multipart = type === "multipart/form-data";
  if (WRITES.has(method) && !sameOrigin(req.headers)) {
    req.resume();
    throw refuse("forbidden");
  }
  const raw = await readBody(req, multipart ? MULTIPART_LIMIT : JSON_LIMIT);
  if (raw === null) throw refuse(multipart ? "file_too_large" : "payload_too_large");
  let body: Record<string, unknown> = {};
  let upload: Upload | null = null;
  if (WRITES.has(method) && (raw.length > 0 || type !== "")) {
    if (uploadRoute ? !multipart : type !== "application/json") throw refuse("unsupported_media_type");
    if (multipart) upload = parseMultipart(raw, req.headers["content-type"] ?? "");
    else body = parseJsonObject(raw);
  }
  return {
    method, path: url.pathname, params: {}, query: url.searchParams, headers: req.headers, body, upload,
    sessionToken: cookie(req.headers, SESSION_COOKIE),
  };
}

/** A body that is not a JSON object is treated as an empty one, so every field it lacks is rejected by validation. */
function parseJsonObject(raw: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8") || "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
