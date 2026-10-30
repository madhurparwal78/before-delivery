// The HTML pages (game, claim page, console, postcard pages) and the built client assets.
// Nothing else on disk is ever served.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "./errors";
import { json, type Ctx, type Reply } from "./http";
import { ACCEPTED_ZONES } from "./studio";

const CLIENT_DIR = path.join(__dirname, "client");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function shell(title: string, entry: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f6eedd">
<title>${title}</title>
<link rel="stylesheet" href="/assets/${entry}.css">
</head>
<body>
${body}
</body>
</html>`;
}

/** Every HTML page: never cached, never sniffed. */
export const htmlReply = (body: string, status = 200): Reply => ({
  status,
  body,
  type: "text/html; charset=utf-8",
  headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
});

const GAME = shell(
  "Parcel Moon — Bramble",
  "game",
  `<div id="game" class="game"></div>
<script type="module" src="/assets/game.js"></script>`,
);

const CLAIM = shell(
  "Claim your save — Parcel Moon",
  "claim",
  `<main id="claim" class="paper-page claim-page"></main>
<script type="module" src="/assets/claim.js"></script>`,
);

const CONSOLE = shell(
  "Founder console — Parcel Moon",
  "console",
  `<div id="console-root" class="paper-page console-page"></div>
<script type="application/json" id="studio-zones">${JSON.stringify(ACCEPTED_ZONES)}</script>
<script type="module" src="/assets/console.js"></script>`,
);

export function sharePage(token: string, displayName: string): string {
  return shell(
    "A postcard from Bramble",
    "share",
    `<main class="paper-page share-page">
  <figure class="share-card">
    <div class="share-stamp"><img src="/p/${escape(token)}/image.png" alt="A postcard from Bramble" width="1200" height="800"></div>
    <figcaption>
      <h1>A postcard from Bramble</h1>
      <p class="share-caption">Sent by ${escape(displayName)}</p>
    </figcaption>
  </figure>
</main>`,
  );
}

export function returnedPage(): string {
  return shell(
    "Returned to sender",
    "share",
    `<main class="paper-page share-page">
  <section class="share-card share-returned">
    <h1>Returned to sender</h1>
    <p>This postcard has been returned to sender.</p>
  </section>
</main>`,
  );
}

/** Pages, client routes and built assets; every other path is the fixed 404. */
export async function servePage(ctx: Ctx): Promise<Reply> {
  if (ctx.method === "GET" || ctx.method === "HEAD") {
    if (ctx.path === "/") return htmlReply(GAME);
    if (ctx.path === "/claim") return htmlReply(CLAIM);
    if (ctx.path === "/console") return htmlReply(CONSOLE);
    const asset = /^\/assets\/((?:fonts\/)?[A-Za-z0-9_-]+(?:-[A-Za-z0-9]+)?\.(?:js|css|woff2))$/.exec(ctx.path);
    if (asset) {
      try {
        const body = await readFile(path.join(CLIENT_DIR, asset[1]!));
        return { status: 200, body, type: TYPES[path.extname(asset[1]!)]!, headers: { "Cache-Control": "no-cache" } };
      } catch {
        // fall through to the 404 below
      }
    }
  }
  return json(404, notFound().body());
}
