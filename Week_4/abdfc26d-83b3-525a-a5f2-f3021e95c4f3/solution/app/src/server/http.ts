import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, notFound, payloadTooLarge, unsupportedMediaType } from "./errors.js";

const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 20_000_000;
/** Room for the multipart envelope around an upload of exactly UPLOAD_LIMIT bytes. */
const MULTIPART_OVERHEAD = 65_536;

interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  /** Parsed JSON body; `undefined` when absent or not valid JSON (validation then reports the fields). */
  body: unknown;
  parts: Part[];
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  /** The handler already wrote the response. */
  sent?: boolean;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: string;
  handler: Handler;
  multipart?: boolean;
}

interface Compiled extends Route {
  regex: RegExp;
  names: string[];
}

export function compile(routes: Route[]): Compiled[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.pattern.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { ...route, regex: new RegExp(`^${source}$`), names };
  });
}

export const json = (status: number, body: unknown, headers: Record<string, string | string[]> = {}): Reply => ({ status, body, headers });

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function send(res: ServerResponse, reply: Reply): void {
  if (reply.sent || res.headersSent) return;
  if (reply.body === undefined) {
    res.writeHead(reply.status, { ...BASE_HEADERS, "Cache-Control": "no-store", ...reply.headers });
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...reply.headers,
  });
  res.end(payload);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      try {
        out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        // a cookie that is not ours
      }
    }
  }
  return out;
}

/** Reads the body, keeping at most `limit` bytes; `null` when it was larger (the rest is drained). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = Number(req.headers["content-length"] ?? 0) > limit;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) tooLarge = true;
    if (!tooLarge) chunks.push(chunk);
  }
  return tooLarge ? null : Buffer.concat(chunks);
}

function parseMultipart(raw: Buffer, contentType: string): Part[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary.trim()}`);
  const parts: Part[] = [];
  let start = raw.indexOf(delimiter);
  while (start !== -1) {
    const next = raw.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = raw.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const name = /\bname="([^"]*)"/i.exec(head)?.[1];
      if (name !== undefined) parts.push({ name, filename: /filename="([^"]*)"/i.exec(head)?.[1] ?? null, data: part.subarray(split + 4) });
    }
    start = next;
  }
  return parts;
}

const hasBody = (req: IncomingMessage): boolean =>
  Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;

// Postgres text rejects NUL; a value that can never match keeps unknown ids answering 404, not 500.
const clean = (value: string): string => value.replace(/\u0000/g, "\uFFFD");

export function makeDispatcher(routes: Compiled[], ready: () => boolean) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://local");
    const method = req.method ?? "GET";
    const ctx: Ctx = {
      req,
      res,
      method,
      path: url.pathname,
      params: {},
      query: new URLSearchParams([...url.searchParams].map(([key, value]): [string, string] => [clean(key), clean(value)])),
      cookies: parseCookies(req.headers.cookie),
      body: undefined,
      parts: [],
    };
    let route: Compiled | undefined;
    for (const candidate of routes) {
      const match = candidate.regex.exec(ctx.path);
      if (!match || candidate.method !== method) continue;
      route = candidate;
      candidate.names.forEach((name, i) => {
        try {
          ctx.params[name] = clean(decodeURIComponent(match[i + 1] ?? ""));
        } catch {
          ctx.params[name] = "";
        }
      });
      break;
    }
    try {
      if (!route) {
        if (ctx.path.startsWith("/api/") || ctx.path.startsWith("/auth/") || (method !== "GET" && method !== "HEAD")) {
          await readBody(req, 0);
          throw notFound();
        }
        await serveStatic(ctx);
        return;
      }
      if (!ready() && ctx.path !== "/api/health") throw new ApiError(503, "starting", "The studio is starting up.");
      if (hasBody(req)) {
        const raw = await readBody(req, route.multipart ? UPLOAD_LIMIT + MULTIPART_OVERHEAD : JSON_LIMIT);
        if (raw === null) throw payloadTooLarge();
        const type = (req.headers["content-type"] ?? "").toLowerCase();
        if (route.multipart) {
          if (!type.startsWith("multipart/form-data")) throw unsupportedMediaType();
          ctx.parts = parseMultipart(raw, req.headers["content-type"] ?? "");
          if (ctx.parts.some((part) => part.filename !== null && part.data.length > UPLOAD_LIMIT)) throw payloadTooLarge();
        } else {
          if (!type.startsWith("application/json")) throw unsupportedMediaType();
          try {
            ctx.body = JSON.parse(raw.toString("utf8"));
          } catch {
            ctx.body = undefined;
          }
        }
      }
      send(res, await route.handler(ctx));
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, json(error.status, error.body));
      } else {
        console.error(`${method} ${ctx.path} failed:`, error instanceof Error ? error.message : error);
        send(res, json(500, new ApiError(500, "internal", "Something went wrong on our side.").body));
      }
    }
  };
}

// ---- the built frontend: only files inside the build output are served ----

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const PAGES = [
  /^\/$/,
  /^\/gallery$/,
  /^\/pieces\/[a-z0-9-]+$/,
  /^\/studio$/,
  /^\/studio\/credits$/,
  /^\/studio\/pieces\/[a-z0-9-]+$/,
  /^\/library$/,
  /^\/console$/,
];

let indexHtml: string | null = null;

async function serveStatic(ctx: Ctx): Promise<void> {
  const asset = /^\/(assets|fonts)\/[A-Za-z0-9._-]+$/.test(ctx.path) && !ctx.path.endsWith(".map");
  if (asset) {
    const file = path.join(PUBLIC_DIR, ctx.path);
    try {
      const info = statSync(file);
      if (info.isFile()) {
        ctx.res.writeHead(200, {
          ...BASE_HEADERS,
          "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
          "Content-Length": info.size,
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        if (ctx.method === "HEAD") ctx.res.end();
        else createReadStream(file).pipe(ctx.res);
        return;
      }
    } catch {
      // falls through to the not-found page
    }
  }
  indexHtml ??= await readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const known = !asset && PAGES.some((pattern) => pattern.test(ctx.path));
  ctx.res.writeHead(known ? 200 : 404, {
    ...BASE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  ctx.res.end(ctx.method === "HEAD" ? undefined : indexHtml);
}
