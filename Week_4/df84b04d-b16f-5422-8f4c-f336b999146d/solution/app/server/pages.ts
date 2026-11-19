import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { meFor, sessionFor } from "./accounts.js";
import { ownerOfBullet, readOutline } from "./commit.js";
import { cookieValue, type Session } from "./http.js";
import { readInvitation } from "./invitations.js";

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

let template: string | null = null;

async function shell(session: Session | null): Promise<string> {
  template ??= await readFile(path.join(CLIENT_DIR, "index.html"), "utf8");
  const boot = JSON.stringify({ me: session === null ? null : await meFor(session) }).replace(/</g, "\\u003c");
  return template.replace("<!--boot-->", `<script id="boot" type="application/json">${boot}</script>`);
}

async function openable(session: Session, id: string): Promise<boolean> {
  try {
    const owner = await ownerOfBullet(id);
    const { scope } = await readOutline(session, owner);
    return scope.canSee(id);
  } catch {
    return false;
  }
}

async function invitationExists(token: string): Promise<boolean> {
  try {
    await readInvitation(token);
    return true;
  } catch {
    return false;
  }
}

async function file(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const target = path.normalize(path.join(CLIENT_DIR, pathname));
  if (!target.startsWith(CLIENT_DIR + path.sep) || target === path.join(CLIENT_DIR, "index.html")) return null;
  try {
    return { body: await readFile(target), type: TYPES[path.extname(target)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

function html(res: ServerResponse, status: number, body: string, method: string): void {
  res.writeHead(status, { "Content-Type": TYPES[".html"] ?? "text/html", "Cache-Control": "no-store" });
  res.end(method === "HEAD" ? undefined : body);
}

export async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const found = await file(decodeURIComponent(url.pathname));
  if (found !== null) {
    const immutable = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/");
    const headers: Record<string, string> = { "Content-Type": found.type, "Cache-Control": immutable ? "public, immutable" : "no-cache" };
    if (immutable) headers.Expires = new Date(Date.now() + 365 * 86_400_000).toUTCString();
    res.writeHead(200, headers);
    res.end(method === "HEAD" ? undefined : found.body);
    return;
  }
  const session = await sessionFor(cookieValue(req, "twig_session"));
  const bulletRoute = /^\/b\/([^/]+)\/?$/.exec(url.pathname);
  if (bulletRoute !== null) {
    if (session === null) {
      res.writeHead(302, { Location: `/signin?next=${encodeURIComponent(url.pathname.replace(/\/$/, ""))}` });
      res.end();
      return;
    }
    if (!(await openable(session, decodeURIComponent(bulletRoute[1] ?? "")))) {
      html(res, 404, await shell(session), method);
      return;
    }
  }
  const invitation = /^\/invite\/([^/]+)\/?$/.exec(url.pathname);
  if (invitation !== null && !(await invitationExists(decodeURIComponent(invitation[1] ?? "")))) {
    html(res, 404, await shell(session), method);
    return;
  }
  html(res, 200, await shell(session), method);
}
