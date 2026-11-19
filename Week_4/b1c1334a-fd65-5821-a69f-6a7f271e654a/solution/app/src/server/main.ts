// The HTTP server: health, the API routes in their error precedence, and the built client.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Account, clearedCookie, currentAccount, sessionCookie, signIn, signOut } from "./auth.js";
import { config } from "./config.js";
import { DatabaseUnavailable, ensureReady } from "./db.js";
import * as docs from "./documents.js";
import { runEdit } from "./edit.js";
import { contentDisposition, createExport, downloadExport, getExport, listExports } from "./exports.js";
import { ApiError, type Reply, type Request, errorReply, json, notFound, readRequest, send } from "./http.js";
import { listShares, resend, share } from "./shares.js";
import { seed } from "./seed.js";

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

type Handler = (req: Request, account: Account, params: string[]) => Promise<Reply>;

const D = "/api/documents/([^/]+)";
const T = `${D}/tables/([^/]+)`;

// Every route but sign-in and health needs a session.
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/me$/, async (_r, a) => json(200, { user: a })],
  ["GET", /^\/api\/documents$/, (_r, a) => docs.listDocuments(a)],
  ["POST", /^\/api\/documents$/, (r, a) => docs.createDocument(r, a)],
  ["GET", new RegExp(`^${D}$`), (_r, a, [d]) => docs.getDocument(a, d!)],
  ["GET", new RegExp(`^${D}/history$`), (_r, a, [d]) => docs.getHistory(a, d!)],
  ["POST", new RegExp(`^${D}/tables$`), (r, a, [d]) => runEdit(r, a, d!, docs.createTable(r))],
  ["GET", new RegExp(`^${T}$`), (_r, a, [d, t]) => docs.getTable(a, d!, t!)],
  ["PATCH", new RegExp(`^${T}$`), (r, a, [d, t]) => runEdit(r, a, d!, docs.renameTable(r, t!))],
  ["POST", new RegExp(`^${T}/columns$`), (r, a, [d, t]) => runEdit(r, a, d!, docs.addColumn(r, t!))],
  ["PATCH", new RegExp(`^${T}/columns/([^/]+)$`), (r, a, [d, t, c]) => runEdit(r, a, d!, docs.updateColumn(r, t!, c!))],
  ["DELETE", new RegExp(`^${T}/columns/([^/]+)$`), (r, a, [d, t, c]) => runEdit(r, a, d!, docs.deleteColumn(t!, c!))],
  ["PUT", new RegExp(`^${T}/access$`), (r, a, [d, t]) => runEdit(r, a, d!, docs.setAccess(r, t!))],
  ["POST", new RegExp(`^${T}/rows$`), (r, a, [d, t]) => runEdit(r, a, d!, docs.addRow(r, t!))],
  ["DELETE", new RegExp(`^${T}/rows/([^/]+)$`), (r, a, [d, t, w]) => runEdit(r, a, d!, docs.deleteRow(r, t!, w!))],
  ["PUT", new RegExp(`^${T}/rows/([^/]+)/cells/([^/]+)$`), (r, a, [d, t, w, c]) => runEdit(r, a, d!, docs.writeCell(r, t!, w!, c!))],
  ["POST", new RegExp(`^${T}/cells$`), (r, a, [d, t]) => runEdit(r, a, d!, docs.paste(r, t!))],
  ["POST", new RegExp(`^${D}/undo$`), (r, a, [d]) => runEdit(r, a, d!, docs.undo())],
  ["POST", new RegExp(`^${D}/redo$`), (r, a, [d]) => runEdit(r, a, d!, docs.redo())],
  ["POST", new RegExp(`^${D}/summaries$`), (r, a, [d]) => runEdit(r, a, d!, docs.createSummary(r))],
  ["POST", new RegExp(`^${T}/formula-preview$`), (r, a, [d, t]) => docs.previewFormula(r, a, d!, t!)],
  ["GET", new RegExp(`^${D}/shares$`), (_r, a, [d]) => listShares(a, d!)],
  ["POST", new RegExp(`^${D}/shares$`), (r, a, [d]) => share(r, a, d!)],
  ["POST", new RegExp(`^${D}/shares/([^/]+)/resend$`), (_r, a, [d, s]) => resend(a, d!, s!)],
  ["POST", new RegExp(`^${T}/exports$`), (_r, a, [d, t]) => createExport(a, d!, t!)],
  ["GET", new RegExp(`^${D}/exports$`), (_r, a, [d]) => listExports(a, d!)],
  ["GET", /^\/api\/exports\/([^/]+)$/, (_r, a, [x]) => getExport(a, x!)],
];

const DATABASE_DOWN = new ApiError(503, "database_unavailable", "The database is unreachable. Try again shortly.");

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  return error instanceof DatabaseUnavailable || /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|57P0|08)/.test(code) ||
    /Connection terminated|connect ECONNREFUSED|timeout exceeded when trying to connect/.test(String(error));
}

async function api(req: Request): Promise<Reply | { download: { body: Buffer; fileName: string } }> {
  if (req.path === "/api/health") return json(200, { status: "ok" });
  await ensureReady(seed);
  if (req.method === "POST" && req.path === "/api/auth/sign-in") {
    const { account, token } = await signIn(req);
    return json(200, { user: account }, { "Set-Cookie": sessionCookie(token) });
  }
  const account = await currentAccount(req);
  if (req.method === "POST" && req.path === "/api/auth/sign-out") {
    if (!account) throw new ApiError(401, "unauthenticated", "Sign in first.");
    await signOut(req);
    return { status: 204, body: "", headers: { "Set-Cookie": clearedCookie } };
  }
  const download = /^\/api\/exports\/([^/]+)\/download$/.exec(req.path);
  const route = download && req.method === "GET" ? null : routes.find(([m, p]) => m === req.method && p.test(req.path));
  if (!route && !(download && req.method === "GET")) throw notFound();
  if (!account) throw new ApiError(401, "unauthenticated", "Sign in first.");
  if (download) return { download: await downloadExport(account, download[1]!) };
  const [, pattern, handler] = route!;
  let params: string[];
  try {
    params = pattern.exec(req.path)!.slice(1).map(decodeURIComponent);
  } catch {
    throw notFound();
  }
  return handler(req, account, params);
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SECURITY = {
  "Content-Security-Policy":
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Referrer-Policy": "same-origin",
};

let shell: Buffer | null = null;

// Only the built client assets and the app shell are ever served.
async function serveClient(pathname: string, res: import("node:http").ServerResponse): Promise<void> {
  if (pathname.startsWith("/assets/") && !pathname.includes("..")) {
    const ext = path.extname(pathname);
    const type = TYPES[ext];
    if (type) {
      try {
        const body = await readFile(path.join(CLIENT_DIR, pathname));
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
        res.end(body);
        return;
      } catch {
        // Falls through to the shell, like any other unknown path.
      }
    }
  }
  shell ??= await readFile(path.join(CLIENT_DIR, "index.html"));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...SECURITY });
  res.end(shell);
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", config.publicUrl).pathname;
  if (!pathname.startsWith("/api/") && pathname !== "/api") {
    if (req.method === "GET" || req.method === "HEAD") return serveClient(pathname, res).catch(() => res.destroy());
    return send(res, errorReply(notFound()));
  }
  try {
    const request = await readRequest(req);
    if (request instanceof ApiError) {
      send(res, { ...errorReply(request), headers: request.status === 413 ? { Connection: "close" } : {} });
      return;
    }
    const reply = await api(request);
    if ("download" in reply) {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition(reply.download.fileName),
        "Content-Length": String(reply.download.body.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(reply.download.body);
      return;
    }
    send(res, reply);
  } catch (error) {
    if (error instanceof ApiError) return send(res, errorReply(error));
    if (isConnectionError(error)) return send(res, errorReply(DATABASE_DOWN));
    console.error(error);
    send(res, errorReply(new ApiError(500, "internal", "Something went wrong.")));
  }
});

server.keepAliveTimeout = 5000;
server.listen(config.port, config.bindHost, () => {
  console.log(`Tallyframe listening on ${config.bindHost}:${config.port}`);
  ensureReady(seed).catch((error: unknown) => console.error(`Database not ready yet: ${String(error)}`));
});
