import { readJsonBody, parseCookies, type Request, type Route } from "./http.js";
import { json } from "./respond.js";
import { err, ApiError, type Ctx } from "./core.js";
import { verifySession } from "./session.js";
import { appShell } from "./pages.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const assetRoot = join(process.cwd(), "dist", "public");


/** App paths that need sign-in before viewing. */
const PROTECTED_PREFIXES = ["/documents", "/templates", "/team"];
const ASSET_WHITELIST = /^\/(app\.js|app\.css|fonts\/[^/]+\.(woff2|woff|ttf)|pdf\.worker\.min\.mjs)$/;

export async function handleRequest(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  ctx: Ctx,
  routes: Route[],
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");

  // Same-origin only for state changes
  const origin = req.headers.origin;
  if (origin && method !== "GET" && method !== "HEAD") {
    const same = origin.replace(/\/+$/, "") === ctx.cfg.publicUrl
      || origin === new URL(ctx.cfg.publicUrl).origin;
    if (!same) throw err(403, "forbidden");
  }

  const cookies = parseCookies(req.headers.cookie);
  const actor = await verifySession(ctx, cookies);

  // Static assets first
  if (method === "GET" && ASSET_WHITELIST.test(pathname)) {
    const file = join(assetRoot, pathname);
    if (existsSync(file)) {
      const bytes = readFileSync(file);
      const ext = pathname.slice(pathname.lastIndexOf("."));
      const types: Record<string, string> = {
        ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
      };
      res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream", "content-length": bytes.length, "cache-control": "no-cache" });
      res.end(bytes);
      return;
    }
    throw err(404, "not_found");
  }

  // API routes
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/health") {
      json(res, 200, { status: "ok" });
      return;
    }
    let body: unknown = null;
    let matched: { route: Route; params: Record<string, string | undefined> } | null = null;
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.pattern, pathname);
      if (params) { matched = { route, params }; break; }
    }
    if (matched && method !== "GET" && method !== "HEAD") {
      const contentType = String(req.headers["content-type"] ?? "");
      if (!contentType.includes("multipart/form-data")) {
        try {
          body = await readJsonBody(req);
        } catch (e) {
          if (e instanceof ApiError) {
            json(res, e.status, e.body);
            return;
          }
          throw e;
        }
      }
    }
    const request: Request = {
      method, url, params: matched?.params ?? {}, body, rawBody: null,
      cookies, headers: req.headers, req,
    };
    const requestCtx: Ctx = { ...ctx, actor };
    if (matched) {
      await matched.route.handler(request, res, requestCtx);
      return;
    }
    throw err(404, "not_found");
  }

  // Health
  if (pathname === "/healthz") {
    json(res, 200, { status: "ok" });
    return;
  }

  // App pages: server-rendered shell, browser renders routes.
  if (method === "GET" || method === "HEAD") {
    // Sign-in redirect for protected pages
    if (!actor && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      const next = encodeURIComponent(url.pathname + url.search);
      res.writeHead(302, { location: `/sign-in?next=${next}` });
      res.end();
      return;
    }
    if (actor && pathname === "/sign-in") {
      const target = safeNext(url.searchParams.get("next"));
      res.writeHead(302, { location: target });
      res.end();
      return;
    }
    if (pathname === "/") {
      res.writeHead(302, { location: actor ? "/documents" : "/sign-in" });
      res.end();
      return;
    }
    // Only known app routes get the shell. Source files, package.json,
    // environment files and source maps answer 404.
    const shell = appShell("Undersign");
    if (isAppPath(pathname)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(shell);
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(shell);
    return;
  }

  throw err(404, "not_found");
}

function isAppPath(pathname: string): boolean {
  return pathname === "/sign-in"
    || pathname.startsWith("/sign/")
    || pathname.startsWith("/documents")
    || pathname === "/templates"
    || pathname === "/team"
    || pathname === "/not-found";
}

/** Only same-origin paths starting with exactly one slash pass through. */
export function safeNext(next: string | null): string {
  if (next === null) return "/documents";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/documents";
  return next;
}

function matchPath(pattern: string, pathname: string): Record<string, string | undefined> | null {
  const patParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patParts.length !== pathParts.length) return null;
  const params: Record<string, string | undefined> = {};
  for (let i = 0; i < patParts.length; i++) {
    const p = patParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
