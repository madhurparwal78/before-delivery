import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors.js";

const JSON_LIMIT = 1_000_000;
export const SHEET_LIMIT = 2_000_000;
// a multipart envelope around a sheet adds a little; past this we only drain the bytes
const UPLOAD_CAP = SHEET_LIMIT + 4096;

export interface Account { id: string; role: "editor" | "stockist"; email: string; displayName: string }

export interface Upload { filename: string; bytes: Buffer; oversize: boolean }

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  ip: string;
  body: unknown;
  upload: Upload | null;
  account: Account | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
}

type Auth = "public" | "any" | "editor" | "stockist";
type Settle = (failed: boolean) => void;

interface RouteOptions {
  auth: Auth;
  body?: "json" | "upload";
  /** runs before the body is read (the whole-API order puts limits ahead of body errors); may return a settle callback */
  guard?: (ctx: Ctx) => Settle | void;
  /** the handler validates its params before any query, so a NUL byte reaches its own refusal */
  acceptsNul?: boolean;
}

interface Route extends RouteOptions {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx) => Promise<Reply>;
}

const routes: Route[] = [];

export function route(method: string, path: string, options: RouteOptions, handler: Route["handler"]): void {
  const source = path.replace(/:[a-zA-Z]+/g, "([^/]+)");
  routes.push({ method, pattern: new RegExp(`^${source}$`), handler, ...options });
}

export function match(method: string, pathname: string): { route: Route; params: string[] } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const m = candidate.pattern.exec(pathname);
    if (!m) continue;
    const params = m.slice(1).map(safeDecode);
    if (!candidate.acceptsNul && params.some((p) => p.includes("\0"))) return null; // a NUL byte names nothing and Postgres refuses it as text
    return { route: candidate, params };
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const sourceAddress = (req: IncomingMessage): string => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

async function collect(req: IncomingMessage, cap: number): Promise<{ bytes: Buffer; over: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > cap) {
      over = true;
      chunks.length = 0;
    } else if (!over) chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), over };
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const { bytes, over } = await collect(req, JSON_LIMIT);
  if (over) throw new ApiError(413, "body_too_large", "That request is larger than 1,000,000 bytes.");
  if (bytes.length === 0) return {};
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ApiError(400, "bad_json", "That request is not valid JSON.");
  }
}

export async function readUpload(req: IncomingMessage): Promise<Upload | null> {
  const { bytes, over } = await collect(req, UPLOAD_CAP);
  if (over) return { filename: "", bytes: Buffer.alloc(0), oversize: true };
  return parseMultipart(bytes, req.headers["content-type"] ?? "");
}

function parseMultipart(body: Buffer, contentType: string): Upload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") return null;
    const headEnd = body.indexOf("\r\n\r\n", start);
    if (headEnd === -1) return null;
    const head = body.subarray(start, headEnd).toString("utf8");
    const next = body.indexOf(Buffer.from(`\r\n${delimiter.toString()}`), headEnd + 4);
    if (next === -1) return null;
    if (/name="file"/i.test(head)) {
      const quoted = /filename="((?:[^"\\]|\\.)*)"/i.exec(head);
      // browsers and httpx escape quotes and line breaks in the header; the stored name keeps them
      const raw = (quoted?.[1] ?? "").replace(/%22/g, '"').replace(/%0D/gi, "\r").replace(/%0A/gi, "\n");
      const last = raw.split(/[\\/]/).pop() ?? "";
      return { filename: last, bytes: body.subarray(headEnd + 4, next), oversize: false };
    }
    at = body.indexOf(delimiter, next + 2);
  }
  return null;
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  let payload: Buffer | string;
  if (reply.raw !== undefined) {
    payload = reply.raw;
    headers["content-type"] ??= reply.contentType ?? "application/octet-stream";
  } else {
    payload = reply.body === undefined ? "" : JSON.stringify(reply.body);
    if (reply.body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  }
  headers["content-length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(payload);
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers });
