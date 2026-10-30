// HTTP plumbing: the server boundary (origin, size and content-type limits), routing, bodies and replies.

import type { IncomingMessage, ServerResponse } from "node:http";
import busboy from "busboy";
import { ApiError, invalid } from "./errors.js";

export const MAX_JSON_BYTES = 65_536;
export const MAX_UPLOAD_BYTES = 5_250_000;
const MAX_FILE_BYTES = 5_000_000;

interface UploadedFile {
  filename: string;
  bytes: Buffer;
  tooLarge: boolean;
}

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  raw: Buffer;
  json: Record<string, unknown>;
  fields: Record<string, string>;
  file: UploadedFile | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

export const json = (status: number, body: unknown): Reply => ({ status, body });
export const empty = (status = 204): Reply => ({ status });

export type BodyKind = "json" | "multipart";

const PATTERN_PARAM = /:([a-z_]+)/g;

export interface CompiledRoute<E> {
  regex: RegExp;
  keys: string[];
  methods: Partial<Record<string, E>>;
}

export function compile<E>(pattern: string, methods: Partial<Record<string, E>>): CompiledRoute<E> {
  const keys: string[] = [];
  const source = pattern.replace(PATTERN_PARAM, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${source}$`), keys, methods };
}

export function match<E>(routes: CompiledRoute<E>[], path: string): { route: CompiledRoute<E>; params: Record<string, string> } | null {
  for (const route of routes) {
    const found = route.regex.exec(path);
    if (!found) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] ?? "");
    });
    return { route, params };
  }
  return null;
}

/** Same-origin rule: a mutating request whose Origin is present must match the Host it was sent to. */
export function crossOrigin(request: IncomingMessage): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return false;
  return origin !== `http://${request.headers.host ?? ""}`;
}

/** Reads the whole body up to a limit; past it the rest is drained and null is returned. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers["content-length"] ?? "0");
  const chunks: Buffer[] = [];
  let size = 0;
  let over = Number.isFinite(declared) && declared > limit;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) over = true;
    if (!over) chunks.push(buffer);
  }
  return over ? null : Buffer.concat(chunks);
}

export function mediaType(request: IncomingMessage): string {
  return (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function parseJson(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalid({ body: "invalid_json" });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid({ body: "not_an_object" });
  return parsed as Record<string, unknown>;
}

/** Parses a multipart/form-data body: text fields plus the first part named "file". */
export function parseMultipart(headers: IncomingMessage["headers"], raw: Buffer): Promise<{ fields: Record<string, string>; file: UploadedFile | null }> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers,
        preservePath: true,
        defParamCharset: "utf8",
        limits: { fileSize: MAX_FILE_BYTES + 1, files: 4, fields: 32, fieldSize: 64 * 1024 },
      });
    } catch {
      reject(invalid({ body: "invalid_multipart" }));
      return;
    }
    const fields: Record<string, string> = {};
    let file: UploadedFile | null = null;
    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || file) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      const current: UploadedFile = { filename: info.filename ?? "", bytes: Buffer.alloc(0), tooLarge: false };
      file = current;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => {
        current.tooLarge = true;
      });
      stream.on("end", () => {
        current.bytes = Buffer.concat(chunks);
        if (current.bytes.length > MAX_FILE_BYTES) current.tooLarge = true;
      });
    });
    parser.on("error", () => reject(invalid({ body: "invalid_multipart" })));
    parser.on("close", () => resolve({ fields, file }));
    parser.end(raw);
  });
}

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...BASE_HEADERS, ...reply.headers };
  if (!headers["Referrer-Policy"]) headers["Referrer-Policy"] = "same-origin";
  let payload: Buffer | undefined = reply.bytes;
  if (reply.body !== undefined) {
    payload = Buffer.from(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), "utf8");
    headers["Content-Type"] ??= "application/json; charset=utf-8";
  }
  if (!headers["Cache-Control"]) headers["Cache-Control"] = "no-store";
  if (payload) headers["Content-Length"] = String(payload.length);
  response.writeHead(reply.status, headers);
  response.end(payload);
}

export function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body };
}

export function cookies(headers: IncomingMessage["headers"]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const part of (headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) found[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return found;
}
