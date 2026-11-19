// Page requests: the single-page app shell with the right status, plus the app's own static files.
import { readFile, readdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { findSession, type SessionUser } from "./auth.js";
import { loadProducts } from "./catalogue.js";
import { loadVisibleOrder } from "./orders.js";
import { sendReply } from "./http.js";
import { type RouteKind, classifyRoute, roleOfRoute } from "../shared/routes.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

const NOT_FOUND_COPY = "We couldn't find that page.";

let shell = "";
const assets = new Set<string>();

export async function loadPages(): Promise<void> {
  shell = await readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (path.extname(entry.name) in CONTENT_TYPES && entry.name !== "index.html") assets.add(`/${path.relative(PUBLIC_DIR, full).split(path.sep).join("/")}`);
    }
  };
  await walk(PUBLIC_DIR);
}

/** Whether a signed-in person may open this address; an address they may not see is the not-found screen. */
async function mayOpen(user: SessionUser, kind: RouteKind, id: string): Promise<boolean> {
  if (kind === "public") return true;
  const owner = roleOfRoute(kind);
  if (owner !== null && owner !== user.role) return false;
  if (kind === "shop") return user.shopIds.includes(id);
  if (kind === "product") return (await loadProducts(user)).some((product) => product.sku === id);
  if (kind === "care-order" || kind === "order") return (await loadVisibleOrder(pool, user, id)) !== null;
  return true;
}

function html(res: ServerResponse, status: number, body: string, signedIn: boolean): void {
  const marker = `<meta name="tramela-session" content="${signedIn ? "in" : "out"}">`;
  sendReply(res, { status, text: body.replace("<!--session-->", marker), contentType: "text/html; charset=utf-8" });
}

export async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    html(res, 404, shell.replace("<!--root-->", `<h1>${NOT_FOUND_COPY}</h1>`), false);
    return;
  }
  const asset = assets.has(url.pathname);
  if (asset) {
    const content = await readFile(path.join(PUBLIC_DIR, url.pathname));
    res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(url.pathname)] ?? "application/octet-stream", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" });
    res.end(content);
    return;
  }
  const { kind, id } = classifyRoute(url.pathname);
  const user = await findSession(req.headers.cookie);
  if (kind !== "public" && kind !== "unknown" && !user) {
    sendReply(res, { status: 302, text: "", headers: { location: `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}` } });
    return;
  }
  const allowed = kind === "unknown" ? false : user ? await mayOpen(user, kind, id) : true;
  html(res, allowed ? 200 : 404, allowed ? shell : shell.replace("<!--root-->", `<h1>${NOT_FOUND_COPY}</h1>`), user !== null);
}
