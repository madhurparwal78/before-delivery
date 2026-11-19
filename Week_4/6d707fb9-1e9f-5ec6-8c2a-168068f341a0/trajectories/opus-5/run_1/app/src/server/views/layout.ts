import { type Raw, html, json, raw } from './html';
import type { Language } from '../domain/numbers';
import { answerCopy } from '../domain/copy';

export interface PageOptions {
  heading: string;
  screen: string;
  lang?: Language | 'en';
  dir?: 'ltr' | 'rtl';
  frame: 'public' | 'desk' | 'bare';
  main: Raw;
  dialogs?: Raw;
  data?: Record<string, unknown>;
  refreshLineCopy?: string;
  announcementsName?: string;
}

const TITLE_SUFFIX = 'Fio Contado Desk';

const DESK_LINKS: { href: string; name: string }[] = [
  { href: '/styles', name: 'Styles' },
  { href: '/labels', name: 'Labels' },
  { href: '/requests', name: 'Requests' },
  { href: '/visits', name: 'Visits' },
  { href: '/passports', name: 'Passports' },
];

function publicHeader(): Raw {
  return html`
    <header class="site-header" data-part="site-header">
      <a class="brand" href="/">Fio Contado Desk</a>
      <nav class="site-nav" aria-label="Pages">
        <button type="button" class="nav-link explore" data-action="toggle-mega" aria-expanded="false"
          aria-controls="mega-menu">Explore</button>
        <a class="nav-link" href="/method">Method</a>
        <a class="nav-link" href="/questions">Questions</a>
        <a class="nav-link" href="/sign-in">Sign in</a>
      </nav>
    </header>
    <div class="mega" id="mega-menu" data-part="mega-menu" aria-label="Explore" hidden>
      <a class="mega-tile" href="/method#stages">The five stages</a>
      <a class="mega-tile" href="/method#measures">Six measures</a>
      <a class="mega-tile" href="/questions">Questions</a>
      <a class="mega-tile" href="/#try-one-garment">Try one garment</a>
      <a class="mega-tile" href="/sign-in">Sign in</a>
      <a class="mega-tile" href="/sign-up">Start a desk</a>
    </div>
  `;
}

function deskFrame(screen: string): Raw {
  return html`
    <div class="desk-top">
      <a class="brand" href="/styles">Fio Contado Desk</a>
      <button type="button" class="menu-button" data-action="toggle-menu" aria-expanded="false"
        aria-controls="desk-menu">Menu</button>
    </div>
    <nav class="desk-rail" id="desk-menu" data-part="desk-menu" aria-label="Menu">
      ${raw(
        DESK_LINKS.map(
          (link) =>
            `<a class="rail-link${screen === link.name.toLowerCase() ? ' current' : ''}" href="${link.href}">${link.name}</a>`,
        ).join(''),
      )}
      <button type="button" class="rail-sign-out" data-action="sign-out">Sign out</button>
    </nav>
  `;
}

export function page(options: PageOptions): string {
  const lang = options.lang ?? 'en';
  const dir = options.dir ?? 'ltr';
  const refreshCopy = options.refreshLineCopy ?? answerCopy.refreshFailed.en;
  const announcementsName = options.announcementsName ?? 'Announcements';
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeTitle(options.heading)} \u2014 ${TITLE_SUFFIX}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body data-screen="${options.screen}" data-frame="${options.frame}">
<div class="announcements" role="status" aria-label="${announcementsName}" data-part="announcements"><span
  data-slot="a"></span><span data-slot="b"></span></div>
<a class="skip-link" href="#main">Skip to main content</a>
${options.frame === 'public' ? publicHeader().text : ''}
${options.frame === 'desk' ? deskFrame(options.screen).text : ''}
<div class="page-body">
<main id="main" class="main" data-part="main">
${options.main.text}
</main>
</div>
<div class="dialogs" data-part="dialogs">${options.dialogs ? options.dialogs.text : ''}</div>
<script type="application/json" data-part="page-data">${json({
    screen: options.screen,
    refreshCopy,
    ...(options.data ?? {}),
  }).text}</script>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function escapeTitle(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Every screen's heading, with the refresh line and Problems summary under it. */
export function heading(text: string, problems: string | null = 'Problems'): Raw {
  return html`
    <h1 id="page-heading" tabindex="-1">${text}</h1>
    <p class="refresh-line" data-part="refresh-line" hidden></p>
    ${problems === null ? '' : problemsRegion(problems)}
  `;
}

/** What a refresh announces when a supplier's answer arrives. */
export function arrivalMark(arrival: { key: string; text: string } | null): Raw {
  if (!arrival) return html``;
  return html`<p data-part="arrival" data-key-value="${arrival.key}" hidden>${arrival.text}</p>`;
}

function problemsRegion(name = 'Problems'): Raw {
  return html`<div class="problems" role="region" aria-label="${name}" data-part="problems" hidden></div>`;
}

/** The screen's main action, in a bar fixed to the bottom at 375x812. */
export function actionBar(content: Raw): Raw {
  return html`<div class="action-bar" data-part="action-bar">${content}</div>`;
}
