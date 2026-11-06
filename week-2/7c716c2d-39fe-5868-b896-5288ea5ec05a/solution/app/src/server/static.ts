// Serves only the built browser assets and the page shell for the published routes; everything
// else (sources, manifests, env files) answers 404.
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "./auth.js";
import { bootstrap } from "./people.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const assets = new Map<string, { body: Buffer; type: string }>();
for (const file of listFiles(PUBLIC_DIR)) {
  const type = TYPES[extname(file)];
  if (type) assets.set(`/${relative(PUBLIC_DIR, file).split("\\").join("/")}`, { body: readFileSync(file), type });
}

interface Meta {
  outputs: Record<string, { entryPoint?: string; cssBundle?: string }>;
}

function shell(): string {
  const meta = JSON.parse(readFileSync(join(dirname(PUBLIC_DIR), "meta.json"), "utf8")) as Meta;
  const [script, entry] = Object.entries(meta.outputs).find(([, out]) => out.entryPoint === "src/client/main.tsx") ?? ["", {}];
  const href = (path: string): string => `/${relative(PUBLIC_DIR, path).split("\\").join("/")}`;
  const css = entry.cssBundle ? `<link rel="stylesheet" href="${href(entry.cssBundle)}">` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Tallyroom</title>
<link rel="icon" href="data:,">
${css}
<script type="module" src="${href(script)}"></script>
</head>
<body>
<div id="root"></div>
<script id="boot" type="application/json">__BOOT__</script>
</body>
</html>`;
}

const page = shell();

/** JSON safe inside a script element. */
function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const ROUTES = /^\/(?:$|(?:sign-in|create-account|invitations|welcome|issues|cycle|chat|docs|office|settings|account)(?:\/.*)?$)/;

async function bootFor(req: IncomingMessage): Promise<unknown> {
  try {
    return { signed_in: await bootstrap(await authenticate(req)) };
  } catch {
    return null;
  }
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const asset = assets.get(url.pathname);
  if (asset && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": asset.type, "Content-Length": String(asset.body.length), "Cache-Control": "public, max-age=31536000, immutable", ...SECURITY });
    res.end(req.method === "HEAD" ? undefined : asset.body);
    return;
  }
  if (ROUTES.test(url.pathname) && (req.method === "GET" || req.method === "HEAD")) {
    const boot = embed(await bootFor(req));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY,
    });
    res.end(req.method === "HEAD" ? undefined : page.replace("__BOOT__", () => boot));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY });
  res.end("Not found");
}
