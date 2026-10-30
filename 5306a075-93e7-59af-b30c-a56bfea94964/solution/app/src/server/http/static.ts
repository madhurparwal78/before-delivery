// The built client: only files Vite emitted under assets/, and the HTML shell for the brief's routes.
import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeLinkWorkspace, PUBLIC_HEADERS } from "../routes/shareLinks.js";
import { currentSession } from "./auth.js";
import { send } from "./router.js";

const CLIENT = fileURLToPath(new URL("../../../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml",
};

const assets = new Map(
  readdirSync(join(CLIENT, "assets"))
    .filter((name) => extname(name) in TYPES)
    .map((name) => [`/assets/${name}`, { type: TYPES[extname(name)] ?? "application/octet-stream", bytes: readFileSync(join(CLIENT, "assets", name)) }]),
);
const shell = readFileSync(join(CLIENT, "index.html"));

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
};

const MEMBER_PAGES = [/^\/inbox(\/[^/]+)?$/, /^\/features(\/[^/]+)?$/, /^\/roadmap$/, /^\/companies(\/[^/]+)?$/, /^\/import$/, /^\/settings$/];
const OPEN_PAGES = [/^\/signin$/, /^\/invite\/[^/]+$/];

export async function serveClient(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const asset = req.method === "GET" ? assets.get(path) : undefined;
  if (asset) {
    send(res, { status: 200, body: asset.bytes, headers: { "Content-Type": asset.type, "Cache-Control": "public, max-age=31536000, immutable" } });
    return;
  }
  if (req.method !== "GET") {
    send(res, { status: 404, body: "Not found", headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return;
  }
  const publicRoadmap = /^\/r\/([^/]+)$/.exec(path);
  if (publicRoadmap) {
    const active = (await activeLinkWorkspace(publicRoadmap[1] ?? "")) !== null;
    send(res, { status: active ? 200 : 404, body: shell, headers: { ...HTML_HEADERS, ...PUBLIC_HEADERS } });
    return;
  }
  if (path === "/") {
    send(res, { status: 302, headers: { Location: "/inbox" } });
    return;
  }
  if (MEMBER_PAGES.some((page) => page.test(path))) {
    if ((await currentSession(req)) === null) send(res, { status: 302, headers: { Location: "/signin" } });
    else send(res, { status: 200, body: shell, headers: HTML_HEADERS });
    return;
  }
  if (OPEN_PAGES.some((page) => page.test(path))) {
    send(res, { status: 200, body: shell, headers: HTML_HEADERS });
    return;
  }
  send(res, { status: 404, body: "Not found", headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
