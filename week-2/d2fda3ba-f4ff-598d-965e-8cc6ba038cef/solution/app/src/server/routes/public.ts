// Public dossier (/d/<slug>/...) and draft preview (/p/<token>/...) routes. The 404 and 410
// answers come from PostgreSQL alone, before storage is touched.
import type { IncomingMessage, ServerResponse } from "node:http";
import { pool } from "../db.ts";
import { tokenHash } from "../passwords.ts";
import { CONTENT_TYPES, page, publishFooter } from "../publish.ts";
import { getObject, StorageUnavailable } from "../s3.ts";
import { escapeHtml } from "../../shared/render.ts";
import { settleExpiredLinks } from "./dossiers.ts";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; "
  + "frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

const COPY = {
  notFound: "This dossier isn't available.",
  ended: "This preview link has ended.",
  unavailable: "This dossier is temporarily unavailable.",
  method: "Dossier pages can only be read.",
};

function headers(preview: boolean, contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType, "Cache-Control": "no-cache", "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff", ...(preview ? { "X-Robots-Tag": "noindex" } : {}),
  };
}

/** A reader-styled page carrying one line of copy (not found, ended, unavailable). */
export function messagePage(res: ServerResponse, status: number, copy: string, preview = false): void {
  res.writeHead(status, headers(preview, CONTENT_TYPES.html));
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy)}</title>
<link rel="stylesheet" href="/reader.css">
</head>
<body>
<main id="main" class="message">
<svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="20" rx="8" ry="2.6"/><ellipse cx="12" cy="14.6" rx="6" ry="2.3"/><ellipse cx="12" cy="9.8" rx="4.2" ry="1.9"/><ellipse cx="12" cy="5.8" rx="2.6" ry="1.5"/></svg>
<h1>${escapeHtml(copy)}</h1>
</main>
</body>
</html>
`);
}

const SHARED_FILES = new Set(["previews.json", "assets/reader.css", "assets/reader.js"]);
const PUBLISH_FILES = new Set([...SHARED_FILES, "sitemap.xml", "search-index.json"]);

interface Manifest {
  pages: string[];
}

/** The object path for a request path inside a dossier or preview, or null when it is not one. */
function objectPath(rest: string, manifest: Manifest, files: Set<string>): string | null {
  if (rest === "") return "index.html";
  if (files.has(rest)) return rest;
  const slug = decodeURIComponent(rest);
  return manifest.pages.includes(slug) ? `pages/${slug}.html` : null;
}

async function sendObject(res: ServerResponse, key: string, preview: boolean, head: boolean): Promise<void> {
  const body = await getObject(key);
  if (!body) return messagePage(res, 404, COPY.notFound, preview);
  res.writeHead(200, headers(preview, CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1)]));
  res.end(head ? undefined : body);
}

interface IndexEntry {
  path: string;
  title: string;
  text: string;
}

async function searchPage(res: ServerResponse, prefix: string, query: string, footer: string, head: boolean): Promise<void> {
  const raw = await getObject(`${prefix}search-index.json`);
  if (!raw) return messagePage(res, 404, COPY.notFound);
  const entries = JSON.parse(raw.toString("utf8")) as IndexEntry[];
  const needle = query.trim().toLowerCase();
  const hits = needle ? entries.filter((e) => e.title.toLowerCase().includes(needle) || e.text.toLowerCase().includes(needle)) : [];
  const href = (path: string) => (path === "" ? "./" : encodeURIComponent(path));
  const results = hits.length
    ? `<ul class="search-results" aria-label="Search results">${hits.map((h) => `<li><a href="${href(h.path)}">${escapeHtml(h.title)}</a></li>`).join("")}</ul>`
    : `<ul class="search-results" aria-label="Search results"></ul><p class="no-results">${escapeHtml(needle ? `No published notes match ${query.trim()}.` : "Type a word to search the published notes.")}</p>`;
  const rootTitle = entries.find((e) => e.path === "")?.title ?? "";
  const html = page({
    title: "Search this dossier", rootTitle, nav: entries.map((e) => ({ slug: e.path, title: e.title })), current: null,
    banner: null, search: query, footer,
  }, results);
  res.writeHead(200, headers(false, CONTENT_TYPES.html));
  res.end(head ? undefined : html);
}

export async function servePublic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const match = /^\/(d|p)\/([^/]+)\/(.*)$/.exec(url.pathname);
  const preview = match?.[1] === "p";
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return messagePage(res, 405, COPY.method, preview);
  }
  if (!match) return messagePage(res, 404, COPY.notFound);
  const [, kind, id, rest] = match;
  const head = req.method === "HEAD";
  try {
    if (kind === "d") {
      const { rows } = await pool.query<{ prefix: string; manifest: Manifest; published_at: Date; public_count: number; time_zone: string }>(
        `SELECT p.prefix, p.manifest, d.published_at, d.public_count, a.time_zone FROM dossiers d
         JOIN publishes p ON p.id = d.live_publish_id JOIN accounts a ON a.id = d.account_id
         WHERE d.slug = $1 AND d.state = 'published'`, [id]);
      const live = rows[0];
      if (!live) return messagePage(res, 404, COPY.notFound);
      if (rest === "search") {
        return await searchPage(res, live.prefix, url.searchParams.get("q") ?? "", publishFooter(live.published_at, live.public_count, live.time_zone), head);
      }
      const path = objectPath(rest, live.manifest, PUBLISH_FILES);
      if (!path) return messagePage(res, 404, COPY.notFound);
      return await sendObject(res, live.prefix + path, false, head);
    }
    await settleExpiredLinks(pool, null);
    const { rows } = await pool.query<{ id: string; state: string; manifest: Manifest }>(
      "SELECT id, state, manifest FROM preview_links WHERE token_hash = $1", [tokenHash(id)]);
    const link = rows[0];
    if (!link) return messagePage(res, 404, COPY.notFound, true);
    if (link.state !== "active") return messagePage(res, 410, COPY.ended, true);
    const path = objectPath(rest, link.manifest, SHARED_FILES);
    if (!path) return messagePage(res, 404, COPY.notFound, true);
    return await sendObject(res, `preview/${link.id}/${path}`, true, head);
  } catch (error) {
    if (error instanceof StorageUnavailable) return messagePage(res, 503, COPY.unavailable, preview);
    throw error;
  }
}
