// App pages and static files (brief: Screens, Workspace address, Server boundary). Only the built
// client and the self-hosted fonts are served; pages that need a session send the person to /signin?next=.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { diagramAccess } from "./access";
import { currentUser } from "./auth";
import type { Reply, Request } from "./http";
import { versionBelongs } from "./versions";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const STATIC: Record<string, { file: string; type: string }> = {
  "/assets/app.js": { file: "dist/client/app.js", type: "text/javascript; charset=utf-8" },
  "/assets/app.css": { file: "dist/client/app.css", type: "text/css; charset=utf-8" },
};
const FONT = /^\/fonts\/([a-z0-9-]+\.woff2)$/;

function shell(view: "app" | "not-found"): string {
  return `<!doctype html>
<html lang="en" data-view="${view}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view === "not-found" ? "Diagram not found · Linewell" : "Linewell"}</title>
<link rel="preload" href="/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}

function html(status: number, view: "app" | "not-found"): Reply {
  return { status, body: Buffer.from(shell(view), "utf8"), headers: { "Content-Type": "text/html; charset=utf-8" } };
}

function toSignIn(req: Request): Reply {
  const query = req.query.toString();
  const next = `${req.path}${query ? `?${query}` : ""}`;
  return { status: 302, headers: { Location: `/signin?next=${encodeURIComponent(next)}` } };
}

/** Answers GET requests outside /api, or null when nothing is served at that path. */
export async function servePage(req: Request): Promise<Reply | null> {
  const asset = STATIC[req.path];
  if (asset) return { status: 200, body: await readFile(`${ROOT}${asset.file}`), headers: { "Content-Type": asset.type, "Cache-Control": "no-cache" } };
  const font = FONT.exec(req.path);
  if (font) {
    try {
      return { status: 200, body: await readFile(`${ROOT}public/fonts/${font[1]}`), headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" } };
    } catch {
      return null;
    }
  }
  if (req.path === "/signin" || req.path === "/signup") return html(200, "app");
  if (req.path === "/") return (await currentUser(req)) ? html(200, "app") : toSignIn(req);
  const workspace = /^\/d\/([^/]+)$/.exec(req.path);
  if (!workspace) return null;
  const user = await currentUser(req);
  if (!user) return toSignIn(req);
  const diagramId = decodeURIComponent(workspace[1] as string);
  try {
    await diagramAccess(user, diagramId);
  } catch {
    return html(404, "not-found");
  }
  const version = req.query.get("version");
  if (version !== null && !(await versionBelongs(diagramId, version))) return html(404, "not-found");
  return html(200, "app");
}
