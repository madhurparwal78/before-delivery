import { escapeHtml } from '../domain/markdown';
import { messages, readerMessages } from '../domain/messages';
import { page as shell, themeRadios } from './shell';

export interface NavPage {
  id: string;
  title: string;
  path: string;
}

export interface NavGroup {
  id: string;
  title: string;
  pages: NavPage[];
}

export interface NavTab {
  id: string;
  title: string;
  groups: NavGroup[];
}

export interface VersionChoice {
  slug: string;
  title: string;
}

export interface ReaderHeading {
  level: number;
  text: string;
  anchor: string | null;
}

export type ReaderMode = 'public' | 'preview' | 'shared';

export interface ReaderView {
  siteSlug: string;
  siteTitle: string;
  versionSlug: string;
  versionTitle: string;
  versions: VersionChoice[];
  tabs: NavTab[];
  currentTabId: string | null;
  page: {
    id: string;
    title: string;
    path: string;
    groupTitle: string;
    aboveTitle: string;
    html: string;
    headings: ReaderHeading[];
  };
  mode: ReaderMode;
  vote: 'yes' | 'no' | null;
  fallbackNotice: string | null;
}

const pageUrl = (view: { siteSlug: string; versionSlug: string }, path: string): string =>
  `/docs/${view.siteSlug}/${view.versionSlug}/${path}`;

function sectionTabs(view: ReaderView): string {
  const tabs = view.tabs
    .filter((tab) => tab.groups.some((group) => group.pages.length > 0))
    .map((tab) => {
      const first = tab.groups.flatMap((group) => group.pages)[0];
      const selected = tab.id === view.currentTabId;
      return `<a role="tab" id="tab-${escapeHtml(tab.id)}" href="${escapeHtml(pageUrl(view, first.path))}" aria-selected="${selected}">${escapeHtml(tab.title)}</a>`;
    })
    .join('');
  return `<div class="header-sections" role="tablist" aria-label="Sections">${tabs}</div>`;
}

function docsNav(view: ReaderView): string {
  const current = view.tabs.find((tab) => tab.id === view.currentTabId);
  const groups = (current === undefined ? [] : current.groups)
    .filter((group) => group.pages.length > 0)
    .map((group) => {
      const links = group.pages
        .map(
          (navPage) =>
            `<li><a class="nav-link" id="nav-${escapeHtml(navPage.id)}" href="${escapeHtml(pageUrl(view, navPage.path))}"${navPage.id === view.page.id ? ' aria-current="page"' : ''}>${escapeHtml(navPage.title)}</a></li>`,
        )
        .join('');
      return `<div class="nav-group" id="nav-grp-${escapeHtml(group.id)}"><h2>${escapeHtml(group.title)}</h2><ul class="nav-list">${links}</ul></div>`;
    })
    .join('');
  return `<nav aria-label="Docs">${groups}</nav>`;
}

function versionSwitcher(view: ReaderView): string {
  const options = view.versions
    .map(
      (version, index) =>
        `<li role="option" id="version-${index + 1}" data-slug="${escapeHtml(version.slug)}" aria-selected="${version.slug === view.versionSlug}">${escapeHtml(version.title)}</li>`,
    )
    .join('');
  return `<div class="header-switcher switcher">
<button type="button" class="version-button" aria-expanded="false">Version: ${escapeHtml(view.versionTitle)}</button>
<ul class="version-list" role="listbox" aria-label="Versions" hidden>${options}</ul>
</div>`;
}

function tableOfContents(view: ReaderView): string {
  const items = view.page.headings
    .filter((heading) => heading.anchor !== null)
    .map(
      (heading) =>
        `<li class="level-${heading.level}"><a href="#${escapeHtml(heading.anchor as string)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('');
  if (items === '') return '<div class="toc-wrap"></div>';
  return `<div class="toc-wrap">
<button type="button" class="toc-toggle" aria-expanded="false" aria-controls="toc">On this page</button>
<nav class="toc-nav" id="toc" aria-label="On this page"><h2>On this page</h2><ul>${items}</ul></nav>
</div>`;
}

function searchDialog(view: ReaderView): string {
  return `<div class="modal search-modal" id="search-dialog" role="dialog" aria-modal="true" aria-label="Search docs" hidden>
<div class="field"><label for="search-input" class="visually-hidden">Search docs</label>
<input class="search-input" id="search-input" type="text" role="combobox" aria-label="Search docs" aria-expanded="true" aria-controls="search-results" aria-autocomplete="list" autocomplete="off" data-site="${escapeHtml(view.siteSlug)}" data-version="${escapeHtml(view.versionSlug)}"></div>
<p id="search-count"></p>
<ul class="search-results" id="search-results" role="listbox" aria-label="Search results"></ul>
</div>`;
}

function header(view: ReaderView): string {
  const first = view.tabs.flatMap((tab) => tab.groups.flatMap((group) => group.pages))[0];
  const home = first === undefined ? '#' : pageUrl(view, first.path);
  return `<header class="site-header">
<button type="button" class="menu-button" aria-expanded="false">Menu</button>
<a class="site-title" href="${escapeHtml(home)}">${escapeHtml(view.siteTitle)}</a>
${sectionTabs(view)}
<div class="header-tools">
<button type="button" class="search-button">Search</button>
${versionSwitcher(view)}
</div>
</header>`;
}

function ratingGroup(view: ReaderView): string {
  const button = (label: string, vote: 'yes' | 'no'): string =>
    `<button type="button" data-vote="${vote}" aria-pressed="${view.vote === vote}">${label}</button>`;
  return `<div class="rating" role="group" aria-label="Was this page helpful?" data-page="${escapeHtml(view.page.id)}" data-site="${escapeHtml(view.siteSlug)}">
<span class="rating-label">Was this page helpful?</span>${button('Yes', 'yes')}${button('No', 'no')}
</div>`;
}

export function readerPage(view: ReaderView): string {
  const banner =
    view.mode === 'public'
      ? `<div class="banner update-banner" id="update-banner" hidden><span>${escapeHtml(readerMessages.updateBanner)}</span><button type="button" id="reload-button">Reload</button></div>`
      : `<div class="banner draft-banner">${escapeHtml(messages.draftBanner)}</div>`;
  const notice =
    view.fallbackNotice === null
      ? ''
      : `<p class="proof-note" id="version-fallback">${escapeHtml(view.fallbackNotice)}</p>`;
  const content = `${header(view)}
${banner}
<div class="reader-layout">
<div class="sidebar" id="site-nav">
<div class="drawer-extra" id="drawer-extra"></div>
${docsNav(view)}
${themeRadios()}
</div>
${tableOfContents(view)}
<main class="article-column">
${notice}
<article>
${view.page.aboveTitle}
<p class="group-label">${escapeHtml(view.page.groupTitle)}</p>
<h1 tabindex="-1" id="page-title">${escapeHtml(view.page.title)}</h1>
<div class="page-content">${view.page.html}</div>
${ratingGroup(view)}
</article>
</main>
</div>
${searchDialog(view)}`;
  return shell({
    documentTitle: readerMessages.documentTitle(view.page.title, view.siteTitle, view.versionTitle),
    bodyClass: 'reader',
    script: 'reader',
    data: {
      siteSlug: view.siteSlug,
      versionSlug: view.versionSlug,
      pageId: view.page.id,
      pagePath: view.page.path,
      mode: view.mode,
      focusTitle: view.fallbackNotice !== null,
      announce: view.fallbackNotice,
    },
    content,
  });
}

export interface NotFoundView {
  siteSlug: string;
  siteTitle: string;
  versionSlug: string;
  versionTitle: string;
  versions: VersionChoice[];
  tabs: NavTab[];
}

export function notFoundPage(view: NotFoundView): string {
  const readerView: ReaderView = {
    ...view,
    currentTabId: view.tabs[0]?.id ?? null,
    page: {
      id: '',
      title: readerMessages.notFoundHeading,
      path: '',
      groupTitle: '',
      aboveTitle: '',
      html: '',
      headings: [],
    },
    mode: 'public',
    vote: null,
    fallbackNotice: null,
  };
  const content = `${header(readerView)}
<div class="reader-layout">
<div class="sidebar" id="site-nav">
<div class="drawer-extra" id="drawer-extra"></div>
${docsNav(readerView)}
${themeRadios()}
</div>
<div class="toc-wrap"></div>
<main class="article-column">
<article>
<h1 tabindex="-1" id="page-title">${escapeHtml(readerMessages.notFoundHeading)}</h1>
<p>${escapeHtml(readerMessages.notFoundText)}</p>
<div role="search"><div class="field"><label for="not-found-search">Search the docs</label>
<input id="not-found-search" type="search" aria-label="Search the docs"></div></div>
</article>
</main>
</div>
${searchDialog(readerView)}`;
  return shell({
    documentTitle: readerMessages.notFoundDocumentTitle(view.siteTitle, view.versionTitle),
    bodyClass: 'reader',
    script: 'reader',
    data: {
      siteSlug: view.siteSlug,
      versionSlug: view.versionSlug,
      pageId: null,
      pagePath: null,
      mode: 'public',
      focusTitle: false,
      announce: null,
    },
    content,
  });
}

export function expiredPreviewPage(): string {
  return shell({
    documentTitle: readerMessages.expiredPreview,
    bodyClass: 'reader',
    script: 'reader',
    content: `<main class="screen"><h1>${escapeHtml(readerMessages.expiredPreview)}</h1></main>`,
  });
}
