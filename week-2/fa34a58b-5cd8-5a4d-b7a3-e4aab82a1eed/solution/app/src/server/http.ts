// The server boundary: origin, size, content type and JSON checks in the published precedence,
// then the API routes, the six page routes and the built assets. Nothing else is served.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { ApiError, errorBody } from "./errors.ts";
import { sameOrigin } from "./origin.ts";
import { MAX_CLIP_BYTES } from "./clips.ts";
import { pageHtml, PAGES, planAddress } from "./page.ts";
import { hubNow } from "./clock.ts";
import { householdZone } from "./plan.ts";

const JSON_LIMIT = 65_536;

export type Body = { kind: "json"; value: unknown } | { kind: "bytes"; value: Buffer } | { kind: "none" };

export interface Context {
  params: string[];
  query: URLSearchParams;
  body: Body;
  headers: IncomingMessage["headers"];
}

type Reply =
  | { status: number; json: unknown }
  | { status: number; stream: ReadableStream<Uint8Array>; type: string; length: number };

interface Route {
  method: "GET" | "POST" | "PUT";
  pattern: RegExp;
  accepts: "json" | "bytes" | "none";
  /** Answers before PostgreSQL is ready (health only). */
  open?: boolean;
  handle: (context: Context) => Promise<Reply>;
}

export const json = (status: number, value: unknown): Reply => ({ status, json: value });

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; " +
    "frame-ancestors 'none'",
};

function send(response: ServerResponse, status: number, headers: Record<string, string | number>, body?: Buffer | string): void {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(value));
}

function sendError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.status, errorBody(error));
}

/** Reads the whole body, keeping at most `limit` bytes; reports whether it was larger. */
function readBody(request: IncomingMessage, limit: number): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      else chunks.push(chunk);
    });
    request.on("end", () => resolve({ bytes: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge }));
    request.on("error", reject);
  });
}

/** A path segment as text; one that cannot be an id (bad escape, NUL byte) names nothing. */
function decodePathParam(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw ApiError.of("not_found");
  }
  if (value.includes("\0")) throw ApiError.of("not_found");
  return value;
}

const mediaType = (header: string | undefined): string => (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/** Builds the request handler around the API routes; `ready` gates everything but health and assets. */
export async function createHandler(routes: Route[], publicDir: string, ready: () => Promise<void>): Promise<Handler> {
  const assets = new Map<string, { type: string; body: Buffer }>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`);
      else if (CONTENT_TYPES[extname(entry.name)]) {
        assets.set(`/assets/${prefix}${entry.name}`, { type: CONTENT_TYPES[extname(entry.name)] as string, body: await readFile(path) });
      }
    }
  };
  await walk(publicDir, "");

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Prefix the origin so a target such as `//package.json` stays a path instead of becoming a host.
    const target = request.url ?? "/";
    const url = new URL(target.startsWith("/") ? `http://hub.invalid${target}` : "http://hub.invalid/");
    const path = url.pathname;
    const method = request.method ?? "GET";

    if (!path.startsWith("/api/")) {
      await readBody(request, 0);
      if (method !== "GET" && method !== "HEAD") return sendError(response, ApiError.of("not_found"));
      if (path === "/") return send(response, 302, { Location: "/plan", "Content-Length": 0 });
      const asset = assets.get(path);
      if (asset) {
        return send(response, 200, { "Content-Type": asset.type, "Cache-Control": "no-cache", "Content-Length": asset.body.length }, asset.body);
      }
      const page = PAGES.find((candidate) => candidate.path === path);
      if (page) {
        let address: string | null = null;
        if (page.name === "plan") {
          await ready();
          address = planAddress(url.searchParams, await householdZone(), hubNow());
        }
        return send(response, 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, pageHtml(page, address));
      }
      return sendError(response, ApiError.of("not_found"));
    }

    const matched = routes.filter((route) => route.pattern.test(path));
    const route = matched.find((candidate) => candidate.method === method);
    const writes = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    const accepts = route?.accepts ?? (writes ? "json" : "none");
    const limit = accepts === "bytes" ? MAX_CLIP_BYTES : JSON_LIMIT;
    const { bytes, tooLarge } = await readBody(request, writes ? limit : 0);
    try {
      if (writes && !sameOrigin(request)) throw ApiError.of("forbidden_origin");
      let body: Body = { kind: "none" };
      if (writes) {
        if (tooLarge) throw ApiError.of("too_large");
        const type = mediaType(request.headers["content-type"]);
        if (type !== (accepts === "bytes" ? "application/octet-stream" : "application/json")) {
          throw ApiError.of("unsupported_media_type");
        }
        if (accepts === "bytes") body = { kind: "bytes", value: bytes };
        else {
          try {
            body = { kind: "json", value: JSON.parse(bytes.toString("utf8")) };
          } catch {
            throw ApiError.of("bad_json");
          }
        }
      }
      if (!route) throw ApiError.of("not_found");
      if (!route.open) await ready();
      const params = (route.pattern.exec(path) as RegExpExecArray).slice(1).map(decodePathParam);
      const reply = await route.handle({ params, query: url.searchParams, body, headers: request.headers });
      if ("json" in reply) return sendJson(response, reply.status, reply.json);
      response.writeHead(reply.status, {
        ...SECURITY_HEADERS, "Content-Type": reply.type, "Content-Length": reply.length, "Cache-Control": "no-store",
      });
      Readable.fromWeb(reply.stream as import("node:stream/web").ReadableStream<Uint8Array>).pipe(response);
    } catch (error) {
      if (error instanceof ApiError) return sendError(response, error);
      // An unexpected failure gets no HTTP answer; the page then says the hub could not be reached.
      console.error(`request failed: ${method} ${path}`);
      response.destroy();
    }
  }

  return handle;
}

export type { Route };
