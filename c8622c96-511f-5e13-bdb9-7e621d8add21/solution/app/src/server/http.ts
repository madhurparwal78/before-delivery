// HTTP plumbing: the one error shape, body reading with limits, cookies and JSON responses.
import type { IncomingMessage, ServerResponse } from "node:http";

export const JSON_LIMIT = 65_536;
export const UPLOAD_LIMIT = 25_000_000;
const MULTIPART_OVERHEAD = 1_048_576;

/** Every API error leaves through this class as {"error":{"code","message",...extra}}. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "Nothing was found at that address.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "Your role can't do that.");
export const takenDown = (): ApiError =>
  new ApiError(410, "taken_down", "This essay was removed after a legal takedown.");
export const databaseUnavailable = (): ApiError =>
  new ApiError(503, "database_unavailable",
    "Saltprint Desk can't reach its records right now. Nothing was saved; try again shortly.");

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", "Some fields need attention.", { fields });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export const errorBody = (error: ApiError): { error: Record<string, unknown> } =>
  ({ error: { code: error.code, message: error.message, ...error.extra } });

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, errorBody(error));
}

export function sendNoContent(res: ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(204, { "Cache-Control": "no-store", ...headers });
  res.end();
}

export interface RawBody {
  bytes: Buffer;
  overLimit: boolean;
}

/** Reads the whole body, keeping at most `limit + 1` bytes so an oversized body is known without buffering it. */
export function readBody(req: IncomingMessage, limit: number): Promise<RawBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ bytes: overLimit ? Buffer.alloc(0) : Buffer.concat(chunks), overLimit }));
    req.on("error", reject);
  });
}

export const multipartLimit = UPLOAD_LIMIT + MULTIPART_OVERHEAD;

/** Parsed JSON body, or the marker that it could not be parsed. */
export const UNPARSEABLE = Symbol("unparseable");

export function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return UNPARSEABLE;
  }
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export interface MultipartPart {
  name: string;
  filename: string | null;
  data: Buffer;
}

/** Splits a multipart/form-data body into its parts. Binary-safe; returns null when the body is malformed. */
export function parseMultipart(body: Buffer, contentType: string): MultipartPart[] | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let at = body.indexOf(delimiter);
  if (at < 0) return null;
  while (true) {
    at += delimiter.length;
    if (body.subarray(at, at + 2).toString() === "--") break;
    at += 2; // CRLF after the delimiter
    const headerEnd = body.indexOf("\r\n\r\n", at);
    if (headerEnd < 0) return null;
    const headers = body.subarray(at, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (next < 0) return null;
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    parts.push({ name, filename, data: body.subarray(headerEnd + 4, next) });
    at = next + 2;
  }
  return parts;
}
