// Renders a dossier (or a draft preview) into the objects listed in Services, under the boundary
// and the page-shell allowlist. Note ids, frontmatter and anything outside the boundary never
// reach an object.
import { readFileSync } from "node:fs";
import { boundary, linkedFrom, pageSlugs, type BoundaryNote } from "../shared/boundary.ts";
import { boundaryLinks, escapeHtml, plainText, renderBody } from "../shared/render.ts";
import { formatWhen } from "../shared/time.ts";
import { config } from "./config.ts";

export interface CandidateNote extends BoundaryNote {
  frontmatter: Record<string, unknown>;
}

export interface RenderedObject {
  path: string;
  body: Buffer;
  contentType: string;
}

export const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};

const contentType = (path: string) => CONTENT_TYPES[path.slice(path.lastIndexOf(".") + 1)];

const ASSET_DIR = new URL("./reader/", import.meta.url);
const ASSETS = {
  "assets/reader.css": readFileSync(new URL("reader.css", ASSET_DIR)),
  "assets/reader.js": readFileSync(new URL("reader.js", ASSET_DIR)),
};

interface Shell {
  title: string;
  rootTitle: string;
  nav: { slug: string; title: string }[];
  current: string | null;
  banner: string | null;
  /** The search box value; null on preview pages, which have no search. */
  search: string | null;
  footer: string;
}

const href = (slug: string) => (slug === "" ? "./" : encodeURIComponent(slug));

/** The page shell: only the elements and attributes the allowlist names. */
export function page(shell: Shell, main: string): string {
  const nav = shell.nav.map((n) =>
    `<li><a href="${href(n.slug)}"${n.slug === shell.current ? ' aria-current="page"' : ""}>${escapeHtml(n.title)}</a></li>`).join("");
  const banner = shell.banner === null ? "" : `<section class="draft-banner" role="region" aria-label="Draft preview"><p>${escapeHtml(shell.banner)}</p></section>`;
  const search = shell.search === null
    ? ""
    : `<form class="search" role="search" action="search" method="get"><input type="search" name="q" aria-label="Search this dossier" value="${escapeHtml(shell.search)}"><button>Search</button></form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shell.title === shell.rootTitle ? shell.title : `${shell.title} · ${shell.rootTitle}`)}</title>
<link rel="stylesheet" href="assets/reader.css">
<script src="assets/reader.js"></script>
</head>
<body>
${banner}<main id="main">
<h1>${escapeHtml(shell.title)}</h1>
<nav class="dossier-nav" aria-label="Dossier"><ul>${nav}</ul></nav>
${main}
${search}
</main>
<footer class="dossier-footer"><p>${escapeHtml(shell.footer)}</p></footer>
</body>
</html>
`;
}

interface Rendered {
  objects: RenderedObject[];
  inside: string[];
  pages: string[];
  publicCount: number;
  severedCount: number;
}

interface RenderOptions {
  notes: CandidateNote[];
  rootId: string;
  radius: number;
  slug: string;
  /** The footer line, given the public note count. */
  footer: (publicCount: number) => string;
  banner: string | null;
}

/** Every object of one publish (or preview): pages, link previews, and for publishes the search index and sitemap. */
export function renderDossier({ notes, rootId, radius, slug, footer: footerFor, banner }: RenderOptions): Rendered {
  const result = boundary(notes, rootId, radius);
  const footer = footerFor(result.inside.length);
  const slugs = pageSlugs(notes, result, rootId);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const inside = result.inside.map((i) => byId.get(i.note_id) as CandidateNote);
  const rootTitle = (byId.get(rootId) as CandidateNote).title;
  const nav = inside.map((n) => ({ slug: slugs.get(n.id) as string, title: n.title }));
  const isPreview = banner !== null;

  const resolve = boundaryLinks(notes, result.insideIds, (id) => href(slugs.get(id) as string));
  const bodies = new Map(inside.map((note) => [note.id, renderBody(note.body, resolve)]));

  const objects: RenderedObject[] = [];
  const add = (path: string, body: string | Buffer) => objects.push({ path, body: Buffer.isBuffer(body) ? body : Buffer.from(body), contentType: contentType(path) });
  for (const note of inside) {
    const pageSlug = slugs.get(note.id) as string;
    const from = linkedFrom(inside, result.insideIds, note.id);
    const linked = `<section class="linked-from" role="region" aria-label="Linked from"><h2>Linked from</h2>${from.length
      ? `<ul>${from.map((f) => `<li><a href="${href(slugs.get(f.id) as string)}">${escapeHtml(f.title)}</a></li>`).join("")}</ul>`
      : "<p>No published note links here.</p>"}</section>`;
    const html = page({ title: note.title, rootTitle, nav, current: pageSlug, banner, search: isPreview ? null : "", footer },
      `<div class="note-body">${bodies.get(note.id)}</div>\n${linked}`);
    add(pageSlug === "" ? "index.html" : `pages/${pageSlug}.html`, html);
  }
  const previews = Object.fromEntries(inside.map((n) => [slugs.get(n.id) as string, { title: n.title, excerpt: plainText(bodies.get(n.id) as string).slice(0, 160) }]));
  add("previews.json", JSON.stringify(previews));
  if (!isPreview) {
    add("search-index.json", JSON.stringify(inside.map((n) => ({ path: slugs.get(n.id) as string, title: n.title, text: plainText(bodies.get(n.id) as string) }))));
    const base = `${config.publicUrl}/d/${slug}/`;
    const urls = inside.map((n) => `<url><loc>${escapeHtml(base + (slugs.get(n.id) ? encodeURIComponent(slugs.get(n.id) as string) : ""))}</loc></url>`).join("");
    add("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`);
  }
  for (const [path, body] of Object.entries(ASSETS)) add(path, body);
  return {
    objects,
    inside: inside.map((n) => n.id),
    pages: inside.map((n) => slugs.get(n.id) as string).filter((s) => s !== ""),
    publicCount: inside.length,
    severedCount: result.severed.length,
  };
}

export function noteCount(count: number): string {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

export function publishFooter(publishedAt: Date, count: number, timeZone: string): string {
  return `Published ${formatWhen(publishedAt.toISOString(), timeZone)} · ${noteCount(count)}`;
}
