// The HTTP boundary: routing, body limits, the origin rule, cookies, static files and the one error shape.
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const JSON_LIMIT = 65_536;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  cookies: Record<string, string>;
  body: unknown;
};

/** A JSON reply, or `"sent"` when the handler streamed its own response. */
export type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "sent";
type Handler = (ctx: Context) => Promise<Reply>;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; multipart: boolean };
const routes: Route[] = [];

export function route(method: string, template: string, handler: Handler, options: { multipart?: boolean } = {}): void {
  const keys: string[] = [];
  const source = template.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, multipart: options.multipart ?? false });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The public origin: APP_PUBLIC_URL, or else the origin of this request. */
export function publicOrigin(req: IncomingMessage): string {
  return config.publicUrl ?? `http://${req.headers.host ?? `localhost:${config.port}`}`;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "null") return origin === undefined;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === req.headers.host || (config.publicUrl !== null && host === new URL(config.publicUrl).host);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > JSON_LIMIT) throw new ApiError("payload_too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > JSON_LIMIT) throw new ApiError("payload_too_large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return {};
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(payload)) }),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, error.status, error.body(), error.headers);
}

/** Finish an upload early: answer, then drain whatever the client still sends so the answer is not lost to a reset. */
export function answerAndDrain(req: IncomingMessage, res: ServerResponse, error: ApiError): void {
  sendError(res, error);
  res.once("finish", () => {
    const deadline = setTimeout(() => req.socket.destroy(), 5_000);
    req.once("end", () => {
      clearTimeout(deadline);
      req.socket.end();
    });
    req.resume();
  });
}

// ---------- static client build and HTML pages ----------

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

function listAssets(dir: string, prefix = ""): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) for (const [key, value] of listAssets(full, `${prefix}/${name}`)) found.set(key, value);
    else if (name !== "index.html") found.set(`${prefix}/${name}`, full);
  }
  return found;
}

const assets = listAssets(path.join(CLIENT_DIR, "assets"), "/assets");
const shell = readFileSync(path.join(CLIENT_DIR, "index.html"), "utf8");

export function serveAsset(pathname: string, res: ServerResponse): boolean {
  const file = assets.get(pathname);
  if (!file) return false;
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": String(statSync(file).size), "Cache-Control": "public, max-age=31536000, immutable" });
  createReadStream(file).pipe(res);
  return true;
}

const NAV_LINKS = [["/#work", "01 Work"], ["/#services", "02 Services"], ["/#studio", "03 Studio"], ["/#insights", "04 Insights"], ["/start", "05 Start a project"]]
  .map(([href, label]) => `<li><a href="${href}">${label}</a></li>`)
  .join("");
const NOT_FOUND_MAIN = `<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="wrap header-bar"><nav aria-label="Main" class="main-nav"><span class="brand-mark">Gloamwork</span><ul class="nav-links">${NAV_LINKS}</ul></nav></div></header><main id="main" tabindex="-1" class="wrap not-found"><h1>We couldn&#39;t find that page</h1><p>The link may have expired, been withdrawn, or never existed.</p><p><a href="/">Back to the studio</a></p></main>`;

/** Sends the app shell; `inline` is JSON placed in the page so the first render needs no extra request. */
export function sendPage(res: ServerResponse, status: 200 | 404, headers: Record<string, string> = {}, inline: unknown = null): void {
  let html = status === 404 ? shell.replace('<div id="app"></div>', `<div id="app">${NOT_FOUND_MAIN}</div>`) : shell;
  if (inline !== null) html = html.replace("</head>", `<script type="application/json" id="studio-content">${JSON.stringify(inline).replace(/</g, "\\u003c")}</script></head>`);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { ...SECURITY_HEADERS, Location: location, "Cache-Control": "no-store" });
  res.end();
}

// ---------- dispatch ----------

export async function dispatchApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const lookup = method === "HEAD" ? "GET" : method;
  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    if (candidate.method !== lookup) continue;
    const found = candidate.pattern.exec(url.pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => (params[key] = decodeURIComponent(found[index + 1] ?? "")));
    matched = { route: candidate, params };
    break;
  }
  try {
    let body: unknown = {};
    if (STATE_CHANGING.has(method) && !matched?.route.multipart) body = await readJsonBody(req);
    if (STATE_CHANGING.has(method) && !sameOrigin(req)) throw new ApiError("cross_origin");
    if (!matched) throw new ApiError("not_found");
    const ctx: Context = { req, res, url, params: matched.params, cookies: parseCookies(req.headers.cookie), body };
    const reply = await matched.route.handler(ctx);
    if (reply !== "sent") sendJson(res, reply.status, reply.body, reply.headers);
  } catch (error) {
    if (error instanceof ApiError) sendError(res, error);
    else {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: "internal", message: "Something went wrong. Please try again." });
      else res.destroy();
    }
  }
}
