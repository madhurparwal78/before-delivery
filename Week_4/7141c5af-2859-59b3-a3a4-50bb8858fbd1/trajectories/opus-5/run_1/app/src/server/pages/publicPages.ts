/**
 * The public site, rendered in full in the server's first response.
 */
import { escapeHtml } from '../domain/markup.ts';
import { CASE_KIND_NAMES, CASE_SECTIONS, PUBLIC_CASES, findCase, type PublicCase } from '../../shared/cases.ts';
import { chairDrawing, pinFragment } from '../../shared/drawings.ts';
import { renderDocument, PUBLIC_HEADER } from './shell.ts';

export const SITE_NAME = 'Bottega Semenza';

export const HOME_HEADLINE = 'ONE CHAIR AT A TIME.';
export const HOME_LINE =
  "A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai.";

export const WORK_FILTERS = [
  { value: null, label: 'All' },
  { value: 'leather', label: 'Leather' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'frame-only', label: 'Frame only' },
] as const;

function caseTile(item: PublicCase): string {
  return `<li class="tile-case" data-kind="${item.kind}">
  <a class="case-link" href="/work/${item.slug}" data-case-link="${item.slug}">
    <span class="case-drawing" data-part="case-drawing" data-case="${item.slug}">${chairDrawing(item.slug)}</span>
    <span class="case-title">${escapeHtml(item.title)}</span>
  </a>
  <p class="case-figure"><span class="label">${escapeHtml(CASE_KIND_NAMES[item.kind])}</span> <span class="figure">${escapeHtml(item.figure)}</span></p>
</li>`;
}

export function renderHome(): string {
  const bentwood = PUBLIC_CASES[0]!;
  const main = `<section class="bento home">
  <h1 class="tile tile-headline display" id="page-heading" tabindex="-1">${escapeHtml(HOME_HEADLINE)}</h1>
  <p class="tile tile-lede">${escapeHtml(HOME_LINE)}</p>
  <p class="tile tile-action"><a class="button-primary" href="/enquire">Send an enquiry</a></p>
  <div class="tile tile-mint home-figure">
    <p class="figure-label">${escapeHtml(bentwood.title)} hide</p>
    <p class="figure" data-part="home-figure">${escapeHtml(bentwood.figure)}</p>
  </div>
  <div class="tile home-chair">${chairDrawing('home-chair')}</div>
  <div class="tile home-pins">${pinFragment('home-pins')}</div>
</section>`;
  return renderDocument({
    title: SITE_NAME,
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'home',
    bodyClass: 'public',
  });
}

export function renderWork(kind: string | null): string {
  const shown = kind === null ? PUBLIC_CASES : PUBLIC_CASES.filter((item) => item.kind === kind);
  const radios = WORK_FILTERS.map((filter) => {
    const checked = (filter.value ?? null) === kind;
    const id = `kind-${filter.value ?? 'all'}`;
    return `<span class="radio"><input type="radio" name="kind" id="${id}" value="${filter.value ?? ''}"${
      checked ? ' checked' : ''
    }><label for="${id}">${escapeHtml(filter.label)}</label></span>`;
  }).join('');

  const main = `<section class="bento work">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">Work</h1>
  <div class="tile tile-filter" role="radiogroup" aria-label="Kind">${radios}</div>
  <ul class="tile tile-grid case-grid" id="case-grid">${shown.map(caseTile).join('')}</ul>
  <div class="tile tile-mint"><p class="figure-label">Finished cases</p><p class="figure">${shown.length}</p></div>
</section>`;

  return renderDocument({
    title: `Work \u2014 ${SITE_NAME}`,
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'work',
    bodyClass: 'public',
  });
}

const CASE_TEXT: Record<string, string[]> = {
  'as-it-came':
    ['The chair arrived with its cover split along the front seam and its frame sound but dry. Nothing had been re-covered before, so the original tacking line was still legible under the welt.'],
  'what-we-found':
    ['Lifting the cover showed webbing that had lost its tension and one loose joint at the back rail. The condition map records each finding by pin, in reading order, before any work began.'],
  'the-cover':
    ['The new cover was cut from one dye lot so that no seam shows a second batch. The pattern was laid on the hide around its flaws, and the used-leather figure below is the figure the estimate was built on.'],
  'the-frame':
    ['The loose joint was taken apart, cleaned and glued, then left to cure for a full forty-eight hours before any cover work was loaded onto it. The frame was waxed, not refinished.'],
  'keeping-it-well':
    ['Keep the piece out of direct sun and away from radiators. Dust it with a soft dry cloth. Ask the conservator before using any cleaner.'],
  files:
    ['The dossier for this piece holds its stamp, its signed condition pins, the material and dye lot, the before and after photographs and a care card in the owner\u2019s language.'],
};

export function renderCase(item: PublicCase): string {
  const rail = CASE_SECTIONS.map(
    (section) =>
      `<li><a href="#${section.hash}" data-rail="${section.hash}" aria-current="${
        section.number === '01' ? 'true' : 'false'
      }"><span class="rail-number">${section.number}</span><span class="visually-hidden"> ${escapeHtml(
        section.heading,
      )}</span></a></li>`,
  ).join('');

  const sections = CASE_SECTIONS.map(
    (section) => `<section class="tile case-section" id="${section.hash}-section">
  <h2 id="${section.hash}" tabindex="-1">${section.number} ${escapeHtml(section.heading)}</h2>
  ${(CASE_TEXT[section.hash] ?? []).map((text) => `<p>${escapeHtml(text)}</p>`).join('')}
  ${section.hash === 'the-cover' ? `<p class="figure-inline">Used <span class="figure">${escapeHtml(item.figure)}</span></p>` : ''}
</section>`,
  ).join('');

  const main = `<article class="bento case">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">${escapeHtml(item.title)}</h1>
  <div class="tile case-hero"><span class="case-drawing" data-part="case-drawing" data-case="${item.slug}" data-hero="true">${chairDrawing(item.slug)}</span></div>
  <div class="tile tile-mint"><p class="figure-label">Cover used</p><p class="figure">${escapeHtml(item.figure)}</p></div>
  <div class="case-rail-holder">
    <nav class="case-rail" aria-label="Sections" id="case-rail">
      <div class="rail-frame" role="region" aria-label="Section numbers" tabindex="0"><ol>${rail}</ol></div>
    </nav>
  </div>
  <div class="case-body">${sections}</div>
</article>`;

  return renderDocument({
    title: `${item.title} \u2014 ${SITE_NAME}`,
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'case',
    bodyClass: 'public',
  });
}

export function renderEnquire(): string {
  const main = `<section class="bento enquire">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">Send an enquiry</h1>
  <div class="tile tile-form">
    <div role="region" aria-label="Problems" id="problems" hidden><h2>Problems</h2><ul></ul></div>
    <form id="enquiry-form" novalidate>
      <p class="field"><label for="enquiry-name">Name</label>
        <input id="enquiry-name" name="name" type="text" autocomplete="name" required></p>
      <p class="field"><label for="enquiry-email">Email</label>
        <input id="enquiry-email" name="email" type="email" autocomplete="email" required></p>
      <p class="field"><label for="enquiry-message">Message</label>
        <textarea id="enquiry-message" name="message" rows="6" required></textarea></p>
      <p><button type="submit" class="button-primary" id="enquiry-send">Send enquiry</button></p>
    </form>
  </div>
  <div class="tile tile-mint"><p class="figure-label">Towns served</p><p class="figure">5</p></div>
</section>`;
  return renderDocument({
    title: `Enquire \u2014 ${SITE_NAME}`,
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'enquire',
    bodyClass: 'public',
  });
}

export function renderSignIn(returnTo: string | null): string {
  const main = `<section class="bento auth">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">Sign in</h1>
  <div class="tile tile-form">
    <div role="region" aria-label="Problems" id="problems" hidden><h2>Problems</h2><ul></ul></div>
    <form id="sign-in-form" novalidate>
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo ?? '')}">
      <p class="field"><label for="sign-in-email">Email</label>
        <input id="sign-in-email" name="email" type="email" autocomplete="email" required></p>
      <p class="field"><label for="sign-in-password">Password</label>
        <input id="sign-in-password" name="password" type="password" autocomplete="current-password" required></p>
      <p><button type="submit" class="button-primary" id="sign-in-submit">Sign in</button></p>
      <p><a href="/sign-up">Start a desk</a></p>
    </form>
  </div>
  <div class="tile tile-mint"><p class="figure-label">One desk</p><p class="figure">1</p></div>
</section>`;
  return renderDocument({
    title: 'Sign in \u2014 Semenza Desk',
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'sign-in',
    bodyClass: 'public auth-page',
  });
}

export function renderSignUp(): string {
  const main = `<section class="bento auth">
  <h1 class="tile tile-headline" id="page-heading" tabindex="-1">Start a desk</h1>
  <div class="tile tile-form">
    <div role="region" aria-label="Problems" id="problems" hidden><h2>Problems</h2><ul></ul></div>
    <form id="sign-up-form" novalidate>
      <p class="field"><label for="sign-up-name">Your name</label>
        <input id="sign-up-name" name="name" type="text" autocomplete="name" required></p>
      <p class="field"><label for="sign-up-email">Email</label>
        <input id="sign-up-email" name="email" type="email" autocomplete="email" required></p>
      <p class="field"><label for="sign-up-password">Password</label>
        <input id="sign-up-password" name="password" type="password" autocomplete="new-password" required></p>
      <p><button type="submit" class="button-primary" id="sign-up-submit">Start a desk</button></p>
    </form>
  </div>
  <div class="tile tile-mint"><p class="figure-label">Materials to start</p><p class="figure">12</p></div>
</section>`;
  return renderDocument({
    title: 'Start a desk \u2014 Semenza Desk',
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'sign-up',
    bodyClass: 'public auth-page',
  });
}

export function renderNotFound(): string {
  const main = `<section class="bento"><h1 class="tile tile-headline" id="page-heading" tabindex="-1">Page not found</h1>
  <p class="tile">That address is not part of this desk.</p></section>`;
  return renderDocument({
    title: 'Page not found',
    lang: 'en',
    dir: 'ltr',
    header: PUBLIC_HEADER,
    main,
    screen: 'not-found',
    bodyClass: 'public',
  });
}

export { PUBLIC_CASES, CASE_SECTIONS, findCase };
