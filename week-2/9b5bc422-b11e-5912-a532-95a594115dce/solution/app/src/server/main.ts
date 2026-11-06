import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAccount, createSession, deleteDevice, deleteSession, getSession, listDevices } from "./accounts.ts";
import { deleteAttachment, getAttachment, putAttachment, removeAwaitedObjects } from "./attachments.ts";
import { config } from "./config.ts";
import { databaseReachable } from "./db.ts";
import { ApiError, notFound, sendError, sendJson, unavailable } from "./http.ts";
import { createShare, deleteShare, getShare, getShared, getSharedAttachment } from "./shares.ts";
import { serveAsset } from "./static.ts";
import { storageReachable } from "./storage.ts";
import { exchange } from "./sync.ts";

const RETRY_MS = 2000;

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;
type Route = { method: string; pattern: RegExp; handler: Handler };

/** Postgres cannot hold a NUL, so an id with one is swapped for a character that matches nothing and stays unknown. */
function param(params: string[], index: number): string {
  const raw = params[index] ?? "";
  try {
    return decodeURIComponent(raw).replaceAll("\0", "\uFFFD");
  } catch {
    return raw;
  }
}

const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/health$/,
    handler: async (_req, res) => {
      const [database, storage] = await Promise.all([databaseReachable(), storageReachable()]);
      sendJson(res, 200, { status: database && storage ? "ok" : "unavailable" });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/status$/,
    handler: async (_req, res) => {
      const [database, storage] = await Promise.all([databaseReachable(), storageReachable()]);
      sendJson(res, 200, { sync: database ? "ok" : "unavailable", storage: storage ? "ok" : "unavailable" });
    },
  },
  { method: "GET", pattern: /^\/api\/session$/, handler: getSession },
  { method: "POST", pattern: /^\/api\/accounts$/, handler: createAccount },
  { method: "POST", pattern: /^\/api\/sessions$/, handler: createSession },
  { method: "DELETE", pattern: /^\/api\/session$/, handler: deleteSession },
  { method: "GET", pattern: /^\/api\/devices$/, handler: listDevices },
  { method: "DELETE", pattern: /^\/api\/devices\/([^/]+)$/, handler: (req, res, p) => deleteDevice(req, res, param(p, 0)) },
  { method: "PUT", pattern: /^\/api\/attachments\/([^/]+)$/, handler: (req, res, p) => putAttachment(req, res, param(p, 0)) },
  { method: "GET", pattern: /^\/api\/attachments\/([^/]+)$/, handler: (req, res, p) => getAttachment(req, res, param(p, 0)) },
  { method: "DELETE", pattern: /^\/api\/attachments\/([^/]+)$/, handler: (req, res, p) => deleteAttachment(req, res, param(p, 0)) },
  { method: "GET", pattern: /^\/api\/documents\/([^/]+)\/share$/, handler: (req, res, p) => getShare(req, res, param(p, 0)) },
  { method: "POST", pattern: /^\/api\/documents\/([^/]+)\/share$/, handler: (req, res, p) => createShare(req, res, param(p, 0)) },
  { method: "DELETE", pattern: /^\/api\/documents\/([^/]+)\/share$/, handler: (req, res, p) => deleteShare(req, res, param(p, 0)) },
  { method: "GET", pattern: /^\/api\/shared\/([^/]+)$/, handler: (_req, res, p) => getShared(res, param(p, 0)) },
  { method: "GET", pattern: /^\/api\/shared\/([^/]+)\/attachments\/([^/]+)$/, handler: (_req, res, p) => getSharedAttachment(res, param(p, 0), param(p, 1)) },
  { method: "POST", pattern: /^\/api\/sync$/, handler: exchange },
];

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function foreignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !STATE_CHANGING.has(req.method ?? "")) return false;
  return URL.canParse(origin) ? new URL(origin).host !== req.headers.host : true;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (foreignOrigin(req)) throw new ApiError(403, { form: "Cross-origin requests are not allowed." });
  if (/^\/api\/shared\/[^/]+(\/.*)?$/.test(pathname) && STATE_CHANGING.has(req.method ?? "")) {
    throw new ApiError(405, { form: "This link is read only." });
  }
  for (const route of routes) {
    const match = route.method === req.method ? route.pattern.exec(pathname) : null;
    if (match) return route.handler(req, res, match.slice(1));
  }
  throw notFound();
}

async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = (req.url ?? "/").split(/[?#]/, 1)[0] ?? "/";
  if (!pathname.startsWith("/api/")) return serveAsset(res, pathname);
  try {
    await handleApi(req, res, pathname);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("request failed", pathname, error);
    if (!res.headersSent) sendError(res, error instanceof ApiError ? error : unavailable());
  } finally {
    req.resume();
  }
}

const server = createServer((req, res) => void respond(req, res));

server.listen(config.port, "0.0.0.0", () => console.log(`Oddment listening on ${config.port}`));

async function keepDependenciesInUse(): Promise<void> {
  if ((await databaseReachable()) && (await storageReachable())) {
    await removeAwaitedObjects().catch((error: unknown) => console.error("object removal failed", error));
  }
}

void keepDependenciesInUse();
setInterval(() => void keepDependenciesInUse(), RETRY_MS);
