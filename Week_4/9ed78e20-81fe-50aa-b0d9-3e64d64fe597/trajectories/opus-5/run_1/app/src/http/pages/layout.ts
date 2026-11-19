import { pool } from '../../db/pool.js';
import { formatLondonDateTime } from '../../domain/london.js';
import { publishedModels } from '../../domain/publicrecord.js';
import { html, raw, type Html } from '../html.js';
import { icon } from './icons.js';

export type PageOptions = {
  readonly title: string;
  readonly nonce: string;
  readonly body: Html;
  readonly dynamicCss?: readonly string[];
  readonly bodyClass?: string;
  readonly console?: boolean;
};

export type NavModel = { readonly slug: string; readonly title: string };

export async function navModels(): Promise<NavModel[]> {
  const models = await publishedModels(pool, null);
  return models.map((model) => ({ slug: model.slug, title: model.title }));
}

function primaryNav(models: readonly NavModel[]): Html {
  return html`
    <button type="button" class="menu-button" data-menu-button aria-expanded="false"
      aria-controls="primary-navigation">${icon('menu')}<span>Menu</span></button>
    <nav id="primary-navigation" aria-label="Primary" class="primary-nav">
      <ul class="nav-list">
        <li><a href="/">Thesis</a></li>
        <li class="has-menu">
          <button type="button" aria-expanded="false" aria-controls="models-menu"
            data-models-button>Models${icon('chevron-down')}</button>
          <ul id="models-menu" class="models-menu" data-models-menu hidden>
            ${models.map(
              (model) => html`<li><a href="/models/${model.slug}">${model.title}</a></li>`,
            )}
          </ul>
        </li>
        <li><a href="/news">Newsroom</a></li>
        <li><a href="/search">Search</a></li>
        <li><a href="/careers">Careers</a></li>
      </ul>
    </nav>
  `;
}

function consoleNav(): Html {
  return html`
    <nav aria-label="Console" class="console-nav">
      <ul class="nav-list">
        <li><a href="/console">Work queue</a></li>
        <li><a href="/console/rows">Rows</a></li>
        <li><a href="/console/requisitions">Requisitions</a></li>
        <li><a href="/console/benefits">Benefits</a></li>
        <li><a href="/console/grants">Grants</a></li>
        <li><a href="/console/audit">Audit</a></li>
        <li><a href="/console/jobs">Jobs</a></li>
      </ul>
      <button type="button" data-sign-out>Sign out</button>
    </nav>
    <p class="status-line" role="status" aria-live="polite" data-console-status></p>
    <p class="status-line" role="status" data-service-status></p>
  `;
}

export function page(options: PageOptions & { readonly models?: readonly NavModel[] }): Html {
  const dynamic = (options.dynamicCss ?? []).join('\n');
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title} — Aldermoor Labs</title>
<link rel="stylesheet" href="/assets/styles.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" href="/feed.xml" title="Aldermoor newsroom">
${dynamic === '' ? '' : raw(`<style nonce="${options.nonce}">${dynamic}</style>`)}
<script src="/assets/main.js" defer></script>
</head>
<body class="${options.bodyClass ?? ''}">
<a class="skip-link" href="#main-content">Skip to content</a>
<header class="sheet-header">
  <a class="wordmark" href="/">Aldermoor Labs<span class="wordmark-sub">Open Record</span></a>
  ${options.console === true ? consoleNav() : primaryNav(options.models ?? [])}
</header>
<main id="main-content" tabindex="-1">${options.body}</main>
<footer class="sheet-footer">
  <p>Aldermoor Labs is the frontier research arm of Corvane Group. Every number on this site
  links to a recorded row.</p>
  <p><a href="/feed.xml">${icon('rss')}Newsroom feed</a></p>
</footer>
</body>
</html>`;
}

/** "Published <D Month YYYY, HH:mm> London", upgraded in the browser to the reader's zone. */
export function publishedLine(instant: Date): Html {
  return html`<span class="published" data-instant="${instant.toISOString()}"
    >Published <span class="mono">${formatLondonDateTime(instant)}</span> London</span>`;
}

export function readTimeLine(minutes: number): Html {
  return html`<span class="read-time"><span class="mono">${minutes}</span> min read</span>`;
}
