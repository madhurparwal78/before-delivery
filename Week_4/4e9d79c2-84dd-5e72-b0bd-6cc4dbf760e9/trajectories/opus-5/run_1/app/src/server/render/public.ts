import {
  FLEET_SIZES,
  HOME_PROMISES,
  OCCASION_PAGES,
  OccasionPage,
  QUESTIONS,
  TERMS_PARAGRAPHS,
} from './content.js';
import { escapeHtml, iconCheck, iconDesk, shell } from './layout.js';
import { CLIENT_MARKS, clientMark, coachDrawing, heroDrawing, occasionDrawing } from './svg.js';

const NAVIGATION = [
  { path: '/', label: 'Home' },
  { path: '/occasions/school', label: 'School trips' },
  { path: '/occasions/weddings', label: 'Weddings' },
  { path: '/occasions/company', label: 'Company travel' },
  { path: '/occasions/festivals', label: 'Festivals and sport' },
  { path: '/fleet', label: 'Fleet' },
  { path: '/terms', label: 'Terms' },
];

const TELEPHONE = '01632 960140';

function mainNavigation(path: string): string {
  const links = NAVIGATION.map(
    (item) =>
      `<li><a href="${item.path}"${item.path === path ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`,
  ).join('');
  return `<nav class="main-navigation" aria-label="Main"><ul>${links}</ul></nav>`;
}

function searchOverlay(): string {
  return `<div class="search-overlay" data-dialog="search" hidden>
  <div class="search-box" role="dialog" aria-modal="true" aria-label="Search" data-dialog-box>
    <label for="site-search">Search the site</label>
    <input id="site-search" type="search" role="searchbox" aria-label="Search the site" autocomplete="off">
    <ul class="search-results" role="list" aria-label="Search results"></ul>
    <button type="button" data-close>Close</button>
  </div>
</div>`;
}

function menuPanel(path: string): string {
  return `<div class="menu-panel-holder" data-dialog="public-menu" hidden>
  <div class="menu-panel" role="dialog" aria-modal="true" aria-label="Menu" data-dialog-box>
    ${mainNavigation(path)}
    <a class="cyan-link" href="/quote/route">Get a free quote</a>
    <button type="button" data-close>Close</button>
  </div>
</div>`;
}

function header(path: string): string {
  return `<header class="public-header">
  <div class="masthead">
    <div class="masthead-brand">
      <span class="wordmark">Merrowfield</span>
      ${coachDrawing(49, 'A Merrowfield coach')}
    </div>
    <div class="masthead-call">
      <span class="masthead-label">Coaches and minibuses with a driver</span>
      <a class="telephone" href="tel:+441632960140">Call ${TELEPHONE}</a>
      <a class="cyan-link" href="/quote/route">Get a free quote</a>
    </div>
  </div>
  ${mainNavigation(path)}
  <div class="phone-bar" data-part="phone-bar">
    <span class="wordmark">Merrowfield</span>
    <a class="telephone-outline" href="tel:+441632960140">Call ${TELEPHONE}</a>
    <button type="button" class="menu-button" data-opens="public-menu">Menu</button>
  </div>
  <div class="slim-bar" data-part="slim-bar" hidden>
    ${mainNavigation(path)}
    <a class="cyan-link" href="/quote/route">Get a free quote</a>
  </div>
  <button type="button" class="search-button" data-opens="search">Search</button>
</header>`;
}

function footer(): string {
  return `<footer class="legal-footer">
  <p>Merrowfield Coach Hire, Coventry</p>
  <p><a href="/terms">Terms</a> | <a href="/fleet">Fleet</a></p>
  <p>Call ${TELEPHONE}</p>
</footer>
<a class="message-us" href="mailto:maria@merrowfield.example" data-part="message-us"><span class="visually-hidden">Message us</span><span aria-hidden="true">✉</span></a>
<a class="back-to-top" href="#main" data-part="back-to-top" hidden>Back to top</a>`;
}

export function homePage(): string {
  const panels = OCCASION_PAGES.map(
    (page, index) => `<section class="split-panel ${index % 2 === 0 ? 'drawing-left' : 'drawing-right'}">
  <div class="split-drawing">${occasionDrawing(page.heading)}</div>
  <div class="split-text">
    <h2>${escapeHtml(page.heading)}</h2>
    <p>${escapeHtml(page.panel)}</p>
    <a href="${page.path}">${escapeHtml(page.heading)}</a>
  </div>
</section>`,
  ).join('');
  const cards = OCCASION_PAGES.map(
    (page) => `<a class="occasion-card" href="${page.path}">
  ${occasionDrawing(page.heading)}
  <h3>${escapeHtml(page.cardHeading[0])}<br>${escapeHtml(page.cardHeading[1])}</h3>
  <ul>${page.checklist.map((item) => `<li>${iconCheck()}${escapeHtml(item)}</li>`).join('')}</ul>
</a>`,
  ).join('');
  const marks = CLIENT_MARKS.map((name) => `<li>${clientMark(name)}</li>`).join('');
  return shell({
    title: 'Coach and minibus hire from Coventry | Merrowfield Coach Hire',
    bodyClass: 'public',
    before: header('/'),
    after: `${footer()}${searchOverlay()}${menuPanel('/')}`,
    main: `<section class="hero">
  ${heroDrawing()}
  <div class="hero-words">
    <h1>Coaches and minibuses with a driver</h1>
    <p>Arranged for you from Coventry</p>
  </div>
</section>
<section class="client-marks rise" aria-label="Clients">
  <button type="button" data-marks="earlier">Earlier</button>
  <ul class="marks-strip">${marks}</ul>
  <button type="button" data-marks="later">Later</button>
</section>
<section class="promise-band rise">
  <h2>One desk, one person, every detail checked</h2>
  ${iconDesk()}
  <ul>${HOME_PROMISES.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
  <a class="cyan-link wide" href="/quote/route">Get a free quote</a>
</section>
${panels}
<section class="occasion-cards rise" aria-label="Occasions">${cards}</section>
<section class="quote-band rise">
  <h2>Get a free quote</h2>
  <a href="/quote/route">Start your quote</a>
</section>`,
  });
}

export function occasionPage(page: OccasionPage): string {
  const rail = `<nav class="on-this-page" aria-label="On this page"><ul>${page.sections
    .map((section) => `<li><a href="#${section.id}">${escapeHtml(section.heading)}</a></li>`)
    .join('')}</ul></nav>`;
  const sections = page.sections
    .map((section) => {
      if (section.heading === 'Questions') {
        const items = QUESTIONS.map(
          (question) => `<div class="accordion" id="${question.id}">
  <h3><button type="button" aria-expanded="false" data-accordion="${question.id}">${escapeHtml(question.question)}</button></h3>
  <div class="accordion-panel" hidden><p>${escapeHtml(question.answer)}</p></div>
</div>`,
        ).join('');
        return `<section class="page-section rise" id="${section.id}" aria-labelledby="${section.id}-heading">
  <h2 id="${section.id}-heading">${escapeHtml(section.heading)}</h2>${items}</section>`;
      }
      return `<section class="page-section rise" id="${section.id}" aria-labelledby="${section.id}-heading">
  <h2 id="${section.id}-heading">${escapeHtml(section.heading)}</h2>
  ${section.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}
</section>`;
    })
    .join('');
  return shell({
    title: page.title,
    bodyClass: 'public occasion',
    before: header(page.path),
    after: `${footer()}${searchOverlay()}${menuPanel(page.path)}`,
    main: `<div class="band plum-band">
  <h1>${escapeHtml(page.heading)}</h1>
  <a class="cyan-link phone-quote" href="/quote?occasion=${page.occasion}">Get a free quote</a>
</div>
<div class="occasion-body">${rail}<div class="occasion-sections">${sections}</div></div>`,
  });
}

export function fleetPage(): string {
  const rows = FLEET_SIZES.map(
    (size) => `<section class="fleet-row rise">
  ${coachDrawing(size.seats, `${size.seats}-seat vehicle`)}
  <h2>${escapeHtml(size.name)}</h2>
  <p>${size.seats} seats &middot; ${size.bags} bag units</p>
</section>`,
  ).join('');
  return shell({
    title: 'Our fleet | Merrowfield Coach Hire',
    bodyClass: 'public',
    before: header('/fleet'),
    after: `${footer()}${searchOverlay()}${menuPanel('/fleet')}`,
    main: `<div class="band plum-band"><h1>Our fleet</h1></div>
<p class="band-note">We own no vehicles. These are the seven sizes our partner operators run, with the bag units each holds.</p>
${rows}`,
  });
}

export function termsPage(): string {
  return shell({
    title: 'Terms | Merrowfield Coach Hire',
    bodyClass: 'public',
    before: header('/terms'),
    after: `${footer()}${searchOverlay()}${menuPanel('/terms')}`,
    main: `<div class="band plum-band"><h1>Terms</h1></div>
<section class="terms rise">${TERMS_PARAGRAPHS.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}</section>`,
  });
}

export function notFoundPage(): string {
  return shell({
    title: 'Page not found',
    bodyClass: 'public',
    before: header(''),
    after: footer(),
    main: `<div class="band plum-band"><h1>Page not found</h1></div>
<p class="band-note">We can\'t find that. Try the <a href="/">home page</a>.</p>`,
  });
}

export { NAVIGATION, TELEPHONE };
