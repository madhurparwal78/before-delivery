import { escapeHtml } from '../domain/text.js';
import { config } from '../config.js';
import { formatLondon, LONDON_TZ } from '../domain/time.js';

export type NavModel = { slug: string; title: string };

export type PageShell = {
  title: string;
  description: string;
  body: string;
  bodyClass?: string;
  skipConsoleNav?: boolean;
  asOf?: string | null;
  inlineData?: string;
  scripts?: string[];
};

/** Headers every HTML page sends, including the CSP. */
export function htmlPageHeaders(rateHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    ...rateHeaders,
  };
}

export function pageHtml(shell: PageShell): string {
  const nav = primaryNav(shell.bodyClass === 'console');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shell.title)}</title>
<meta name="description" content="${escapeHtml(shell.description)}">
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script src="/assets/app.js" defer></script>
</head>
<body class="${shell.bodyClass ?? 'public'}">
<a class="skip-link" href="#main">Skip to content</a>
${nav}
<main id="main" tabindex="-1">
${shell.body}
</main>
<footer class="site-foot">
  <p>Aldermoor Labs is the frontier research arm of Corvane Group. This record is the lab's own account of its work.</p>
</footer>
${shell.inlineData ? `<script type="application/json" id="page-data">${shell.inlineData}</script>` : ''}
</body>
</html>`;
}

function primaryNav(isConsole: boolean): string {
  if (isConsole) return '';
  return `<header class="site-head">
  <div class="sheet">
    <div class="brand"><a class="brand-link" href="/">Aldermoor Labs <span>Open Record</span></a></div>
    <nav class="primary-nav" aria-label="Primary">
      <a href="/">Thesis</a>
      <div class="menu-wrap">
        <button type="button" class="menu-button" id="models-menu" aria-expanded="false" aria-controls="models-menu-list">Models</button>
        <div class="menu-list" id="models-menu-list" hidden>
          <a href="/models">All models</a>
        </div>
      </div>
      <a href="/news" class="nav-link-newsroom">Newsroom</a>
      <a href="/search">Search</a>
      <a href="/careers">Careers</a>
    </nav>
    <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="primary-nav-mobile">Menu</button>
  </div>
</header>`;
}

export function publicationTimesHtml(publishedAt: Date): string {
  const london = formatLondon(publishedAt);
  return `<span class="pub-time" data-published-at="${publishedAt.toISOString()}">Published ${escapeHtml(london)} London</span>`;
}

export function readTimeHtml(minutes: number | null): string {
  if (minutes === null) return '';
  return `<span class="read-time">${minutes} min read</span>`;
}

export function asOfBanner(asOf: Date, basePath: string): string {
  return `<div class="as-of-banner" role="region" aria-label="Record as of">
    <p>You are reading the record as it stood at <strong>${escapeHtml(formatLondon(asOf))}</strong> London.</p>
    <a class="as-of-clear" href="${escapeHtml(basePath)}">Read the current record</a>
  </div>`;
}

export function notFoundPage(kind: 'generic' | 'post' | 'model' | 'role' | 'link'): string {
  const headings: Record<typeof kind, string> = {
    generic: 'Nothing is published here',
    post: 'Nothing is published here',
    model: 'Nothing is published here',
    role: 'This role has closed.',
    link: 'This tracking link is not valid.',
  };
  const body = kind === 'link'
    ? `<p>We could not find an application for this link. You can ask for a new one below.</p>
      ${resendFormHtml('link')}`
    : `<p>Nothing is published at this address, and nothing ever was.</p>
      <p><a href="/">Return to the open record</a></p>`;
  return pageHtml({
    title: 'Nothing is published here — Aldermoor Open Record',
    description: 'Nothing is published at this address.',
    body: `<section class="plain-page">
      <h1 class="display">${escapeHtml(headings[kind])}</h1>
      ${body}
    </section>`,
  });
}

export function gonePage(kind: 'post' | 'model' | 'role'): string {
  const heading =
    kind === 'post'
      ? 'This post has been withdrawn.'
      : kind === 'model'
        ? 'This model route has been withdrawn.'
        : 'This role has closed.';
  return pageHtml({
    title: `${heading} — Aldermoor Open Record`,
    description: heading,
    body: `<section class="plain-page">
      <h1 class="display">${escapeHtml(heading)}</h1>
      <p><a href="/">Return to the open record</a></p>
    </section>`,
  });
}

export function resendFormHtml(where: 'careers' | 'link'): string {
  return `<form class="resend-form" action="/careers" method="get" data-resend="true" aria-label="Resend my tracking links">
    <h2>Resend my tracking links</h2>
    <div class="field">
      <label for="resend-email">Email</label>
      <input type="email" id="resend-email" name="email" autocomplete="email" required>
      <p class="field-error" hidden></p>
    </div>
    <button type="submit" class="button">Resend links</button>
    <p class="status" role="status" aria-live="polite" id="resend-status">Send us the address you applied with and we will email any live tracking links.</p>
  </form>`;
}
