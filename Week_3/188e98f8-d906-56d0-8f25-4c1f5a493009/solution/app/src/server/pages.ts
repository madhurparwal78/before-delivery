import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_PATHS, SIGN_IN_PATH, deskPath, mayOpen } from "../shared/roles";
import { findSession } from "./sessions";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const shell = readFileSync(path.join(PUBLIC_DIR, "index.html"));

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const body = readFileSync(file);
  const immutable = file.includes(`${path.sep}fonts${path.sep}`);
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

function sendShell(req: IncomingMessage, res: ServerResponse, status: number): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": shell.length, "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : shell);
}

/** Page paths, built assets and the not-found screen. Nothing outside the built assets is ever served. */
export async function servePage(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  const asset = /^\/(assets|fonts)\/([A-Za-z0-9._-]+)$/.exec(pathname);
  if (asset !== null && sendFile(req, res, path.join(PUBLIC_DIR, asset[1] as string, asset[2] as string))) return;
  if (!PAGE_PATHS.includes(pathname)) {
    sendShell(req, res, 404);
    return;
  }
  const session = pathname === "/" ? null : await findSession(req);
  if (pathname === SIGN_IN_PATH && session !== null) return redirect(res, deskPath(session.role));
  if (pathname !== "/" && pathname !== SIGN_IN_PATH) {
    if (session === null) return redirect(res, SIGN_IN_PATH);
    if (!mayOpen(session.role, pathname)) return redirect(res, deskPath(session.role));
  }
  sendShell(req, res, 200);
}

