import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";
import { ApiError, errorBody, unauthenticated } from "../errors";
import { pool, one } from "../db";
import { now } from "../clock";
import { match as matchRoute } from "./routes";
import type { Ctx, Person, Studio } from "./context";
import { sendJson, setCookie, clearCookie } from "./context";
import { readJsonBody, readPhotoBody } from "./body";
import { startEventListener, addSseClient, removeSseClient } from "../events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

let schemaReady = false;

export function markSchemaReady(): void {
  schemaReady = true;
}

type SessionInfo = { person: Person; studio: Studio; token: string };

async function loadSession(req: http.IncomingMessage): Promise<SessionInfo | null> {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)kd_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const row = await one<Record<string, string | boolean | Date>>(
    pool,
    `SELECT p.id AS person_id, p.studio_id, p.email, p.name AS person_name, p.handle, p.role, p.membership, p.card_status, p.active,
            s.id AS studio_row_id, s.name AS studio_name, s.slug, s.time_zone, s.pickup_window_days
       FROM sessions se
       JOIN people p ON p.id = se.person_id
       JOIN studios s ON s.id = p.studio_id
      WHERE se.token = $1 AND se.expires_at > $2`,
    [token, now()],
  );
  if (!row) return null;
  const person: Person = {
    id: row.person_id as string,
    studio_id: row.studio_id as string,
    email: row.email as string,
    name: row.person_name as string,
    handle: row.handle as string,
    role: row.role as Person["role"],
    membership: row.membership as Person["membership"],
    card_status: row.card_status as Person["card_status"],
    active: row.active as boolean,
  };
  const studio: Studio = {
    id: row.studio_row_id as string,
    name: row.studio_name as string,
    slug: row.slug as string,
    time_zone: row.time_zone as string,
    pickup_window_days: Number(row.pickup_window_days),
  };
  return { person, studio, token };
}

function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (origin === "null") return false;
  try {
    const originUrl = new URL(origin);
    const host = req.headers.host;
    if (!host) return false;
    const proto = (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
    return originUrl.origin === `${proto}://${host}`;
  } catch {
    return false;
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  let filePath: string | null = null;
  if (pathname === "/" || !pathname.includes(".")) {
    filePath = path.join(publicDir, "index.html");
  } else {
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(publicDir, safe);
    if (full.startsWith(publicDir) && existsSync(full)) {
      const stat = (await import("node:fs")).statSync(full);
      if (stat.isFile()) filePath = full;
    }
  }
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end("Not found");
    return;
  }
  const data = await readFile(filePath);
  const ext = path.extname(filePath);
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": String(data.length),
  };
  if (ext === ".ttf" || ext === ".txt") {
    headers["Cache-Control"] = "public, max-age=3600";
  } else {
    headers["Cache-Control"] = "no-store";
  }
  res.writeHead(200, headers);
  res.end(data);
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const pathname = decodeSegments(url.pathname);
  // Health first: no auth, no body.
  if (req.method === "GET" && pathname === "/api/health") {
    if (schemaReady) {
      sendJson(res, 200, { status: "ok" });
    } else {
      sendJson(res, 503, { status: "starting" });
    }
    return;
  }

  // Until the schema is applied, only health answers normally.
  if (!schemaReady) {
    throw new ApiError(503, "starting", "The app is still starting.");
  }

  // Server boundary refusals, checked before anything else.
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
    throw new ApiError(403, "cross_origin", "Requests from other origins are refused.");
  }

  // Route match (unknown /api paths answer 404 before auth).
  const match = matchRoute(req.method ?? "GET", pathname);
  if (!match) {
    throw new ApiError(404, "not_found", "Not found.");
  }

  const session = await loadSession(req);
  const needsAuth = match.route.auth !== "any";
  if (needsAuth && !session) {
    throw unauthenticated();
  }
  if (session && !session.person.active) {
    // Deactivation ends sessions; a straggler is unauthenticated.
    throw unauthenticated();
  }
  if (session && match.route.auth !== "any") {
    const role = session.person.role;
    const required = match.route.auth;
    if (required === "owner" && role !== "owner") {
      throw new ApiError(403, "forbidden", "Only the studio owner may do that.");
    }
    if (required === "staff" && role !== "owner" && role !== "kiln_tech") {
      throw new ApiError(403, "forbidden", "Only studio staff may do that.");
    }
    if (required === "member" && role !== "member") {
      throw new ApiError(403, "forbidden", "Only members may do that.");
    }
  }

  let raw: Buffer = Buffer.alloc(0);
  let body: Record<string, unknown> = {};
  if (match.route.bodyKind === "json") {
    const parsed = await readJsonBody(req);
    raw = parsed.raw;
    body = parsed.body;
  } else if (match.route.bodyKind === "photo") {
    raw = (await readPhotoBody(req)).raw;
  }
  // bodyKind "none" (GET and SSE) and "raw" (upload with own handling) read lazily.

  const ctx: Ctx = {
    req,
    res,
    url,
    params: match.params,
    query: url.searchParams,
    rawBody: raw,
    body,
    person: session?.person ?? null,
    studio: session?.studio ?? null,
    sessionToken: session?.token ?? null,
  };  await match.route.handler(ctx);
}

// Split the raw path, then percent-decode each segment: a `..%2F` segment stays one
// segment and matches no route, answering 404.
function decodeSegments(pathname: string): string {
  const segs = pathname.split("/");
  const parts = segs.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return parts.join("/");
}

export function createApp(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://internal");
        if (url.pathname === "/api/events") {
          await handleEvents(req, res, url);
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          await handleApi(req, res, url);
          return;
        }
        await serveStatic(res, url.pathname);
      } catch (err) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (err instanceof ApiError) {
          if (err.status === 401) {
            clearCookie(res, "kd_session");
          }
          sendJson(res, err.status, errorBody(err));
          return;
        }
        console.error("unhandled error", err);
        sendJson(res, 500, { error: "internal", message: "Something went wrong. Try again." });
      }
    })();
  });
}

async function handleEvents(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 404, { error: "not_found", message: "Not found." });
    return;
  }
  const session = await loadSession(req);
  if (!session || !session.person.active) {
    sendJson(res, 401, { error: "unauthenticated", message: "Sign in to continue." });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write("retry: 1000\n\n");
  const client = {
    sessionId: session.token,
    studioId: session.studio.id,
    personId: session.person.id,
    role: session.person.role,
    write: (chunk: string) => {
      res.write(chunk);
    },
  };
  addSseClient(client);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* closed */
    }
  }, 15000);
  res.on("close", () => {
    clearInterval(ping);
    removeSseClient(client);
  });
}

export async function startServer(): Promise<void> {
  await startEventListener();
  const server = createApp();
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`kiln-desk listening on ${config.port}`);
  });
  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
}

export { setCookie };
