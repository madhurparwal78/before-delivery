import type { IncomingMessage, ServerResponse } from "node:http";
import { securityHeaders } from "./security.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "Nothing was found at this address.");
export const forbidden = () => new ApiError(403, "forbidden", "Your role on this diagram does not allow that.");
export const validation = (fields: Record<string, string>) =>
  new ApiError(422, "validation", "Some fields are not valid.", fields);

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...securityHeaders(res.req.url ?? "/"),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    ...headers,
  });
  res.end(payload);
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...securityHeaders(res.req.url ?? "/"), ...headers });
  res.end();
}

export function sendError(res: ServerResponse, error: ApiError): void {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.fields) body.fields = error.fields;
  sendJson(res, error.status, body, error.headers);
}

/** The published internal error; 503 while the database is not yet connected. */
export const internalError = (status: 500 | 503 = 500) => new ApiError(status, "internal", "Something went wrong.");

/** Reads a request body up to `limit` bytes; beyond it the rest is drained and `null` is returned. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export const INVALID_JSON = Symbol("invalid-json");

export function parseJson(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

export interface UploadedFile {
  fileName: string;
  bytes: Buffer;
}

function headerParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  const re = /;\s*([^=;\s]+)\s*=\s*("(?:\\.|[^"\\])*"|[^;]*)/g;
  for (const m of value.matchAll(re)) {
    let v = m[2]!.trim();
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, "$1");
    params.set(m[1]!.toLowerCase(), v);
  }
  return params;
}

function decodeExtended(value: string): string | null {
  const m = /^([^']*)'[^']*'(.*)$/.exec(value);
  if (!m || m[1]!.toLowerCase() !== "utf-8") return null;
  try {
    return decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
}

/** Finds the `file` part of a multipart/form-data body. */
export function multipartFile(body: Buffer, contentType: string): UploadedFile | null {
  const boundary = headerParams(contentType).get("boundary");
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(delimiter);
  while (pos !== -1) {
    const headStart = pos + delimiter.length;
    if (body.subarray(headStart, headStart + 2).toString() === "--") return null;
    const headEnd = body.indexOf("\r\n\r\n", headStart);
    if (headEnd === -1) return null;
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headEnd + 4);
    if (next === -1) return null;
    const head = body.subarray(headStart, headEnd).toString("utf8");
    const disposition = head.split("\r\n").find((line) => /^content-disposition:/i.test(line));
    if (disposition) {
      const params = headerParams(disposition.slice(disposition.indexOf(":") + 1).replace(/^[^;]*/, ""));
      if (params.get("name") === "file") {
        const extended = params.get("filename*");
        const fileName = (extended && decodeExtended(extended)) ?? params.get("filename") ?? "";
        return { fileName, bytes: body.subarray(headEnd + 4, next) };
      }
    }
    pos = next + 2;
  }
  return null;
}
