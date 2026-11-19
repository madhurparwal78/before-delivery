// HTML pages: static assets, the app shell with its embedded bootstrap values, page status and sign-in redirects.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.ts";
import { pool, readClock } from "./db.ts";
import type { Principal, Bootstrap } from "../shared/api.ts";
import { CHAPTER_SLUGS } from "../shared/domain.ts";
import { localDate } from "../shared/dates.ts";
import { matchPage, mayOpen } from "../shared/routes.ts";
import type { Reply } from "./http.ts";

const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

async function bootstrapValues(): Promise<Bootstrap> {
  const now = await readClock(pool);
  return { today: localDate(now, config.timeZone), now, timeZone: config.timeZone, weightAnnounceDelayMs: config.weightAnnounceDelayMs };
}

/** The shell with the bootstrap values embedded for anonymous chapter pages (brief: Configuration and secrets). */
async function shell(status: number): Promise<Reply> {
  const template = await readFile(path.join(publicDir, "index.html"), "utf8");
  const json = JSON.stringify(await bootstrapValues()).replace(/</g, "\\u003c");
  return {
    status,
    raw: Buffer.from(template.replace("<!--bootstrap-->", `<script id="bootstrap" type="application/json">${json}</script>`), "utf8"),
    headers: { "content-type": TYPES[".html"], "cache-control": "no-store" },
  };
}

async function asset(file: string): Promise<Reply | null> {
  const resolved = path.join(publicDir, file);
  if (!resolved.startsWith(publicDir) || file === "index.html" || file === "") return null;
  try {
    return { status: 200, raw: await readFile(resolved), headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" } };
  } catch {
    return null;
  }
}

/** Answers a GET for a page route: a static asset, a redirect to sign-in, or the shell with its status. */
export async function page(urlPath: string, principal: Principal | null): Promise<Reply> {
  const file = await asset(urlPath.replace(/^\//, ""));
  if (file) return file;
  const match = matchPage(urlPath);
  if (!match) return shell(404);
  if (!mayOpen(match.route.access, principal?.role ?? null)) {
    return principal ? shell(404) : { status: 302, headers: { location: "/signin" } };
  }
  const [param] = match.params;
  if (match.route.screen === "chapter" && !(CHAPTER_SLUGS as readonly string[]).includes(param)) return shell(404);
  if (match.route.screen === "editor" && !(CHAPTER_SLUGS as readonly string[]).includes(param)) return shell(404);
  return shell(200);
}
