import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { isLocale } from "../shared/domain.ts";
import { chooseLocale, cookie, parseCookies, send } from "./http.ts";
import { localeRedirect } from "./routes.ts";
import { COOKIE_YEAR_S, LOCALE_COOKIE, resolveSession } from "./sessions.ts";

const DIST = join(import.meta.dirname, "public");
const MANIFEST = join(import.meta.dirname, "manifest.json");
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };

/** Page routes under a locale prefix (brief: Screens and layout). */
const PAGES = [
  /^\/$/, /^\/screenings\/[^/]+$/, /^\/checkout\/[^/]+$/, /^\/account$/, /^\/account\/bookings\/[^/]+$/, /^\/b\/[^/]+$/,
  /^\/membership$/, /^\/gift$/, /^\/gift\/[^/]+$/, /^\/signin$/, /^\/signup$/, /^\/booking-link$/, /^\/contact$/, /^\/staff$/,
];

let shell: ((locale: string) => string) | null = null;

async function loadShell(): Promise<(locale: string) => string> {
  if (shell) return shell;
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as { script: string; style: string; fonts: string[] };
  const fonts = manifest.fonts.map((font) => `<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin>`).join("");
  shell = (locale) => `<!doctype html><html lang="${locale}" data-locale="${locale}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Halide Box Office</title>`
    + `<meta name="color-scheme" content="dark">${fonts}<link rel="stylesheet" href="${manifest.style}">`
    + `<script type="module" src="${manifest.script}"></script></head><body><div id="app"></div></body></html>`;
  return shell;
}

async function serveAsset(res: ServerResponse, path: string): Promise<boolean> {
  const type = TYPES[extname(path)];
  if (!type || !(path.startsWith("/assets/") || path.startsWith("/fonts/"))) return false;
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" }).end(body);
    return true;
  } catch {
    return false;
  }
}

/** Serves built assets, the page shell under `/en/` and `/fr/`, the locale route and the prefix redirect. */
export async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (await serveAsset(res, path)) return;
  const localeRoute = /^\/locale\/(en|fr)$/.exec(path);
  if (localeRoute && isLocale(localeRoute[1])) {
    send(res, localeRedirect(localeRoute[1], url.searchParams.get("next")));
    return;
  }
  const prefixed = /^\/(en|fr)(\/.*)?$/.exec(path);
  if (prefixed && isLocale(prefixed[1])) {
    const rest = prefixed[2] ?? "/";
    const known = PAGES.some((page) => page.test(rest));
    const html = (await loadShell())(prefixed[1]);
    send(res, { status: known ? 200 : 404, text: html, headers: { "Content-Type": "text/html; charset=utf-8" }, cookies: [cookie(LOCALE_COOKIE, prefixed[1], COOKIE_YEAR_S)] });
    return;
  }
  if (path === "/" || (!path.includes(".") && !path.startsWith("/api/") && !path.startsWith("/assets/") && !path.startsWith("/fonts/"))) {
    const cookies = parseCookies(req.headers.cookie);
    const locale = chooseLocale(undefined, cookies, await resolveSession(cookies), req.headers["accept-language"]);
    send(res, { status: 302, headers: { Location: `/${locale}${path === "/" ? "/" : path}${url.search}` } });
    return;
  }
  send(res, { status: 404, text: "Not found", headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
