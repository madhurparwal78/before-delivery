import * as http from "node:http";
import { loadConfig } from "./config";
import { createPool, withTransaction } from "./db";
import { migrateAndSeed } from "./schema";
import { buildRouter, AppServices } from "./routes";
import { Ctx, Router } from "./http";
import { ApiError } from "./errors";
import { resolveSession, SESSION_COOKIE, parseCookie } from "./sessions";
import { serveStatic, serveIndex, isDeniedPath } from "./statics";
import { KillBillClient } from "./killbill";
import { PhotoStore } from "./photos";
import { startWorkers } from "./workers";

const JSON_BODY_LIMIT = 16384;
const PHOTO_BODY_LIMIT = 5500000;

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  bytes: Buffer;
}

function parseMultipart(body: Buffer, contentType: string): Record<string, MultipartPart> | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (boundaryMatch === null) return null;
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
  const boundaryBuffer = Buffer.from(boundary);
  const parts: Record<string, MultipartPart> = {};
  let cursor = body.indexOf(boundaryBuffer);
  while (cursor !== -1) {
    const start = cursor + boundaryBuffer.length;
    if (body.slice(start, start + 2).toString("ascii") === "--") break;
    const headerStart = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerStart === -1) break;
    const headerText = body.slice(start, headerStart).toString("utf8");
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    if (nameMatch === null) {
      cursor = body.indexOf(boundaryBuffer, headerStart);
      continue;
    }
    const contentStart = headerStart + 4;
    let nextBoundary = body.indexOf(boundaryBuffer, contentStart);
    if (nextBoundary === -1) nextBoundary = body.length;
    const contentEnd = nextBoundary - 2 >= contentStart ? nextBoundary - 2 : contentStart;
    parts[nameMatch[1]] = {
      name: nameMatch[1],
      filename: fileMatch === null ? null : fileMatch[1],
      contentType: typeMatch === null ? null : typeMatch[1].trim(),
      bytes: body.slice(contentStart, contentEnd),
    };
    cursor = nextBoundary;
  }
  return parts;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        truncated = true;
        chunks.length = 0;
        return;
      }
      if (!truncated) chunks.push(chunk);
    });
    req.on("end", () => {
      if (truncated) {
        resolve({ buffer: Buffer.alloc(0), truncated: true });
        return;
      }
      resolve({ buffer: Buffer.concat(chunks), truncated: false });
    });
    req.on("error", reject);
  });
}

function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (host === undefined) return false;
  try {
    const parsed = new URL(origin);
    const originHost = parsed.host;
    const originPort = parsed.port === "" ? (parsed.protocol === "https:" ? "443" : "80") : parsed.port;
    const hostMatch = /^(.*?)(?::(\d+))?$/.exec(host);
    const hostName = hostMatch === null ? host : hostMatch[1];
    const hostPort = hostMatch !== null && hostMatch[2] !== undefined ? hostMatch[2] : "80";
    const originHostName = parsed.hostname;
    if (originHostName !== hostName) return false;
    return originPort === hostPort;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);

  // Retry until PostgreSQL is reachable, then create schema and seed rows idempotently.
  for (;;) {
    try {
      await migrateAndSeed(pool);
      break;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const killbill = new KillBillClient(config);
  const photoStore = new PhotoStore(config);
  const services: AppServices = { pool, config, killbill, photos: photoStore };
  const router: Router = buildRouter(services);
  startWorkers(pool, config);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      // Same-origin state changes: refuse cross-site POST and DELETE before any other check.
      if ((req.method === "POST" || req.method === "DELETE") && !sameOrigin(req.headers.origin, req.headers.host)) {
        const err = new ApiError(403, "cross_origin");
        respondError(res, err);
        return;
      }

      if (path.startsWith("/api")) {
        await handleApi(req, res, url, router, pool);
        return;
      }

      // Sources, manifests and configuration are never served, not even as the app shell.
      if (isDeniedPath(path)) {
        const err = new ApiError(404, "not_found");
        const body = err.body();
        res.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      const served = await serveStatic(path, res);
      if (served) return;
      await serveIndex(res);
    } catch (error) {
      if (!res.headersSent) {
        respondError(res, new ApiError(500, "not_found"));
      } else {
        res.end();
      }
    }
  });

  async function handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    router: Router,
    pool: import("pg").Pool,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === "/api/health") {
      const body = JSON.stringify({ status: "ok" });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    const route = router.match(method, path);
    if (route === null) {
      respondError(res, new ApiError(404, "not_found"));
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data");
    const wantsJson = method === "POST" || method === "DELETE" || method === "PUT";

    let rawBody: Buffer | null = null;
    let multipart: Record<string, MultipartPart> | null = null;
    if (wantsJson) {
      const limit = isMultipart ? PHOTO_BODY_LIMIT : JSON_BODY_LIMIT;
      const { buffer, truncated } = await readBody(req, limit);
      if (truncated) {
        respondError(res, new ApiError(413, "body_too_large"));
        return;
      }
      if (isMultipart) {
        if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
          respondError(res, new ApiError(415, "unsupported_media_type"));
          return;
        }
        multipart = parseMultipart(buffer, contentType);
      } else if (buffer.length > 0 || method === "POST") {
        if (!contentType.toLowerCase().startsWith("application/json")) {
          respondError(res, new ApiError(415, "unsupported_media_type"));
          return;
        }
      }
      rawBody = buffer;
    }

    const cookie = parseCookie(req.headers.cookie, SESSION_COOKIE);
    const user = await resolveSession(pool, cookie);
    const ctx: Ctx = {
      req,
      res,
      method,
      path,
      params: route.params,
      query: url.searchParams,
      user,
      rawBody,
      multipart,
      json: () => {
        if (ctx.rawBody === null || ctx.rawBody.length === 0) return {};
        try {
          return JSON.parse(ctx.rawBody.toString("utf8"));
        } catch {
          throw new ApiError(422, "validation", {});
        }
      },
    };
    try {
      await route.handler(ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        respondError(res, error);
        return;
      }
      process.stderr.write(`unhandled: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!res.headersSent) {
        respondError(res, new ApiError(500, "not_found"));
      } else {
        res.end();
      }
      return;
    }
  }

  function respondError(res: http.ServerResponse, err: ApiError): void {
    const body = err.body();
    res.writeHead(err.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  server.listen(config.publicPort, "0.0.0.0", () => {
    process.stdout.write(`shedline listening on 0.0.0.0:${config.publicPort}\n`);
  });
}

void main();
