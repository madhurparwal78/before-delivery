import { assignPageSlugs, computeBoundary, type BoundaryResult, type CandidateNote } from './boundary';
import {
  escapeAttribute,
  escapeHtml,
  htmlToPlainText,
  renderMarkdown,
  WITHHELD,
  type RenderContext,
} from './markdown';

export interface NavEntry {
  title: string;
  href: string;
}

export interface SearchHit {
  title: string;
  href: string;
}

export interface PageShellInput {
  /** Public path of the dossier root, like "/d/port-ellery/" or "/p/<token>/". */
  basePath: string;
  documentTitle: string;
  heading: string;
  nav: NavEntry[];
  bodyHtml: string;
  linkedFrom: NavEntry[];
  searchQuery: string;
  searchResults: SearchHit[];
  searchMessage: string | null;
  footer: string;
  draftPreviewBanner: string | null;
}

export interface RenderedPage {
  noteId: string;
  title: string;
  /** Page path relative to the dossier root, "" for the index page. */
  pageSlug: string;
  objectKey: string;
  plainText: string;
  excerpt: string;
  input: PageShellInput;
}

export interface DossierObject {
  key: string;
  body: string;
  contentType: string;
}

export interface SearchIndexEntry {
  path: string;
  title: string;
  text: string;
}

export interface PreviewEntry {
  path: string;
  title: string;
  excerpt: string;
}

export interface DossierAssets {
  css: string;
  script: string;
}

export interface DossierRenderInput {
  notes: readonly CandidateNote[];
  rootNoteId: string;
  radius: number;
  /** Absolute site base, without a trailing slash, used for the sitemap. */
  siteBaseUrl: string;
  /** Public path of the dossier root, like "/d/port-ellery/" or "/p/<token>/". */
  basePath: string;
  footer: string;
  draftPreviewBanner: string | null;
  assets: DossierAssets | null;
  /** Previews and sitemaps are published objects only. */
  withSearchAndSitemap: boolean;
}

export interface DossierRender {
  boundary: BoundaryResult;
  pages: RenderedPage[];
  searchIndex: SearchIndexEntry[];
  previews: PreviewEntry[];
  objects: DossierObject[];
}

export const EXCERPT_LENGTH = 160;

function pagePath(basePath: string, pageSlug: string): string {
  return `${basePath}${pageSlug}`;
}

export function renderDossier(input: DossierRenderInput): DossierRender {
  const boundary = computeBoundary(input.notes, input.rootNoteId, input.radius);
  const { slugs } = assignPageSlugs(boundary, input.rootNoteId);
  const pageSlugOf = (noteId: string): string => (noteId === input.rootNoteId ? '' : (slugs.get(noteId) ?? ''));

  const insideNotes = boundary.inside.map((entry) => {
    const note = boundary.analysis.notes.get(entry.note_id);
    if (!note) throw new Error('inside note missing from candidates');
    return { note, hop: entry.hop };
  });

  const nav: NavEntry[] = insideNotes
    .map(({ note }) => ({ title: note.title, href: pagePath(input.basePath, pageSlugOf(note.id)) }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  const context = (): RenderContext => ({
    resolveWikilink: (target, label) => {
      const targetId = boundary.analysis.titleIndex.get(target.trim().toLowerCase());
      const targetNote = targetId ? boundary.analysis.notes.get(targetId) : undefined;
      if (!targetId || !targetNote || !boundary.insideIds.has(targetId)) {
        return { kind: 'plain', text: label ?? WITHHELD };
      }
      return { kind: 'link', href: pagePath(input.basePath, pageSlugOf(targetId)), text: label ?? targetNote.title };
    },
  });

  const bodies = new Map<string, string>();
  for (const { note } of insideNotes) bodies.set(note.id, renderMarkdown(note.body, context()));

  const linkedFrom = new Map<string, NavEntry[]>();
  for (const { note } of insideNotes) linkedFrom.set(note.id, []);
  for (const link of boundary.analysis.links) {
    if (!boundary.insideIds.has(link.fromId) || link.toId === null) continue;
    if (!boundary.insideIds.has(link.toId) || link.toId === link.fromId) continue;
    const from = boundary.analysis.notes.get(link.fromId);
    const list = linkedFrom.get(link.toId);
    if (!from || !list) continue;
    const href = pagePath(input.basePath, pageSlugOf(link.fromId));
    if (list.some((entry) => entry.href === href)) continue;
    list.push({ title: from.title, href });
  }
  for (const list of linkedFrom.values()) list.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  const pages: RenderedPage[] = insideNotes.map(({ note }) => {
    const bodyHtml = bodies.get(note.id) ?? '';
    const plainText = htmlToPlainText(bodyHtml);
    const pageSlug = pageSlugOf(note.id);
    return {
      noteId: note.id,
      title: note.title,
      pageSlug,
      objectKey: pageSlug === '' ? 'index.html' : `pages/${pageSlug}.html`,
      plainText,
      excerpt: plainText.slice(0, EXCERPT_LENGTH),
      input: {
        basePath: input.basePath,
        documentTitle: note.title,
        heading: note.title,
        nav,
        bodyHtml,
        linkedFrom: linkedFrom.get(note.id) ?? [],
        searchQuery: '',
        searchResults: [],
        searchMessage: null,
        footer: input.footer,
        draftPreviewBanner: input.draftPreviewBanner,
      },
    };
  });

  const searchIndex: SearchIndexEntry[] = pages.map((page) => ({
    path: pagePath(input.basePath, page.pageSlug),
    title: page.title,
    text: page.plainText,
  }));
  const previews: PreviewEntry[] = pages.map((page) => ({
    path: pagePath(input.basePath, page.pageSlug),
    title: page.title,
    excerpt: page.excerpt,
  }));

  const objects: DossierObject[] = pages.map((page) => ({
    key: page.objectKey,
    body: renderPageDocument(page.input),
    contentType: 'text/html; charset=utf-8',
  }));
  objects.push({
    key: 'previews.json',
    body: JSON.stringify({ previews }),
    contentType: 'application/json; charset=utf-8',
  });
  if (input.withSearchAndSitemap) {
    objects.push({
      key: 'search-index.json',
      body: JSON.stringify({ pages: searchIndex }),
      contentType: 'application/json; charset=utf-8',
    });
    objects.push({
      key: 'sitemap.xml',
      body: renderSitemap(
        pages.map((page) => `${input.siteBaseUrl}${input.basePath}${page.pageSlug}`),
      ),
      contentType: 'application/xml; charset=utf-8',
    });
  }
  if (input.assets) {
    objects.push({ key: 'assets/reader.css', body: input.assets.css, contentType: 'text/css; charset=utf-8' });
    objects.push({
      key: 'assets/reader.js',
      body: input.assets.script,
      contentType: 'text/javascript; charset=utf-8',
    });
  }

  return { boundary, pages, searchIndex, previews, objects };
}

export function renderSitemap(urls: readonly string[]): string {
  const entries = urls.map((url) => `  <url><loc>${escapeAttribute(url)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export interface FragmentOptions {
  /** Published and preview pages use document landmarks; the workbench preview pane does not. */
  landmarks: boolean;
}

export function renderPageFragment(input: PageShellInput, options: FragmentOptions): string {
  const mainOpen = options.landmarks ? '<main class="reader">' : '<div class="reader">';
  const mainClose = options.landmarks ? '</main>' : '</div>';
  const searchRole = options.landmarks ? ' role="search"' : '';

  const navItems = input.nav
    .map((entry) => `<li><a href="${escapeAttribute(entry.href)}">${escapeHtml(entry.title)}</a></li>`)
    .join('\n');
  const linkedItems = input.linkedFrom
    .map((entry) => `<li><a href="${escapeAttribute(entry.href)}">${escapeHtml(entry.title)}</a></li>`)
    .join('\n');
  const resultItems = input.searchResults
    .map((entry) => `<li><a href="${escapeAttribute(entry.href)}">${escapeHtml(entry.title)}</a></li>`)
    .join('\n');

  return `${
    input.draftPreviewBanner
      ? `<div class="draft-banner" role="region" aria-label="Draft preview">${escapeHtml(input.draftPreviewBanner)}</div>\n`
      : ''
  }${mainOpen}
<h1 class="dossier-heading">${escapeHtml(input.heading)}</h1>
<nav class="dossier-nav" aria-label="Dossier">
<ul>
${navItems}
</ul>
</nav>
<div class="note-body">
${input.bodyHtml}</div>
<div class="linked-from" role="region" aria-label="Linked from">
<h2>Linked from</h2>
<ul aria-label="Linked from list">
${linkedItems}
</ul>
</div>
<div class="dossier-search">
<form class="search-form" action="${escapeAttribute(`${input.basePath}search`)}" method="get"${searchRole}>
<input class="search-input" type="search" name="q" value="${escapeAttribute(input.searchQuery)}" aria-label="Search this dossier" />
<button type="submit">Search</button>
</form>
${input.searchMessage ? `<p class="search-message">${escapeHtml(input.searchMessage)}</p>\n` : ''}<ul class="search-results" aria-label="Search results">
${resultItems}
</ul>
</div>
<p class="dossier-footer">${escapeHtml(input.footer)}</p>
${mainClose}
`;
}

export function renderPageDocument(input: PageShellInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.documentTitle)}</title>
<link rel="stylesheet" href="${escapeAttribute(`${input.basePath}assets/reader.css`)}" />
<script src="${escapeAttribute(`${input.basePath}assets/reader.js`)}" defer></script>
</head>
<body>
${renderPageFragment(input, { landmarks: true })}</body>
</html>
`;
}

export function searchPageInput(
  basePath: string,
  dossierTitle: string,
  nav: NavEntry[],
  query: string,
  results: SearchHit[],
  footer: string,
  draftPreviewBanner: string | null,
  noResultsCopy: string,
): PageShellInput {
  return {
    basePath,
    documentTitle: dossierTitle,
    heading: dossierTitle,
    nav,
    bodyHtml: '',
    linkedFrom: [],
    searchQuery: query,
    searchResults: results,
    searchMessage: results.length === 0 ? noResultsCopy : null,
    footer,
    draftPreviewBanner,
  };
}
