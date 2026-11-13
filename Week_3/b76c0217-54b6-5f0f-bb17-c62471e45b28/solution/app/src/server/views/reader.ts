// The reader page: header, sidebar, article, contents. The public site, the signed-in preview and the shared
// preview are all this page with a different mode.

import { copy } from '../../shared/copy';
import { icon } from '../../shared/icons';
import type { ReaderBoot } from '../../shared/types';
import type { HeadingInfo } from '../domain/markdown';
import { escapeHtml } from '../domain/render';
import { documentHtml, embed } from './document';

export interface NavLink {
  id: string;
  title: string;
  href: string;
  current: boolean;
}

export interface ReaderModel {
  mode: ReaderBoot['mode'];
  documentTitle: string;
  site: { slug: string; title: string };
  version: { slug: string; title: string };
  homeHref: string;
  tabs: NavLink[];
  groups: { id: string; title: string; pages: NavLink[] }[];
  versions: ReaderBoot['versions'];
  article:
    | {
        kind: 'page';
        pageId: string;
        title: string;
        groupTitle: string;
        path: string;
        html: string;
        headings: HeadingInfo[];
        vote: ReaderBoot['vote'];
        operationId: string | null;
      }
    | { kind: 'notfound' };
}

const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
] as const;

const themeSwitch = (): string =>
  `<div class="theme-switch" role="radiogroup" aria-label="Theme">${THEMES.map(
    (theme) =>
      `<label class="theme-option"><input type="radio" name="theme" value="${theme.value}"${theme.value === 'system' ? ' checked' : ''}>${icon(theme.icon, 16)}<span>${theme.label}</span></label>`,
  ).join('')}</div>`;

function sections(model: ReaderModel): string {
  const tabs = model.tabs
    .map(
      (tab) =>
        `<a role="tab" id="tab-${escapeHtml(tab.id)}" href="${escapeHtml(tab.href)}" aria-selected="${tab.current}"${tab.current ? '' : ' tabindex="-1"'}>${escapeHtml(tab.title)}</a>`,
    )
    .join('');
  return `<div class="sections" role="tablist" aria-label="Sections">${tabs}</div>`;
}

function switcher(model: ReaderModel): string {
  const current = model.versions.find((v) => v.current);
  const options = model.versions
    .map(
      (v) =>
        `<li role="option" id="version-option-${escapeHtml(v.slug)}" aria-selected="${v.current}" data-href="${escapeHtml(v.href)}" data-fallback="${v.fallback}">${escapeHtml(v.title)}</li>`,
    )
    .join('');
  return (
    `<div class="version-switcher"><button type="button" class="button version-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="version-list" aria-label="Version: ${escapeHtml(current?.title ?? model.version.title)}">` +
    `<span>${escapeHtml(current?.title ?? model.version.title)}</span>${icon('chevronDown', 16)}</button>` +
    `<ul id="version-list" class="version-list" role="listbox" aria-label="Versions" tabindex="-1" hidden>${options}</ul></div>`
  );
}

function sidebar(model: ReaderModel): string {
  const groups = model.groups
    .map(
      (group) =>
        `<div class="nav-group" id="nav-grp-${escapeHtml(group.id)}"><h2 class="nav-group-title">${escapeHtml(group.title)}</h2><ul>` +
        group.pages
          .map(
            (page) =>
              `<li><a id="nav-${escapeHtml(page.id)}" href="${escapeHtml(page.href)}"${page.current ? ' aria-current="page"' : ''}>${escapeHtml(page.title)}</a></li>`,
          )
          .join('') +
        '</ul></div>',
    )
    .join('');
  return (
    `<aside id="site-nav" class="sidebar"><div class="drawer-extras" id="slot-drawer"></div>` +
    `<nav aria-label="Docs">${groups}</nav><div class="sidebar-foot">${themeSwitch()}</div></aside>`
  );
}

function contents(headings: HeadingInfo[]): string {
  const items = headings
    .map((h) => `<li class="toc-h${h.level}"><a href="#${escapeHtml(h.anchor)}">${escapeHtml(h.text)}</a></li>`)
    .join('');
  return (
    `<div class="toc-wrap"><button type="button" class="toc-toggle" aria-expanded="false" aria-controls="toc-panel"><span>On this page</span>${icon('chevronDown', 16)}</button>` +
    `<nav id="toc-panel" class="toc" aria-label="On this page"><ul>${items}</ul></nav></div>`
  );
}

function rating(vote: ReaderBoot['vote']): string {
  return (
    `<div class="rating" role="group" aria-labelledby="rating-label"><p id="rating-label">Was this page helpful?</p>` +
    `<button type="button" class="button" data-vote="yes" aria-pressed="${vote === 'yes'}">Yes</button>` +
    `<button type="button" class="button" data-vote="no" aria-pressed="${vote === 'no'}">No</button></div>`
  );
}

function article(model: ReaderModel): string {
  const view = model.article;
  if (view.kind === 'notfound') {
    return (
      `<article class="article"><p class="running-head"><span>${escapeHtml(model.site.title)}</span></p>` +
      `<svg class="proof-mark" viewBox="0 0 40 48" width="40" height="48" aria-hidden="true"><path d="M6 2h20l8 8v36H6z" class="proof-mark-page"/><path d="M26 2v8h8M12 20h16M12 27h16M12 34h10" class="proof-mark-page"/><path d="M2 40 38 8" class="proof-mark-strike"/></svg>` +
      `<h1 id="page-title" tabindex="-1">${escapeHtml(copy.notFoundHeading)}</h1><p>${escapeHtml(copy.notFoundText)}</p>` +
      `<form role="search" class="search-form" data-not-found><label class="sr-only" for="not-found-search">Search the docs</label>` +
      `${icon('search', 18)}<input id="not-found-search" type="search" name="q" autocomplete="off" spellcheck="false" aria-label="Search the docs" placeholder="Search the docs"></form></article>`
    );
  }
  return (
    `<article class="article"><p class="running-head"><span>${escapeHtml(view.groupTitle)}</span><span class="folio mono">/${escapeHtml(view.path)}</span></p>` +
    `<p class="fallback-notice" id="fallback-notice" hidden></p>` +
    `<h1 id="page-title" tabindex="-1">${escapeHtml(view.title)}</h1><div class="prose">${view.html}</div>` +
    (model.mode === 'public' ? rating(view.vote) : '') +
    '</article>'
  );
}

const searchDialog = (): string =>
  `<dialog id="search-dialog" class="search-dialog" aria-label="Search docs"><div class="search-box">${icon('search', 18)}` +
  `<input id="search-input" type="text" role="combobox" aria-label="Search docs" aria-controls="search-results" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search the docs">` +
  `<button type="button" class="icon-button" id="search-close" aria-label="Close search">${icon('x', 18)}</button></div>` +
  `<p id="search-count" class="search-count"></p><ul id="search-results" class="search-results" role="listbox" aria-label="Search results" hidden></ul></dialog>`;

export function readerHtml(model: ReaderModel): string {
  const searchable = model.mode === 'public';
  const view = model.article;
  const boot: ReaderBoot = {
    mode: model.mode,
    siteSlug: model.site.slug,
    versionSlug: model.version.slug,
    pageId: view.kind === 'page' ? view.pageId : null,
    pageTitle: view.kind === 'page' ? view.title : '',
    vote: view.kind === 'page' ? view.vote : null,
    versions: model.versions,
    operationId: view.kind === 'page' ? view.operationId : null,
  };
  const body =
    (model.mode === 'public' ? '' : `<div class="draft-banner" id="draft-banner">${escapeHtml(copy.draftBanner)}</div>`) +
    `<div class="update-banner" id="update-banner" hidden><span>${escapeHtml(copy.updateBanner)}</span><button type="button" class="button primary" id="update-reload">Reload</button></div>` +
    `<header class="site-header"><button type="button" class="menu-button button" id="menu-button" aria-expanded="false" aria-controls="site-nav" aria-haspopup="dialog">${icon('menu', 20)}<span>Menu</span></button>` +
    `<a class="site-title" href="${escapeHtml(model.homeHref)}">${escapeHtml(model.site.title)}</a>` +
    `<div class="header-tabs" id="slot-tabs">${sections(model)}</div>` +
    `<div class="header-tools">${searchable ? `<button type="button" class="button search-button" id="search-button">${icon('search', 18)}<span>Search</span><kbd aria-hidden="true">Ctrl K</kbd></button>` : ''}` +
    `<div id="slot-version">${searchable ? switcher(model) : ''}</div></div></header>` +
    `<div class="layout"><div class="backdrop" id="backdrop" hidden></div>${sidebar(model)}` +
    `${view.kind === 'page' ? contents(view.headings) : ''}` +
    `<main id="main">${article(model)}</main></div>` +
    (searchable ? searchDialog() : '') +
    `<script type="application/json" id="reader-boot">${embed(boot)}</script>`;
  return documentHtml({
    title: model.documentTitle,
    bodyClass: 'reader',
    bodyAttributes: `data-mode="${model.mode}"`,
    body,
    scripts: '<script src="/static/reader.js" defer></script>',
  });
}
