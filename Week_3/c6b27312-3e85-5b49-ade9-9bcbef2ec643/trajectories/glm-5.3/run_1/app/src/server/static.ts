import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PUBLIC_DIR = resolve("public");
const DIST_BROWSER = resolve("dist-browser");

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Never served: application source, maps, env files, credentials, listings. */
export function isBlocked(path: string): boolean {
  if (path.endsWith(".ts") || path.endsWith(".map") || path.endsWith(".env")) return true;
  if (path.startsWith("/src/") || path.startsWith("/dist/") || path.startsWith("/node_modules/")) return true;
  if (path.includes("..")) return true;
  if (path.startsWith("/.") || path.includes("/.")) return true;
  return false;
}

/**
 * A static asset from public/ or the built browser bundle. The browser
 * modules live under /app/* (mirroring dist-browser/browser).
 */
export function staticAsset(urlPath: string): { body: Buffer; type: string } | null {
  if (urlPath.startsWith("/app/")) {
    const rel = urlPath.slice("/app/".length);
    if (!/^[a-z-]+\.js$/.test(rel)) return null;
    const file = join(DIST_BROWSER, "browser", rel);
    if (existsSync(file) && statSync(file).isFile()) return { body: readFileSync(file), type: TYPES[".js"]! };
    return null;
  }
  if (urlPath.startsWith("/shared/")) {
    const rel = urlPath.slice("/shared/".length);
    if (!/^[a-z-]+\.js$/.test(rel)) return null;
    const file = join(DIST_BROWSER, "shared", rel);
    if (existsSync(file) && statSync(file).isFile()) return { body: readFileSync(file), type: TYPES[".js"]! };
    return null;
  }
  if (urlPath === "/styles.css") {
    const file = join(PUBLIC_DIR, "styles.css");
    if (existsSync(file)) return { body: readFileSync(file), type: TYPES[".css"]! };
    return null;
  }
  if (urlPath.startsWith("/fonts/")) {
    const file = join(PUBLIC_DIR, urlPath);
    if (existsSync(file) && statSync(file).isFile()) {
      return { body: readFileSync(file), type: TYPES[".woff2"]! };
    }
  }
  return null;
}
