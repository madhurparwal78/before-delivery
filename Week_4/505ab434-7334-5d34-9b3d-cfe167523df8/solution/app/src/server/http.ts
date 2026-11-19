// A small HTTP layer: route table, request context, bodies, uploads, cookies and the one error shape.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { config } from "./config.ts";
import { ApiError, invalidBody, tooLarge, unauthenticated } from "./errors.ts";
import { JSON_BODY_LIMIT } from "../shared/domain.ts";
import type { Principal } from "../shared/api.ts";

export interface Reply {
  status: number;
  body?: unknown;
  /** Raw bytes or a stream sent instead of JSON. */
  raw?: Buffer | Readable;
  headers?: Record<string, string | string[]>;
}

export const ok = (body: unknown): Reply => ({ status: 200, body });
export const created = (body: unknown): Reply => ({ status: 201, body });
export const noContent = (headers?: Record<string, string | string[]>): Reply => ({ status: 204, headers });

interface Upload {
  fileName: string;
  bytes: Buffer;
  fields: Record<string, string>;
}

export class Ctx {
  readonly query: URLSearchParams;
  params: Record<string, string> = {};
  private bodyBuffer: Promise<{ bytes: Buffer; exceeded: boolean }> | null = null;

  constructor(
    readonly req: IncomingMessage,
    readonly path: string,
    search: string,
    /** The signed-in caller, or null for an anonymous request. */
    readonly principal: Principal | null,
  ) {
    this.query = new URLSearchParams(search);
  }

  /** The signed-in caller; a missing session is the first refusal in the error order (401). */
  user(): Principal {
    if (!this.principal) throw unauthenticated();
    return this.principal;
  }

  get cookies(): Record<string, string> {
    return parseCookies(this.req.headers.cookie);
  }

  private buffer(limit: number): Promise<{ bytes: Buffer; exceeded: boolean }> {
    this.bodyBuffer ??= new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let exceeded = false;
      this.req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total <= limit) chunks.push(chunk);
        else exceeded = true;
      });
      this.req.on("end", () => resolve({ bytes: Buffer.concat(chunks), exceeded }));
      this.req.on("error", reject);
    });
    return this.bodyBuffer;
  }

  /** The JSON object body. An empty body is `{}` only when `optional`. */
  async json(optional = false): Promise<Record<string, unknown>> {
    const { bytes, exceeded } = await this.buffer(JSON_BODY_LIMIT);
    if (exceeded) throw tooLarge();
    if (bytes.length === 0 && optional) return {};
    try {
      // PostgreSQL text cannot hold a NUL byte, so a body that carries one is not an acceptable body.
      const value: unknown = JSON.parse(bytes.toString("utf8"), (key, inner: unknown) => {
        if (key.includes("\0") || (typeof inner === "string" && inner.includes("\0"))) throw invalidBody();
        return inner;
      });
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // falls through to the shared refusal
    }
    throw invalidBody();
  }

  /** A multipart body with one `file` part. `ceiling` bounds buffering; the caller applies its own size contract. */
  async upload(ceiling: number): Promise<Upload | null> {
    const { bytes, exceeded } = await this.buffer(ceiling);
    if (exceeded) return { fileName: "", bytes: Buffer.alloc(0), fields: { exceeded: "true" } };
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(this.req.headers["content-type"] ?? "");
    if (!boundary) return null;
    return parseMultipart(bytes, boundary[1] ?? boundary[2]);
  }
}

function parseMultipart(body: Buffer, boundary: string): Upload | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: { fileName: string; bytes: Buffer } | null = null;
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    const start = position + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next === -1) break;
    const headers = body.subarray(start, headerEnd).toString("utf8");
    const content = body.subarray(headerEnd + 4, next - 2);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const fileName = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (name === "file" && fileName !== undefined) file = { fileName, bytes: content };
    else if (name) fields[name] = content.toString("utf8");
    // PostgreSQL text cannot hold a NUL byte, so a file name or field that carries one makes the upload unacceptable.
    if (fileName?.includes("\0") || (name !== "file" && fields[name ?? ""]?.includes("\0"))) return null;
    position = next;
  }
  return file ? { ...file, fields } : null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (header ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    // A value that is not a valid escape, or that decodes to a NUL byte, can never be a session token: leave it out.
    try {
      const value = decodeURIComponent(pair.slice(index + 1).trim());
      if (!value.includes("\0")) out[pair.slice(0, index).trim()] = value;
    } catch {
      continue;
    }
  }
  return out;
}

export function sessionCookie(value: string, clear = false): string {
  return `${config.sessionCookieName}=${clear ? "" : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${clear ? "; Max-Age=0" : ""}`;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  keys: string[];
  pattern: RegExp;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const keys: string[] = [];
    const wildcard = path.endsWith("/*");
    const source = (wildcard ? path.slice(0, -2) : path).replace(/:([a-zA-Z]+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    this.routes.push({ method, keys, pattern: new RegExp(`^${source}${wildcard ? "(?:/.*)?" : "/?"}$`), handler });
  }

  get = (path: string, handler: Handler): void => this.add("GET", path, handler);
  post = (path: string, handler: Handler): void => this.add("POST", path, handler);
  put = (path: string, handler: Handler): void => this.add("PUT", path, handler);
  delete = (path: string, handler: Handler): void => this.add("DELETE", path, handler);

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method && !(method === "HEAD" && route.method === "GET")) continue;
      const found = route.pattern.exec(path);
      if (found) {
        const params: Record<string, string> = {};
        // A malformed escape or a NUL byte can never name a record: answer as an unknown path.
        try {
          route.keys.forEach((key, i) => (params[key] = decodeURIComponent(found[i + 1])));
        } catch {
          return null;
        }
        if (Object.values(params).some((value) => value.includes("\0"))) return null;
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...reply.headers };
  if (reply.raw) {
    res.writeHead(reply.status, headers);
    if (Buffer.isBuffer(reply.raw)) res.end(reply.raw);
    else reply.raw.pipe(res);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  headers["content-type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(JSON.stringify(reply.body));
}

export const errorReply = (error: ApiError): Reply => ({
  status: error.status,
  body: { error: error.code, message: error.message },
});

/** An Origin header that names another site (brief: Server boundary). */
export function foreignOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    return originHost !== host && originHost !== new URL(config.publicUrl).host;
  } catch {
    return true;
  }
}

/** A state-changing request from another origin is refused before anything else. */
export function crossOrigin(req: IncomingMessage): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET") && foreignOrigin(req.headers.origin, req.headers.host);
}
