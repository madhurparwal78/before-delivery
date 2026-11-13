import { readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { database } from "./db.js";
import { userOfRequest, send } from "./http.js";
import { Refusal } from "./errors.js";

const CLIENT_ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const PAGE = /^\/(signin|board|settings|imports|history|quests\/[0-9a-f-]+)?$/;
const SIGNED_IN_ONLY = /^\/(board|settings|imports|history|quests\/[0-9a-f-]+)$/;
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function listFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const index = readFileSync(join(CLIENT_ROOT, "index.html"), "utf8").replace("{{chat-limit}}", String(config.chatMaxPerMinute));
const assets = new Map<string, string>(
  listFiles(CLIENT_ROOT)
    .filter((path) => extname(path) in TYPES)
    .map((path) => [`/${relative(CLIENT_ROOT, path).replaceAll("\\", "/")}`, path]),
);

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

/** Built assets and the page shell only: anything else, source files and manifests included, is not found. */
export async function servePage(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, { status: 404, body: Refusal.notFound().body });
  const asset = assets.get(pathname);
  if (asset) {
    res.writeHead(200, { "Content-Type": TYPES[extname(asset)]!, "Cache-Control": "public, max-age=31536000, immutable" });
    res.end(readFileSync(asset));
    return;
  }
  if (!PAGE.test(pathname)) return send(res, { status: 404, body: Refusal.notFound().body });
  if (database.ready && (pathname === "/" || SIGNED_IN_ONLY.test(pathname))) {
    const signedIn = (await userOfRequest(req)) !== undefined;
    if (pathname === "/" && signedIn) return redirect(res, "/board");
    if (pathname !== "/" && !signedIn) return redirect(res, "/signin");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(index);
}
