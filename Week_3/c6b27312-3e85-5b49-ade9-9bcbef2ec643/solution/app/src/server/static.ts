// The built browser app: files under dist/public, with the shell as the fallback for page addresses.
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "./http";
import { notFound } from "./errors";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/** A file under the public root, or null for anything that is hidden, a source map or outside it. */
async function publicFile(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const parts = relative.split(sep);
  const type = TYPES[extname(relative)];
  if (relative === "" || type === undefined || parts.some((part) => part === ".." || part.startsWith("."))) return null;
  try {
    return { body: await readFile(join(ROOT, relative)), type };
  } catch {
    return null;
  }
}

export async function serveStatic(ctx: Ctx): Promise<void> {
  let file = await publicFile(ctx.url.pathname).catch(() => null);
  const isAsset = file !== null;
  if (!file && extname(ctx.url.pathname) === ".map") throw notFound();
  file ??= await publicFile("index.html");
  if (!file) throw notFound();
  ctx.res.writeHead(200, {
    "Content-Type": file.type,
    "Content-Length": file.body.length,
    "Cache-Control": isAsset && file.type !== TYPES[".html"] ? "public, max-age=3600" : "no-cache",
  });
  ctx.res.end(file.body);
}
