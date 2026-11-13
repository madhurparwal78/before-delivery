import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { App } from "../app.js";
import { ApiError, write, writeError } from "./errors.js";
import type { Ctx } from "./router.js";
import { guardRole } from "./router.js";
import { applySchema } from "../schema-apply.js";
import { applySeed } from "../domain/seed.js";

const JSON_BODY_LIMIT = 65_536;
const MULTIPART_BODY_LIMIT = 8_100_000;
const CLIENT_ROOT = path.resolve(new URL("../../client", import.meta.url).pathname);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const NEVER_SERVED = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/tsconfig.client.json", "/tsconfig.server.json"];

interface MultipartPart {
  name: string;
  filename: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) {
      break;
    }
    const segment = body.slice(start + delimiter.length, next);
    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = segment.slice(0, headerEnd).toString("utf8");
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      const dataStart = segment.indexOf("\r\n\r\n", 0) + 4;
      parts.push({
        name: nameMatch?.[1] ?? "",
        filename: fileMatch?.[1] ?? "",
        data: segment.slice(dataStart, segment.length - 2),
      });
    }
    start = next;
  }
  return parts;
}

export async function createHttpServer(app: App): Promise<http.Server> {
  let schemaReady = false;

  const server = http.createServer(async (req, res) => {
    try {
      if (!schemaReady) {
        try {
          await applySchema(app.db);
          await applySeed(app.db, app.storage);
          schemaReady = true;
        } catch {
          // Postgres is not answering yet; the health check reports starting.
          if (req.url === "/api/health") {
            write(res, 503, { status: "starting" });
            return;
          }
          write(res, 503, { status: "starting" });
          return;
        }
      }
      await handleRequest(app, req, res);
    } catch (error) {
      if (!res.headersSent) {
        if (error instanceof ApiError) {
          writeError(res, error);
        } else {
          console.error("unhandled request error", error);
          write(res, 500, { error: "internal", message: "Something went wrong at the desk." });
        }
      } else {
        res.end();
      }
    }
  });
  return server;
}

async function handleRequest(app: App, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://internal");
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  if (pathname.startsWith("/api")) {
    await handleApi(app, req, res, method, pathname, url.searchParams);
    return;
  }
  await serveStatic(res, pathname);
}

async function handleApi(
  app: App,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  pathname: string,
  query: URLSearchParams,
): Promise<void> {
  // Server boundary: same-origin writes first, in the brief's order.
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const host = req.headers.host ?? "";
        if (originUrl.host !== host) {
          write(res, 403, { error: "forbidden", message: "Only the program director can do that." });
          return;
        }
      } catch {
        write(res, 403, { error: "forbidden", message: "Only the program director can do that." });
        return;
      }
    }
  }

  const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const isMultipart = contentType === "multipart/form-data";
  const isJson = contentType === "application/json" || contentType === "";
  if (!isMultipart && !isJson && method !== "GET" && method !== "HEAD" && contentType !== "application/x-www-form-urlencoded") {
    // A write with any other content type answers 415.
    await readBody(req, 1);
    write(res, 415, { error: "unsupported_media_type", message: "That request format isn't supported." });
    return;
  }
  const limit = isMultipart ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
  let raw: Buffer;
  try {
    raw = await readBody(req, limit);
  } catch (error) {
    if (error instanceof TooLarge) {
      write(res, 413, { error: isMultipart ? "file_too_large" : "payload_too_large", message: isMultipart ? "Images must be 8,000,000 bytes or smaller." : "That request is too large." });
      return;
    }
    throw error;
  }

  const match = app.router.match(method === "HEAD" ? "GET" : method, pathname);
  if (!match) {
    write(res, 404, { error: "not_found", message: "We couldn't find that." });
    return;
  }
  const auth = await app.auth(req);
  const ctx: Ctx = {
    auth,
    params: match.params,
    query,
    body: null,
    req,
    res,
    raw,
    idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? null,
  };
  if (isMultipart) {
    const boundaryMatch = /boundary=(.+)$/.exec(req.headers["content-type"] ?? "");
    const parts = boundaryMatch ? parseMultipart(raw, boundaryMatch[1]) : [];
    const file = parts.find((p) => p.name === "file");
    ctx.body = { file: file ? { name: file.filename, data: file.data } : undefined };
  } else if (raw.length > 0 && isJson) {
    try {
      ctx.body = JSON.parse(raw.toString("utf8"));
    } catch {
      write(res, 400, { error: "invalid_json", message: "That request body isn't valid JSON." });
      return;
    }
  }

  // The single error-precedence rule: boundary, 401, 404/role, replay, state, 422.
  if (!guardRole(match.roles, auth)) {
    if (!auth) {
      write(res, 401, { error: "unauthenticated", message: "Sign in to continue." });
      return;
    }
    if (match.roles === "directorOrJuror" && (auth.role === "director" || auth.role === "juror")) {
      // unreachable; guardRole already allowed it
    } else {
      write(res, 403, { error: "forbidden", message: "Only the program director can do that." });
      return;
    }
  }

  try {
    const result = await match.handler(ctx);
    if (result === null || result === undefined) {
      write(res, 204, {});
      return;
    }
    if (result instanceof Buffer) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(result);
      return;
    }
    const asRecord = result as { status?: number; body?: unknown; raw?: Buffer; contentType?: string; headers?: Record<string, string> };
    if (Buffer.isBuffer(asRecord.raw)) {
      res.writeHead(asRecord.status ?? 200, {
        "Content-Type": asRecord.contentType ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": asRecord.raw.length,
        "Cache-Control": "no-store",
      });
      res.end(asRecord.raw);
      return;
    }
    const status = asRecord.status ?? (method === "POST" ? 200 : 200);
    if (status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    const payload = Buffer.from(JSON.stringify(asRecord.body ?? asRecord), "utf8");
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": payload.length,
      "Cache-Control": "no-store",
    });
    res.end(payload);
  } catch (error) {
    if (error instanceof ApiError) {
      writeError(res, error);
      return;
    }
    console.error("unhandled route error", error);
    write(res, 500, { error: "internal", message: "Something went wrong at the desk." });
  }
}

class TooLarge extends Error {}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners("data");
        reject(new TooLarge("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  const relative = pathname.replace(/^\/+/, "");
  for (const never of NEVER_SERVED) {
    if (`/${relative}` === never || relative === never.slice(1)) {
      write(res, 404, { error: "not_found", message: "We couldn't find that." });
      return;
    }
  }
  let filePath = path.join(CLIENT_ROOT, relative);
  if (!filePath.startsWith(CLIENT_ROOT)) {
    write(res, 404, { error: "not_found", message: "We couldn't find that." });
    return;
  }
  if (!relative || !existsSync(filePath)) {
    filePath = path.join(CLIENT_ROOT, "index.html");
  } else {
    const stats = await stat(filePath).catch(() => null);
    if (!stats || stats.isDirectory()) {
      filePath = path.join(CLIENT_ROOT, "index.html");
    }
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const content = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
  });
  res.end(content);
}
