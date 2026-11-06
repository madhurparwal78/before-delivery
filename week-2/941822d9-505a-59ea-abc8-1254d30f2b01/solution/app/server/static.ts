import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITY_HEADERS } from "./http/router.js";

// Serves only the built frontend: hashed assets, fonts and the SPA shell for the app's own screens.

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Client-side screens; every other path that is not a built asset answers 404. */
const SCREENS = [
  /^\/$/,
  /^\/signin$/,
  /^\/courses$/,
  /^\/courses\/[^/]+$/,
  /^\/learning$/,
  /^\/learn\/[^/]+\/[^/]+$/,
  /^\/transcript$/,
  /^\/verify\/[^/]+$/,
  /^\/sponsor$/,
  /^\/planner$/,
  /^\/planner\/cohorts\/[^/]+$/,
  /^\/author$/,
];

const SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };

let shell: Buffer | null = null;

async function shellHtml(): Promise<Buffer> {
  shell ??= await readFile(`${WEB_ROOT}index.html`);
  return shell;
}

export async function serveStatic(pathname: string, res: ServerResponse, head: boolean): Promise<void> {
  if (SCREENS.some((screen) => screen.test(pathname))) {
    const html = await shellHtml();
    const capability = pathname.startsWith("/verify/") ? CAPABILITY_HEADERS : { "Cache-Control": "no-cache" };
    res.writeHead(200, { ...SECURITY_HEADERS, ...capability, "Content-Type": "text/html; charset=utf-8", "Content-Length": String(html.length) });
    res.end(head ? undefined : html);
    return;
  }
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const builtAsset = (relative.startsWith(`assets${sep}`) || relative.startsWith(`fonts${sep}`) || relative === "favicon.svg") && !relative.includes("..");
  const type = TYPES[extname(relative)];
  if (builtAsset && type) {
    const file = `${WEB_ROOT}${relative}`;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) {
      const body = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": String(body.length), "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(head ? undefined : body);
      return;
    }
  }
  const missing = Buffer.from("Not found", "utf8");
  res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(missing.length) });
  res.end(head ? undefined : missing);
}
