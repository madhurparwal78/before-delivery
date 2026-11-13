import type { Block, Inline, ParsedPage } from '../shared/markdown';
import { parsePage, walkHeadings } from '../shared/markdown';
import type { PageRow, VersionRow, SiteRow, NavigationJson } from './queries';
import { copy } from '../shared/copy';

export type RenderMode = 'public' | 'preview' | 'shared';

export type RenderPageArgs = {
  page: PageRow;
  site: SiteRow;
  version: VersionRow;
  navigation: NavigationJson;
  mode: RenderMode;
  pageTitles?: Map<string, string>;
  pagePaths?: Map<string, string>;
  publishedVersions?: { slug: string; title: string }[];
  groupTitle?: string;
  css?: string;
};

let uid = 0;
function nextId(prefix: string): string { return `${prefix}-${++uid}`; }

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function linkHrefFor(target: string, base: string): string | null {
  if (target.startsWith('/')) {
    const hash = target.indexOf('#');
    const path = hash === -1 ? target.slice(1) : target.slice(1, hash);
    const anchor = hash === -1 ? '' : target.slice(hash);
    return `${base}/${path}${anchor}`;
  }
  if (target.startsWith('#')) return target;
  if (/^https?:/i.test(target) || /^mailto:/i.test(target)) return target;
  return null;
}

function renderInlines(inlines: Inline[], base: string): string {
  let out = '';
  for (const i of inlines) {
    switch (i.kind) {
      case 'text': out += esc(i.text); break;
      case 'code': out += `<code>${esc(i.text)}</code>`; break;
      case 'em': out += `<em>${renderInlines(i.children, base)}</em>`; break;
      case 'strong': out += `<strong>${renderInlines(i.children, base)}</strong>`; break;
      case 'image': out += `<img src="${esc(i.url)}" alt="${esc(i.alt)}">`; break;
      case 'link': {
        const href = linkHrefFor(i.target, base);
        out += href === null ? esc(i.text) : `<a href="${esc(href)}">${esc(i.text)}</a>`;
        break;
      }
    }
  }
  return out;
}

function renderBlocks(blocks: Block[], base: string): string {
  let out = '';
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': {
        const level = b.level <= 1 ? 2 : b.level;
        if (b.anchor) {
          out += `<h${level} id="${esc(b.anchor)}">${esc(b.text)}<a class="anchor-link" href="#${esc(b.anchor)}" aria-label="Link to ${esc(b.text)}">#</a></h${level}>\n`;
        } else {
          out += `<h${level}>${esc(b.text)}</h${level}>\n`;
        }
        break;
      }
      case 'paragraph': out += `<p>${renderInlines(b.inlines, base)}</p>\n`; break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        out += `<${tag}>\n${b.items.map((it) => `<li>${renderInlines(it, base)}</li>`).join('\n')}\n</${tag}>\n`;
        break;
      }
      case 'code': {
        const cls = b.lang ? ` class="language-${esc(b.lang)}"` : '';
        out += `<pre${cls}><code>${esc(b.text)}</code></pre>\n`;
        break;
      }
      case 'callout': {
        const label = b.type.charAt(0).toUpperCase() + b.type.slice(1);
        out += `<aside data-component="callout" role="note" aria-label="${esc(label)}"><p class="callout-label">${esc(label)}</p>\n${renderBlocks(b.children, base)}</aside>\n`;
        break;
      }
      case 'accordion': {
        const id = nextId('acc');
        out += `<div data-component="accordion" class="accordion-item"><h3 class="accordion-heading"><button type="button" class="accordion-toggle" aria-expanded="false" aria-controls="${id}">${esc(b.title)}</button></h3><div class="accordion-region" id="${id}" data-motion="closed" hidden>${renderBlocks(b.children, base)}</div></div>\n`;
        break;
      }
      case 'tabs': {
        const gid = nextId('tabs');
        out += `<div data-component="tabs">\n<div class="tablist" role="tablist">\n`;
        b.tabs.forEach((t, idx) => {
          out += `<button type="button" role="tab" id="${gid}-tab-${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}" aria-controls="${gid}-panel-${idx}" tabindex="${idx === 0 ? 0 : -1}" data-title="${esc(t.title)}">${esc(t.title)}</button>\n`;
        });
        out += `</div>\n`;
        b.tabs.forEach((t, idx) => {
          out += `<div role="tabpanel" id="${gid}-panel-${idx}" aria-labelledby="${gid}-tab-${idx}"${idx === 0 ? '' : ' hidden'}>${renderBlocks(t.children, base)}</div>\n`;
        });
        out += `</div>\n`;
        break;
      }
      case 'code-group': {
        const gid = nextId('cg');
        out += `<div data-component="code-group">\n<div class="tablist" role="tablist" aria-label="Code examples">\n`;
        b.blocks.forEach((t, idx) => {
          out += `<button type="button" role="tab" id="${gid}-tab-${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}" aria-controls="${gid}-panel-${idx}" tabindex="${idx === 0 ? 0 : -1}" data-title="${esc(t.title ?? '')}">${esc(t.title ?? '')}</button>\n`;
        });
        out += `</div>\n`;
        b.blocks.forEach((t, idx) => {
          out += `<div role="tabpanel" id="${gid}-panel-${idx}" aria-labelledby="${gid}-tab-${idx}"${idx === 0 ? '' : ' hidden'}><button type="button" class="copy-button">Copy</button><pre><code>${esc(t.text)}</code></pre></div>\n`;
        });
        out += `</div>\n`;
        break;
      }
      case 'try-it': {
        out += `<!--TRYIT:${esc(b.operationId)}-->\n`;
        break;
      }
      case 'steps': {
        out += `<ol data-component="steps" class="steps">\n`;
        b.steps.forEach((s, idx) => {
          out += `<li><h3>${esc(`Step ${idx + 1}: ${s.title}`)}</h3>\n${renderBlocks(s.children, base)}</li>\n`;
        });
        out += `</ol>\n`;
        break;
      }
      case 'cards': {
        out += `<ul data-component="cards" class="cards">\n`;
        for (const c of b.cards) {
          const href = c.href ? linkHrefFor(c.href, base) : null;
          const body = renderBlocks(c.children, base);
          out += `<li>${href === null || !c.title ? esc(c.title) : `<a href="${esc(href)}">${esc(c.title)}</a>`}${body}</li>\n`;
        }
        out += `</ul>\n`;
        break;
      }
    }
  }
  return out;
}

export function renderContent(source: string, base: string): { html: string; parsed: ParsedPage } {
  const parsed = parsePage(source);
  return { html: renderBlocks(parsed.blocks, base), parsed };
}

export function documentTitle(pageTitle: string, siteTitle: string, versionTitle: string): string {
  return `${pageTitle} - ${siteTitle} (${versionTitle})`;
}

export function internalBase(siteSlug: string, versionSlug: string): string {
  return `/docs/${siteSlug}/${versionSlug}`;
}

export function renderPageHtml(args: RenderPageArgs): string {
  const { page, site, version, navigation, mode } = args;
  const base = internalBase(site.slug, version.slug);
  const { html } = renderContent(page.source, base);
  const headings = pageHeadingsOf(page.source);
  const pageTitles = args.pageTitles ?? new Map<string, string>();
  const pagePaths = args.pagePaths ?? new Map<string, string>();
  const publishedVersions = args.publishedVersions ?? [];
  const groupTitle = args.groupTitle ?? '';

  const docTitle = `${page.title} - ${site.title} (${version.title})`;
  const isShared = mode === 'shared';
  const isPreview = mode === 'preview';

  const tabsHtml = navigation.tabs.map((t) => {
    const firstPageId = t.groups.flatMap((g) => g.pages)[0];
    const firstPath = pagePaths.get(firstPageId) ?? '';
    const selected = t.groups.some((g) => g.pages.includes(page.id));
    const href = isShared ? '#' : `/docs/${esc(site.slug)}/${esc(version.slug)}/${esc(firstPath)}`;
    return `<a id="tab-${esc(t.id)}" role="tab" aria-selected="${selected}" href="${href}">${esc(t.title)}</a>`;
  }).join('\n');

  const navList = (single: boolean): string => {
    if (single) {
      return `<nav class="docs-nav" data-nav aria-label="Docs"><div id="nav-grp-draft"><h2 class="group-title">Draft</h2><ul><li><a id="nav-${esc(page.id)}" aria-current="page" href="#">${esc(page.title)}</a></li></ul></div></nav>`;
    }
    let out = '<nav class="docs-nav" data-nav aria-label="Docs">\n';
    for (const tab of navigation.tabs) {
      for (const group of tab.groups) {
        if (group.pages.length === 0) continue;
        out += `<div id="nav-grp-${esc(group.id)}"><h2 class="group-title">${esc(group.title)}</h2><ul>\n`;
        for (const pageId of group.pages) {
          const p = pagePaths.get(pageId) ?? '';
          const t = pageTitles.get(pageId) ?? '';
          const isCurrent = pageId === page.id;
          out += `<li><a id="nav-${esc(pageId)}"${isCurrent ? ' aria-current="page"' : ''} href="/docs/${esc(site.slug)}/${esc(version.slug)}/${esc(p)}">${esc(t)}</a></li>\n`;
        }
        out += '</ul></div>\n';
      }
    }
    return out + '</nav>';
  };

  const tocHtml = headings.map((h) => `<a href="#${esc(h.anchor)}">${esc(h.text)}</a>`).join('\n');

  const versionOptions = publishedVersions.map((v) =>
    `<div role="option" data-version-option data-version-url="/docs/${esc(site.slug)}/${esc(v.slug)}/${esc(page.path)}" aria-selected="${v.slug === version.slug}">${esc(v.title)}</div>`,
  ).join('');

  const ratings = !isShared
    ? `<div class="rating-group" data-rating-group data-page-id="${esc(page.id)}" role="group" aria-label="Was this page helpful?">
  <span>Was this page helpful?</span>
  <button type="button" data-rating="yes" aria-pressed="false">Yes</button>
  <button type="button" data-rating="no" aria-pressed="false">No</button>
</div>`
    : '';

  const banner = isPreview || isShared
    ? `<div class="draft-banner">${esc(copy.draftBanner)}</div>`
    : '';

  const themeGroup = `<div class="theme-group" data-theme-group></div>`;
  const css = args.css ?? '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
<style>${css}</style>
</head>
<body class="reader-page" data-site-slug="${esc(site.slug)}" data-version-slug="${esc(version.slug)}" data-page-id="${esc(page.id)}">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
${banner}
<div class="reader-shell">
<header class="reader-header">
  <button type="button" class="menu-button" data-menu-button aria-expanded="false">Menu</button>
  <h1 class="site-title">${esc(site.title)}</h1>
  <div class="section-tabs" role="tablist" aria-label="Sections">${tabsHtml}</div>
  <button type="button" class="search-button" data-search-button>Search</button>
  <div class="version-switcher">
    <button type="button" data-version-button aria-haspopup="listbox" aria-expanded="false">Version: ${esc(version.title)}</button>
    <div class="version-listbox" data-version-listbox role="listbox" aria-label="Versions" hidden>${versionOptions}</div>
  </div>
</header>
<nav class="reader-sidebar">
  ${navList(isShared)}
  ${themeGroup}
</nav>
<main class="reader-article" id="article">
  <p class="article-group-label">${esc(groupTitle)}</p>
  <article>
    <h1 id="page-title">${esc(page.title)}</h1>
${html}
  </article>
  ${ratings}
</main>
<aside class="reader-toc" aria-label="On this page">
  <nav class="toc" data-toc aria-label="On this page">${tocHtml}</nav>
</aside>
</div>
<div class="toc-disclosure">
  <button type="button" class="toc-toggle" data-toc-toggle aria-expanded="false" aria-controls="toc-list">On this page</button>
  <nav class="toc" id="toc-list" data-toc hidden>${tocHtml}</nav>
</div>
<div class="drawer" data-drawer="site-navigation" role="dialog" aria-modal="true" aria-label="Site navigation" hidden>
  ${navList(isShared)}
  <div class="version-switcher">
    <button type="button" data-version-button aria-expanded="false">Version: ${esc(version.title)}</button>
    <div class="version-listbox" data-version-listbox role="listbox" aria-label="Versions" hidden>${versionOptions}</div>
  </div>
  ${themeGroup}
</div>
<button type="button" class="drawer-backdrop" data-drawer-backdrop tabindex="-1" aria-hidden="true"></button>
<div class="search-dialog" data-search-dialog hidden>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search docs">
    <input type="text" data-search-input role="combobox" aria-expanded="true" aria-controls="search-results" aria-label="Search docs" placeholder="Search docs">
    <div class="search-count" id="search-count" data-search-count hidden></div>
    <div class="search-results" id="search-results" data-search-results role="listbox" aria-label="Search results"></div>
    <button type="button" data-search-close>Close</button>
  </div>
</div>
<script src="/client/reader.js"></script>
</body>
</html>`;
}

function pageHeadingsOf(source: string): { text: string; anchor: string; level: number }[] {
  const parsed = parsePage(source);
  const out: { text: string; anchor: string; level: number }[] = [];
  walkHeadings(parsed.blocks, (h) => {
    if (h.anchor) out.push({ text: h.text, anchor: h.anchor, level: h.level });
  });
  return out;
}

export function renderTryItPanel(operationId: string, op: {
  method: string; path: string; parameters: { name: string; in: string; required: boolean }[];
  hasBody: boolean; codes: { code: string; description: string }[]; defaultCode: string;
}): string {
  const paramFields = op.parameters.map((p) =>
    `<label>\n<span>${esc(p.name)}${p.required ? '' : ''}</span>\n<input type="text" id="param-${esc(p.name)}" data-param data-param-name="${esc(p.name)}"${p.required ? ' required' : ''} data-in="${esc(p.in)}">\n</label>`,
  ).join('\n');
  const codeOptions = op.codes.map((c) =>
    `<option value="${esc(c.code)}"${c.code === op.defaultCode ? ' selected' : ''}>${esc(c.code)} ${esc(c.description)}</option>`,
  ).join('');
  return `<div data-component="tryit" data-try-it data-operation-id="${esc(operationId)}" class="try-it">
<form data-try-it-form>
  ${paramFields}
  ${op.hasBody ? `<label>\n<span>Request body</span>\n<textarea id="tryit-body" data-body rows="6"></textarea>\n</label>` : ''}
  <label>\n<span>Response code</span>\n<select data-code>${codeOptions}</select>\n</label>
  <button type="submit">Send request</button>
  <div class="tryit-result" data-result>
    <p class="status-line" data-status-line aria-live="polite"></p>
    <pre class="response-body" data-response-body></pre>
  </div>
</form>
</div>`;
}
