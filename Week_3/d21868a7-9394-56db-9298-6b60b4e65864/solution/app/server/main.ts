// Ditchbook server: the API under /api and the bundled single-page app, on one origin.
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { HOME, isPageRoute, mayOpen, signInFor } from "../shared/roles.ts";
import { SESSION_COOKIE, sessionUser } from "./auth.ts";
import { config } from "./config.ts";
import { isReady, prepareDatabase, read } from "./db.ts";
import { ApiError, SECURITY_HEADERS, databaseUnavailable, parseCookies, sendBytes, sendError, sendJson } from "./http.ts";
import { handleApi } from "./routes.ts";
import { startWorker } from "./worker.ts";

const CLIENT = join(import.meta.dirname, "client");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

/** Only the built bundle is ever served: a fixed map of file name to bytes, read once. */
const assets = new Map<string, Buffer>(
  readdirSync(join(CLIENT, "assets")).map((name) => [`/assets/${name}`, readFileSync(join(CLIENT, "assets", name))]),
);
assets.set("/favicon.svg", readFileSync(join(CLIENT, "favicon.svg")));
const shell = readFileSync(join(CLIENT, "index.html"));

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { ...SECURITY_HEADERS, Location: location, "Cache-Control": "no-store" }).end();
}

async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const asset = assets.get(url.pathname);
  if (asset) {
    sendBytes(res, 200, asset, {
      "Content-Type": TYPES[extname(url.pathname)] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    return;
  }
  if (isReady()) {
    const user = await read((db) => sessionUser(db, parseCookies(req.headers.cookie).get(SESSION_COOKIE))).catch(() => null);
    // Signed out, a page route goes to sign-in with its return path; signed in, sign-in, the root and
    // another role's page routes go to the role's home route. Unknown paths show Page not found.
    const signInPage = url.pathname === "/sign-in";
    const root = url.pathname === "/";
    if (!user && root) return redirect(res, "/sign-in");
    if (!user && isPageRoute(url.pathname)) return redirect(res, signInFor(url.pathname + url.search));
    if (user && (signInPage || root || (isPageRoute(url.pathname) && !mayOpen(user.role, url.pathname)))) {
      return redirect(res, HOME[user.role]);
    }
  }
  sendBytes(res, 200, shell, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://ditchbook.invalid");
  if (url.pathname === "/api/health") {
    if (isReady()) sendJson(res, 200, { status: "ok" });
    else sendError(res, databaseUnavailable());
    return;
  }
  const work = url.pathname.startsWith("/api/") || url.pathname === "/api" ? handleApi(req, res, url) : servePage(req, res, url);
  work.catch((error: Error) => {
    console.error(error);
    if (!res.headersSent) sendError(res, new ApiError(500, "internal_error", "Something went wrong on the server."));
  });
});

server.listen(config.port, "0.0.0.0", () => console.log(`Ditchbook listening on ${config.port}`));
void prepareDatabase().then(startWorker);
