import type { Locale } from '../domain/model';
import { copy } from '../domain/i18n';

export function esc(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PageContext {
  locale: Locale;
  path: string;
  signedIn: boolean;
  isStaff: boolean;
}

export function layout(ctx: PageContext, options: {
  title: string;
  heading: string;
  mainContent: string;
  bodyClass?: string;
}): string {
  const l = ctx.locale;
  const other = l === 'en' ? 'fr' : 'en';
  const navLinks = `
    <a href="/${l}/">${copy.navProgramme[l]}</a>
    <a href="/${l}/membership">${copy.navMembership[l]}</a>
    <a href="/${l}/gift">${copy.navGift[l]}</a>
    <a href="/${l}/contact">${copy.navContact[l]}</a>
    ${ctx.signedIn
      ? `<a href="/${l}/account">${copy.navMyAccount[l]}</a>`
      : `<a href="/${l}/signin">${copy.navSignIn[l]}</a>`}
    ${ctx.isStaff ? `<a href="/${l}/staff">${copy.navMyAccount[l]}</a>` : ''}`;

  return `<!doctype html>
<html lang="${l}" data-active-season="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)} — ${esc(copy.wordmark[l])}</title>
<link rel="stylesheet" href="/assets/app.css">
<script defer src="/assets/app.js"></script>
</head>
<body class="${esc(options.bodyClass ?? '')}" data-locale="${l}">
<a class="skip-link" href="#main-heading">${esc(copy.skip[l])}</a>
<header class="site-header">
  <div class="wordmark"><a href="/${l}/">${esc(copy.wordmark[l])}</a></div>
  <button type="button" class="menu-toggle" aria-expanded="false" aria-controls="primary-nav" aria-label="${esc(copy.menu[l])}">${esc(copy.menu[l])}</button>
  <nav id="primary-nav" aria-label="${esc(copy.primaryNav[l])}" class="primary-nav" hidden>
    ${navLinks}
  </nav>
  <a class="language-button" lang="${other}" href="/locale/${other}?next=${encodeURIComponent(ctx.path)}">${esc(copy.language[l])}</a>
</header>
<div id="service-notice-slot"></div>
<main id="main-content">
  ${options.heading ? `<h1 id="main-heading" tabindex="-1">${esc(options.heading)}</h1>` : ''}
  ${options.mainContent}
</main>
<footer class="site-footer">
  <p>${esc(copy.wordmark[l])} — Montréal</p>
</footer>
</body>
</html>`;
}

export function noticeMarkup(l: Locale, billingUp: boolean, mailUp: boolean): string {
  const paragraphs: string[] = [];
  if (!billingUp) paragraphs.push(`<p>${esc(copy.billingNotice[l])}</p>`);
  if (!mailUp) paragraphs.push(`<p>${esc(copy.mailNotice[l])}</p>`);
  if (paragraphs.length === 0) return '';
  return `<div id="service-notice" role="alert" aria-label="${esc(copy.notice[l])}" class="service-notice">
    ${paragraphs.join('\n')}
    <button type="button" id="dismiss-notice" data-dismiss-text="${esc(copy.dismissNotice[l])}">${esc(copy.dismissNotice[l])}</button>
  </div>`;
}
