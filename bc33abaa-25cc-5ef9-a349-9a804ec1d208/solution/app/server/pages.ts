// Pages and built browser assets. Anything outside the page routes and the built assets is not served.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "./auth.js";
import { one, pool } from "./db.js";
import { bytes, type Context, type Reply } from "./http.js";
import { getObject, keys } from "./services/storage.js";
import { embedTarget, reviewTarget } from "./routes/versions.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const assets = new Map(walk(join(PUBLIC_DIR, "assets")).map((file) => {
  const url = `/assets/${relative(join(PUBLIC_DIR, "assets"), file).split(sep).join("/")}`;
  const extension = file.slice(file.lastIndexOf("."));
  return [url, { body: readFileSync(file), type: TYPES[extension] ?? "application/octet-stream" }];
}));

const PAGES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/$/, title: "Orrery Studio · 3D scenes your whole team can trace" },
  { pattern: /^\/pricing$/, title: "Pricing · Orrery Studio" },
  { pattern: /^\/signup$/, title: "Start your trial · Orrery Studio" },
  { pattern: /^\/login$/, title: "Sign in · Orrery Studio" },
  { pattern: /^\/invite\/[^/]+$/, title: "Join workspace · Orrery Studio" },
  { pattern: /^\/app(\/(scenes|members|agents|audit|billing|settings))?\/?$/, title: "Orrery Studio" },
  { pattern: /^\/app\/scenes\/[^/]+$/, title: "Editor · Orrery Studio" },
  { pattern: /^\/review\/[^/]+$/, title: "Review copy · Orrery Studio" },
  { pattern: /^\/embed\/[^/]+$/, title: "Orrery Studio embed" },
];

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The stored still image a page shows when WebGL is unavailable, inlined so no extra route is needed. */
async function stillFor(ctx: Context): Promise<string | null> {
  const [, area, kind, id] = ctx.path.split("/");
  let key: string | null = null;
  if (area === "embed" && kind) {
    const { scene, version } = await embedTarget(kind);
    if (version.has_thumbnail) key = keys.thumbnail(scene.workspace_id, scene.id, version.id);
  } else if (area === "review" && kind) {
    const { version } = await reviewTarget(kind);
    if (version.has_thumbnail) key = keys.thumbnail(version.workspace_id, version.scene_id, version.id);
  } else if (area === "app" && kind === "scenes" && id) {
    const caller = await authenticate(ctx.headers);
    const version = caller ? await one<{ id: string; scene_id: string; workspace_id: string }>(pool,
      `SELECT v.id, v.scene_id, v.workspace_id FROM versions v WHERE v.scene_id = $1 AND v.workspace_id = $2 AND v.has_thumbnail
       ORDER BY v.number DESC LIMIT 1`, [decodeURIComponent(id), caller.workspaceId]) : undefined;
    if (version) key = keys.thumbnail(version.workspace_id, version.scene_id, version.id);
  }
  const image = key ? await getObject(key, 1500) : null;
  return image ? `data:image/png;base64,${image.toString("base64")}` : null;
}

// Every face the stylesheet uses, fetched with the page so a late face never re-lays out a drawn screen.
const FONTS = [
  "space-grotesk-latin-500-normal", "space-grotesk-latin-700-normal", "ibm-plex-sans-latin-400-normal",
  "ibm-plex-sans-latin-500-normal", "ibm-plex-sans-latin-600-normal", "ibm-plex-mono-latin-400-normal", "ibm-plex-mono-latin-500-normal",
];

function shell(title: string, still: string | null): string {
  const boot = still ? `<script id="orrery-still" type="application/json">${JSON.stringify({ src: still })}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${FONTS.map((f) => `<link rel="preload" href="/assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("\n")}
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="root"></div>
${boot}
</body>
</html>`;
}

export async function fallback(ctx: Context): Promise<Reply | null> {
  if (ctx.method !== "GET" && ctx.method !== "HEAD") return null;
  const asset = assets.get(ctx.path);
  if (asset) return bytes(asset.body, asset.type, { "Cache-Control": "public, max-age=3600" });
  const page = PAGES.find((p) => p.pattern.test(ctx.path));
  if (!page) return null;
  const still = await stillFor(ctx).catch(() => null);
  return bytes(shell(page.title, still), "text/html; charset=utf-8", { "Cache-Control": "no-store" });
}
