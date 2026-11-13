import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { safeRedirect } from "../../shared/redirect.js";
import { SESSION_COOKIE, findActor } from "./context.js";

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../client");

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

const SIGNED_IN_PAGES = [/^\/$/, /^\/documents(\/.*)?$/, /^\/templates$/, /^\/team$/];
const PUBLIC_PAGES = [/^\/sign\/[^/]+$/];

async function shell(status: 200 | 404): Promise<Response> {
  const html = await readFile(path.join(CLIENT_DIR, "index.html"));
  return new Response(new Uint8Array(html), { status, headers: { "content-type": CONTENT_TYPES[".html"] ?? "text/html", "cache-control": "no-store" } });
}

export const pageRoutes = new Hono();

pageRoutes.get("*", async (c) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  const extension = path.extname(pathname);
  if (extension !== "" || pathname.split("/").some((part) => part.startsWith("."))) {
    const resolved = path.resolve(CLIENT_DIR, `.${pathname}`);
    if (resolved.startsWith(`${CLIENT_DIR}${path.sep}`) && resolved !== path.join(CLIENT_DIR, "index.html") && (await stat(resolved).then((s) => s.isFile(), () => false))) {
      const immutable = pathname.startsWith("/assets/");
      return new Response(new Uint8Array(await readFile(resolved)), {
        headers: {
          "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
        },
      });
    }
    return c.json({ error: "not_found" }, 404);
  }
  const actor = await findActor(getCookie(c, SESSION_COOKIE));
  if (pathname === "/sign-in") {
    if (actor) return c.redirect(safeRedirect(url.searchParams.get("next"), "/documents"), 302);
    return shell(200);
  }
  if (PUBLIC_PAGES.some((pattern) => pattern.test(pathname))) return shell(200);
  if (SIGNED_IN_PAGES.some((pattern) => pattern.test(pathname))) {
    if (!actor) return c.redirect(`/sign-in?next=${encodeURIComponent(pathname + url.search)}`, 302);
    return pathname === "/" ? c.redirect("/documents", 302) : shell(200);
  }
  return shell(404);
});
