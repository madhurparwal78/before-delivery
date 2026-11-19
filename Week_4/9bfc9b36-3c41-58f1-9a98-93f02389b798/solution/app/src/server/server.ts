/** The HTTP server: the API pipeline in its one published order, and the static shell of the single-page app. */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountByIdentity, type AccountRow } from "./accounts.js";
import { databaseState, isConnectionError, pool } from "./db.js";
import { Refusal, databaseUnavailable, identityUnavailable, refuse } from "./errors.js";
import { Ladder } from "./ladder.js";
import { outage } from "./lifecycle.js";
import {
  BASE_HEADERS, JSON_LIMIT, NOT_FOUND_REPLY, PHOTO_LIMIT, SESSION_COOKIE, cookieValue, findRoute, isTooLarge, parseJson, readBody, send, sendRefusal, type Ctx, type Route,
} from "./http.js";
import { verifyToken } from "./identity.js";
import { openSession } from "./session.js";
import { peopleRoutes } from "./routes-people.js";
import { workRoutes } from "./routes-work.js";
import { matchScreen } from "../shared/routes.js";

const routes: Route[] = [...peopleRoutes, ...workRoutes];
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const mediaType = (headers: IncomingMessage["headers"]): string => String(headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();

function mediaRefusal(route: Route, headers: IncomingMessage["headers"], bytes: Buffer): Refusal | null {
  if (route.body === "json" && bytes.length > 0 && mediaType(headers) !== "application/json") return refuse("unsupported_media");
  if (route.body === "photo") {
    const type = mediaType(headers);
    const signature = type === "image/jpeg" ? JPEG : type === "image/png" ? PNG : null;
    if (!signature || bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) return refuse("unsupported_media");
  }
  return null;
}

async function authenticate(req: IncomingMessage, route: Route): Promise<AccountRow | null> {
  if (route.auth === "public") return null;
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const cookie = req.method === "GET" ? cookieValue(req.headers, SESSION_COOKIE) : null;
  let subject: string | undefined;
  if (bearer) {
    subject = (await verifyToken(bearer[1]!))?.sub;
  } else if (cookie) {
    subject = openSession(cookie)?.sub;
  }
  const account = subject ? await accountByIdentity(pool, subject) : null;
  if (!account) throw refuse("unauthenticated");
  return account;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams): Promise<void> {
  const found = findRoute(routes, req.method ?? "GET", pathname);
  if (!found) {
    req.resume();
    send(res, NOT_FOUND_REPLY);
    return;
  }
  const { route, params } = found;
  try {
    const transport = new Ladder();
    let bytes = Buffer.alloc(0);
    if (req.method !== "GET") {
      try {
        bytes = await readBody(req, route.body === "photo" ? PHOTO_LIMIT : JSON_LIMIT);
      } catch (error) {
        if (!isTooLarge(error)) throw error;
        transport.consider(refuse("too_large"));
      }
    }
    if (!transport.refused) transport.consider(mediaRefusal(route, req.headers, bytes));
    transport.settle();
    if (route.pattern !== "/api/health" && !databaseState.ready) throw (await outage()) === "identity" ? identityUnavailable() : databaseUnavailable();
    const actor = await authenticate(req, route);
    const ctx: Ctx = { method: req.method ?? "GET", query, params, headers: req.headers, bytes, actor: actor as AccountRow, json: () => parseJson(bytes) };
    send(res, await route.handler(ctx));
  } catch (error) {
    if (error instanceof Refusal) return sendRefusal(res, error);
    if (isConnectionError(error)) {
      databaseState.ready = false;
      return sendRefusal(res, databaseUnavailable());
    }
    if (error instanceof Error && /timeout exceeded when trying to connect/.test(error.message)) return sendRefusal(res, databaseUnavailable());
    process.stderr.write(`[boltrope] ${req.method} ${pathname} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    sendRefusal(res, refuse("server_error"));
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

let shell: Buffer | null = null;

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (pathname.startsWith("/assets/") && !pathname.includes("..")) {
    try {
      const file = path.join(publicDirectory, pathname);
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    } catch {
      // fall through to the not-found page
    }
  }
  shell ??= await readFile(path.join(publicDirectory, "index.html"));
  const known = matchScreen(pathname) !== null && !pathname.startsWith("/assets/");
  res.writeHead(known ? 200 : 404, {
    ...BASE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "content-length": shell.length,
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "referrer-policy": "no-referrer",
  });
  res.end(req.method === "HEAD" ? undefined : shell);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const work = url.pathname === "/api" || url.pathname.startsWith("/api/") ? handleApi(req, res, url.pathname, url.searchParams) : serveStatic(req, res, url.pathname);
    work.catch((error) => {
      process.stderr.write(`[boltrope] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
}
