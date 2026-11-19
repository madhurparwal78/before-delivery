import { BRIEF_UNAVAILABLE, NOT_FOUND, PRIVACY } from '../content/copy.js';
import { escapeHtml } from './html.js';
import { renderPage } from './layout.js';

export const renderPrivacy = (): string =>
  renderPage({
    title: 'Privacy | Sollis Studio',
    headingId: 'privacy-heading',
    main: `<div class="prose">
  <h1 class="prose__heading" id="privacy-heading" tabindex="-1">${escapeHtml(PRIVACY.heading)}</h1>
  ${PRIVACY.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('\n  ')}
  <p><a class="link-underline" href="/">${escapeHtml(PRIVACY.backLink)}</a></p>
</div>`,
  });

const notFoundPage = (which: 'project' | 'page'): string => {
  const copy = NOT_FOUND[which];
  return renderPage({
    title: 'Not found | Sollis Studio',
    headingId: 'not-found-heading',
    main: `<div class="prose">
  <h1 class="prose__heading" id="not-found-heading" tabindex="-1">${escapeHtml(copy.heading)}</h1>
  <p><a class="link-underline" href="${copy.href}">${escapeHtml(copy.linkName)}</a></p>
</div>`,
  });
};

export const renderProjectNotFound = (): string => notFoundPage('project');

export const renderPageNotFound = (): string => notFoundPage('page');

export const renderBriefUnavailable = (reference: string): string =>
  renderPage({
    title: 'Brief unavailable | Sollis Studio',
    headingId: 'brief-unavailable-heading',
    main: `<div class="prose">
  <h1 class="prose__heading" id="brief-unavailable-heading" tabindex="-1">${escapeHtml(
    BRIEF_UNAVAILABLE.heading,
  )}</h1>
  <p>${escapeHtml(BRIEF_UNAVAILABLE.line(reference))}</p>
</div>`,
  });
