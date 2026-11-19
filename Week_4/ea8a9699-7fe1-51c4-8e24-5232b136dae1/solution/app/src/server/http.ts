// HTTP edge: routing, the server boundary (origin, size, content type) and JSON answers.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { ApiError, refuse, Unavailable } from "./errors.js";
import { CLIP_LIMIT, IMAGE_LIMIT, sniff, STILL_LIMIT, type MediaType } from "./hygiene.js";

const JSON_LIMIT = 65_536;
const MULTIPART_SLACK = 1_000_000;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface FilePart {
  filename: string;
  data: Buffer;
  type: MediaType;
}

export interface Multipart {
  fields: Map<string, string>;
  files: Map<string, FilePart[]>;
}

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  now: Date;
  params: Record<string, string>;
  query: URLSearchParams;
  json: JsonObject;
  multipart: Multipart;
}

type BodyKind = "json" | "multipart";
type Handler = (ctx: Context) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  body: BodyKind;
  /** For multipart routes: the part that carries the file and how its type is judged. */
  part?: "file" | "still";
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, options: { part?: "file" | "still" } = {}): void {
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
  const body: BodyKind = options.part ? "multipart" : "json";
  routes.push({ method, pattern, body, ...(options.part ? { part: options.part } : {}), handler });
}

export function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    const found = candidate.pattern.exec(path);
    if (found && (candidate.method === method || (method === "HEAD" && candidate.method === "GET"))) {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(found.groups ?? {})) params[key] = decodeURIComponent(value);
      return { route: candidate, params };
    }
  }
  return null;
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function noContent(res: ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(204, { "Cache-Control": "no-store", ...headers });
  res.end();
}

export function sendError(res: ServerResponse, error: ApiError): void {
  send(res, error.status, error.body, error.headers);
}

/** A cross-origin write is refused when its Origin names another host than this app. */
export function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  return host !== req.headers.host && host !== new URL(config.publicUrl).host;
}

function hasBody(req: IncomingMessage): boolean {
  const length = req.headers["content-length"];
  return (length !== undefined && length !== "0") || req.headers["transfer-encoding"] !== undefined;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on("end", () => (over ? reject(refuse("too_large")) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function mediaTypeOf(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function parseMultipart(body: Buffer, contentType: string, part: "file" | "still"): Multipart {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) throw refuse("unsupported_media_type");
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files = new Map<string, FilePart[]>();
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = chunk.subarray(0, split).toString("utf8");
      const data = chunk.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1] ?? "";
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const isFile = filename !== undefined;
      if (isFile && name === part) {
        const type = sniff(data);
        if (!type || (part === "still" && type.contentType !== "image/png")) throw refuse("unsupported_media_type");
        const limit = part === "still" ? STILL_LIMIT : type.kind === "clip" ? CLIP_LIMIT : IMAGE_LIMIT;
        if (data.length > limit) throw refuse("too_large");
        files.set(name, [...(files.get(name) ?? []), { filename: filename ?? "", data, type }]);
      } else if (!isFile) {
        fields.set(name, data.toString("utf8"));
      }
    }
    at = next;
  }
  return { fields, files };
}

/** Reads the body under the server-boundary rules; throws the matching 413/415. */
export async function readRequestBody(req: IncomingMessage, kind: BodyKind, part?: "file" | "still"): Promise<{ json: JsonObject; multipart: Multipart }> {
  const empty: Multipart = { fields: new Map(), files: new Map() };
  if (!hasBody(req) || req.method === "GET" || req.method === "HEAD") {
    req.resume();
    return { json: {}, multipart: empty };
  }
  const type = mediaTypeOf(req);
  if (kind === "json") {
    if (type !== "application/json") {
      req.resume();
      throw refuse("unsupported_media_type");
    }
    const raw = await readBody(req, JSON_LIMIT);
    try {
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      return { json: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {}, multipart: empty };
    } catch {
      return { json: {}, multipart: empty };
    }
  }
  if (type !== "multipart/form-data") {
    req.resume();
    throw refuse("unsupported_media_type");
  }
  const raw = await readBody(req, CLIP_LIMIT + MULTIPART_SLACK);
  return { json: {}, multipart: parseMultipart(raw, req.headers["content-type"] ?? "", part ?? "file") };
}

export function toApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  if (error instanceof Unavailable) return refuse(error.code);
  return null;
}

