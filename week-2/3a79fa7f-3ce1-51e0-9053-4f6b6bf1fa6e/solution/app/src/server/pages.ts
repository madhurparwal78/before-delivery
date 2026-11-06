// Page shell and static files. Every page address answers the shell; an unknown one answers it with 404.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { matchPage } from "../shared/pages.ts";
import { SHARE_HEADERS } from "./domain/cart.ts";
import { bootData } from "./boot.ts";
import { ApiError } from "./errors.ts";
import { errorReply, parseCookies, send, SESSION_COOKIE, sessionUser, tokenHash } from "./http.ts";
import { pool } from "./db.ts";
import { callbacksFor } from "./domain/callbacks.ts";
import { bookingLabels } from "./domain/demo.ts";

const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function collect(dir: string, into: Map<string, Buffer>): Map<string, Buffer> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, into);
    else if (TYPES[extname(name)]) into.set(`/${relative(PUBLIC, path).split("\\").join("/")}`, readFileSync(path));
  }
  return into;
}

const FILES = collect(PUBLIC, new Map());
const CSP = "connect-src 'self'; font-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tern Foils</title>
<meta name="description" content="Tern Foils: electric hydrofoil boards hand-built by a family workshop.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/montserrat-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/open-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="boot">${bootData()}</script>
<!--page-data-->
</body>
</html>`;

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * /account lists the customer's callbacks and names each booking by its slot; no published endpoint carries
 * them, so the shell of that page holds them for the signed-in customer.
 */
async function accountData(req: IncomingMessage): Promise<string> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = token ? await sessionUser(tokenHash(token)) : null;
  if (!user || user.role !== "customer") return "";
  const data = { callbacks: await callbacksFor(pool, user.email), bookings: await bookingLabels(pool, user) };
  return `<script type="application/json" id="account-data">${json(data)}</script>`;
}

export async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const head = req.method === "HEAD";
  const common = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
  if (req.method !== "GET" && !head) {
    send(res, errorReply(new ApiError("method_not_allowed", { headers: { Allow: "GET" } })));
    return;
  }
  const file = FILES.get(url.pathname);
  if (file) {
    const immutable = url.pathname.startsWith("/fonts/") || /\/chunk-[A-Z0-9]+\.js$/i.test(url.pathname);
    res.writeHead(200, {
      ...common,
      "Content-Type": TYPES[extname(url.pathname)] ?? "application/octet-stream",
      "Content-Length": file.length,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(head ? undefined : file);
    return;
  }
  const page = matchPage(url.pathname);
  res.writeHead(page ? 200 : 404, {
    ...common,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": CSP,
    "X-Frame-Options": "DENY",
    ...(page?.page === "/cart/shared/:token" ? SHARE_HEADERS : {}),
  });
  const extra = page?.page === "/account" ? await accountData(req).catch(() => "") : "";
  res.end(head ? undefined : SHELL.replace("<!--page-data-->", extra));
}
