import { readFileSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSession, tokenHash, type Session } from "./auth";
import { publishedEntry } from "./cms";
import { one } from "./db";
import { HttpError, isUuid } from "./http";
import { canSee, orderById } from "./orders";
import { projectAccess } from "./projects";
import { studioInstant } from "./time";
import type { User } from "../shared/domain";

// Pages are one client app; the server decides each page's status (404, 403, sign-in redirect) on
// first load and hands the app its boot data: the studio clock reading and the signed-in user.

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
const TEMPLATE = readFileSync(path.join(CLIENT_DIR, "index.html"), "utf8");

type PageState = "ok" | "not_found" | "access_ended";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Built assets under /assets only; nothing else on disk is ever served. */
export function serveAsset(res: ServerResponse, pathname: string): boolean {
  if (!pathname.startsWith("/assets/")) return false;
  const file = path.resolve(CLIENT_DIR, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(path.join(CLIENT_DIR, "assets") + path.sep)) return false;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

const PROTECTED = /^\/(portal|studio)(\/|$)/;

async function pageState(pathname: string, session: Session | null): Promise<PageState> {
  const user = session?.user ?? null;
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/" || pathname === "/journal" || pathname === "/sign-in") return "ok";
  if ((parts[0] === "work" || parts[0] === "journal") && parts.length === 2) {
    try {
      return (await publishedEntry(parts[0] === "work" ? "case_study" : "journal", parts[1]!)) ? "ok" : "not_found";
    } catch {
      return "ok";
    }
  }
  if (parts[0] === "checkout" && parts.length === 2) {
    const order = isUuid(parts[1]) ? await orderById(parts[1]) : undefined;
    const access = order ? canSee(order, session) : null;
    return access === "owner" || access === "studio" ? "ok" : "not_found";
  }
  if (parts[0] === "orders" && parts[2] === "receipt" && parts.length === 3) {
    const order = isUuid(parts[1]) ? await orderById(parts[1]) : undefined;
    const access = order ? canSee(order, session) : null;
    if (!order || (access !== "owner" && access !== "studio")) return "not_found";
    return (await one("SELECT 1 FROM payments WHERE order_id = $1", [order.id])) ? "ok" : "not_found";
  }
  if (parts[0] === "invite" && parts.length === 2) {
    return (await one("SELECT 1 FROM invites WHERE token_hash = $1", [tokenHash(parts[1]!)])) ? "ok" : "not_found";
  }
  if (!user) return "not_found";
  if (pathname === "/studio") return user.role === "studio_owner" ? "ok" : "not_found";
  if (pathname === "/portal") return "ok";
  if (pathname === "/portal/plan" || pathname === "/portal/invoices") return user.role === "client_owner" ? "ok" : "not_found";
  if (parts[0] === "portal" && parts[1] === "projects" && parts.length === 3) {
    if (!isUuid(parts[2])) return "not_found";
    try {
      await projectAccess(parts[2], user);
      return "ok";
    } catch (error) {
      if (error instanceof HttpError && error.code === "access_ended") return "access_ended";
      return "not_found";
    }
  }
  return "not_found";
}

function boot(state: PageState, user: User | null): string {
  const data = JSON.stringify({ now: studioInstant(new Date()), user, page: state }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("</head>", `<script id="boot" type="application/json">${data}</script></head>`);
}

export async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const session = await loadSession(req).catch(() => null);
  if (PROTECTED.test(url.pathname) && !session?.user) {
    res.writeHead(302, { Location: `/sign-in?next=${encodeURIComponent(url.pathname)}`, "Cache-Control": "no-store" }).end();
    return;
  }
  const state = await pageState(url.pathname, session).catch((): PageState => "ok");
  const html = boot(state, session?.user ?? null);
  const status = state === "not_found" ? 404 : state === "access_ended" ? 403 : 200;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}
