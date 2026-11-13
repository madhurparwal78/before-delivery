import { readFileSync, readdirSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { callerOf, embedApplies, resolveAccess, type BoardRow, type Caller } from "./access";
import { maybeOne, pool } from "./db";
import type { Request } from "./http";
import { DEMO } from "./seed";
import { listingOf } from "./views";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

interface Asset {
  bytes: Buffer;
  type: string;
}

/** Only files the build produced are ever served: they are indexed once, so a path either names one or answers 404. */
function indexAssets(directory: string, found = new Map<string, Asset>()): Map<string, Asset> {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    if (statSync(file).isDirectory()) indexAssets(file, found);
    else if (TYPES[extname(file)]) found.set(`/${relative(ROOT, file).split("\\").join("/")}`, { bytes: readFileSync(file), type: TYPES[extname(file)] });
  }
  return found;
}

const assets = indexAssets(ROOT);
const shell = readFileSync(join(ROOT, "index.html"), "utf8");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

const PAGES: { pattern: RegExp; status: (caller: Caller, match: RegExpMatchArray) => Promise<number> }[] = [
  { pattern: /^\/$/, status: async () => 200 },
  { pattern: /^\/(signin|signup)$/, status: async () => 200 },
  {
    pattern: /^\/b\/([^/]+)$/,
    status: async (caller, match) => ((await resolveAccess(caller, { boardId: match[1] })).kind === "not_found" ? 404 : 200),
  },
  {
    pattern: /^\/s\/([^/]+)$/,
    status: async (caller, match) => ((await resolveAccess(caller, { linkToken: match[1] })).kind === "not_found" ? 404 : 200),
  },
  {
    pattern: /^\/embed\/([^/]+)$/,
    status: async (caller, match) => {
      const access = await resolveAccess(caller, { linkToken: match[1] });
      return access.kind === "not_found" || !embedApplies(access.board) ? 404 : 200;
    },
  },
  {
    pattern: /^\/invite\/([^/]+)$/,
    status: async (_caller, match) => ((await maybeOne(pool, `SELECT 1 FROM invites WHERE token = $1`, [match[1]])) ? 200 : 404),
  },
];

interface Frame {
  id: string;
  title: string;
  file_card: boolean;
}

/** The frames of the seeded demo board, for the landing strip; part of the signed-out landing page, not an API route. */
async function landingFrames(): Promise<Frame[]> {
  const board = await maybeOne<BoardRow>(
    pool,
    `SELECT b.* FROM boards b JOIN users u ON u.id = b.owner_id WHERE lower(u.email) = $1 AND b.title = $2`,
    [DEMO.email, DEMO.board],
  );
  if (!board) return [];
  const listing = await listingOf(pool, board, null, null);
  return listing.sections.flatMap((section) => section.posts.map((post) => ({ id: post.id, title: post.title, file_card: post.file_card })));
}

const escapeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

export async function servePage(request: Request): Promise<void> {
  const { res } = request;
  const pathname = new URL(request.req.url ?? "/", "http://localhost").pathname;
  const asset = assets.get(pathname);
  if (asset) {
    const hashed = pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": asset.type, "Content-Length": asset.bytes.length, "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache" });
    res.end(asset.bytes);
    return;
  }
  const caller = await callerOf(request);
  let status = 404;
  for (const page of PAGES) {
    const match = pathname.match(page.pattern);
    if (match) {
      status = await page.status(caller, match);
      break;
    }
  }
  const landing = pathname === "/" && !caller.user ? await landingFrames() : [];
  const embedded = [
    `<script type="application/json" id="landing-frames">${escapeJson(landing)}</script>`,
    `<script type="application/json" id="settings">${escapeJson({ uploadMaxBytes: config.uploadMaxBytes })}</script>`,
  ].join("");
  sendShell(res, status, shell.replace("<!--embedded-->", embedded));
}

function sendShell(res: ServerResponse, status: number, html: string): void {
  const bytes = Buffer.from(html, "utf8");
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Length": bytes.length, "Cache-Control": "no-cache" });
  res.end(bytes);
}
