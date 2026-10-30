// Saltprint Desk server: same-origin browser app, /api and /media on one port.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { clearedSessionCookie, personFromRequest, sessionCookie, signIn, signOut, userBody } from "./auth.js";
import { clockBody, serverNow, setServerNow } from "./clock.js";
import { config } from "./config.js";
import { ensureSchema } from "./db.js";
import {
  ApiError, JSON_LIMIT, multipartLimit, notFound, parseJson, readBody, sendError, sendJson, sendNoContent,
} from "./http.js";
import { match, on, onPublic, type RequestCtx } from "./router.js";
import { strictBody, WRONG_TYPE } from "./strict-body.js";
import { startWorkers } from "./workers.js";
import "./essays.js";
import "./frames.js";
import "./feed.js";
import "./follows.js";
import "./licences.js";
import "./usage.js";
import "./desk.js";
import "./rates.js";
import "./statements.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const APP_PATHS = new Set(["/", "/sheet", "/studio", "/royalties", "/shortlist", "/licences", "/following", "/usage",
  "/review", "/essays", "/rates", "/statements"]);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml",
};
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

onPublic("GET", "/api/health", "none", async (ctx) => sendJson(ctx.res, 200, { status: "ok" }));

onPublic("POST", "/api/session", "json", async (ctx) => {
  const { values, errors } = strictBody(ctx.body, {
    email: { kind: "string", message: WRONG_TYPE }, password: { kind: "string", message: WRONG_TYPE },
  });
  errors.fail();
  const { person, token } = await signIn(values.email as string, values.password as string);
  sendJson(ctx.res, 200, userBody(person), { "Set-Cookie": sessionCookie(token) });
});

onPublic("DELETE", "/api/session", "none", async (ctx) => {
  await signOut(ctx.req);
  sendNoContent(ctx.res, { "Set-Cookie": clearedSessionCookie });
});

on("GET", "/api/me", "none", async (ctx) => sendJson(ctx.res, 200, userBody(ctx.person)));

onPublic("GET", "/api/clock", "none", async (ctx) => sendJson(ctx.res, 200, clockBody(await serverNow())));

onPublic("PUT", "/api/clock", "json", async (ctx) => {
  if (!config.clockControl) throw notFound();
  const { values, errors } = strictBody(ctx.body, { now: { kind: "string", message: WRONG_TYPE } });
  const target = typeof values.now === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(values.now)
    ? new Date(values.now) : null;
  if (typeof values.now === "string" && (!target || Number.isNaN(target.getTime()))) errors.add("now", WRONG_TYPE);
  errors.fail();
  await setServerNow(target as Date);
  sendJson(ctx.res, 200, clockBody(await serverNow()));
});

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${req.headers.host ?? ""}` || origin === `https://${req.headers.host ?? ""}`;
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  if (MUTATING.has(method) && !sameOrigin(req)) {
    throw new ApiError(403, "cross_origin", "Requests must come from Saltprint Desk itself.");
  }
  const found = match(method, url.pathname);
  if (found === null) throw notFound();
  if (found === "method") throw new ApiError(405, "method_not_allowed", "That method isn't allowed here.");
  const { route, params } = found;
  const request: RequestCtx = { req, res, url, params, body: {}, multipart: { bytes: Buffer.alloc(0), overLimit: false } };
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (route.body === "json") {
    const raw = await readBody(req, JSON_LIMIT);
    if (raw.overLimit) throw new ApiError(413, "payload_too_large", "Request bodies may be at most 65,536 bytes.");
    if (MUTATING.has(method) && !/^application\/json\s*(;|$)/.test(type)) {
      throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type application/json.");
    }
    request.body = parseJson(raw.bytes);
  } else if (route.body === "multipart") {
    if (!type.startsWith("multipart/form-data")) {
      throw new ApiError(415, "unsupported_media_type", "Upload frames as multipart/form-data.");
    }
    request.multipart = await readBody(req, multipartLimit);
  }
  if (!route.auth) {
    await route.handle(request);
    return;
  }
  const person = await personFromRequest(req);
  if (!person) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  await route.handle({ ...request, person });
}

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const file = APP_PATHS.has(path) ? "index.html" : normalize(path).replace(/^[/\\]+/, "");
  const allowed = file === "index.html" || /^(assets|fonts)\/[\w.-]+$/.test(file);
  if (!allowed || file.includes("..")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const bytes = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": file === "index.html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://saltprint.invalid");
  const path = url.pathname;
  const work = path.startsWith("/api/") || path.startsWith("/media/")
    ? api(req, res, url)
    : req.method === "GET" || req.method === "HEAD" ? serveStatic(res, path) : Promise.reject(notFound());
  work.catch((error: unknown) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    // Only the error class and code are logged: messages from drivers can carry service details.
    console.error("request failed:", error instanceof Error ? error.name : "unknown error",
      (error as { code?: unknown }).code ?? "");
    sendError(res, new ApiError(500, "internal_error", "Something went wrong on Saltprint Desk."));
  });
});

server.requestTimeout = 120_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Saltprint Desk listening on port ${config.port}`);
});

function prepare(): void {
  ensureSchema().catch(() => setTimeout(prepare, 2000));
}
prepare();
startWorkers();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
