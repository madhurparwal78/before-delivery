import { CHAPTERS } from '../shared/chapters';
import {
  INTERVIEW_NOT_FOUND_MESSAGE,
  PAGE_NOT_FOUND_HEADING,
  PAGE_NOT_FOUND_LINK,
} from '../shared/messages';
import type { SiteCopy } from '../shared/types';
import { escapeHtml } from '../shared/escape';
import { renderPage } from './markup';

const PACK_VIEWS = ['Front', 'Side', 'Back'] as const;
const PRODUCT_TABS = ['Details', 'Ingredients', 'How to use'] as const;
const INTERVIEW_FILTERS = ['All', 'Experts', 'Everyday'] as const;
const MODE_LABELS = ['ON', 'OFF'] as const;

function headingId(chapterId: string): string {
  return `${chapterId}-heading`;
}

function chapterOpen(
  index: number,
  classes: string,
  extraAttributes = '',
): string {
  const chapter = CHAPTERS[index];
  if (chapter === undefined) {
    throw new RangeError(`No chapter at index ${index}.`);
  }
  return `<section id="${chapter.id}" class="chapter ${classes}" data-chapter="${chapter.id}" aria-labelledby="${headingId(chapter.id)}"${extraAttributes}>`;
}

function openingChapter(site: SiteCopy): string {
  const words = site.opening.heading
    .split(' ')
    .map(
      (word, index) =>
        `<span class="opening__word" style="--word:${index}" data-word="${escapeHtml(word)}">${escapeHtml(word)}</span>`,
    )
    .join(' ');
  return `${chapterOpen(0, 'chapter--night chapter--opening')}
<div class="opening__light" aria-hidden="true"></div>
<div class="chapter__inner">
<h1 class="opening__heading" id="${headingId('opening')}" tabindex="-1">${words}</h1>
<p class="opening__line">${escapeHtml(site.opening.line)}</p>
<p class="opening__links">
<a class="button" href="/#about" data-chapter-link="about">Begin the story</a>
<a class="button button--quiet" href="/#product" data-chapter-link="product">See Vireo Pace</a>
</p>
</div>
</section>`;
}

function aboutChapter(site: SiteCopy): string {
  const panels = site.about.panels
    .map(
      (panel, index) =>
        `<div class="pane" data-pane="${index + 1}"><h3 class="pane__title">${escapeHtml(panel.title)}</h3><p class="pane__text">${escapeHtml(panel.text)}</p></div>`,
    )
    .join('');
  return `${chapterOpen(1, 'chapter--paper chapter--about', ' data-panel="1"')}
<div class="held" data-held>
<div class="chapter__inner">
<h2 class="chapter__heading" id="${headingId('about')}" tabindex="-1">${escapeHtml(site.about.heading)}</h2>
<p class="lead">${escapeHtml(site.about.lead)}</p>
<div class="panes" data-panes>
<div class="panes__track" data-track>${panels}</div>
</div>
<div class="panes__controls">
<button type="button" class="button button--quiet" data-panel-step="-1">Previous panel</button>
<p class="panes__counter" data-panel-counter>1 / ${site.about.panels.length}</p>
<button type="button" class="button button--quiet" data-panel-step="1">Next panel</button>
</div>
</div>
</div>
</section>`;
}

function oxygenDiagram(): string {
  return `<svg class="oxygen__svg" viewBox="0 0 620 240" aria-hidden="true" focusable="false">
<g class="oxygen__lungs">
<path d="M52 92c-16 6-24 28-22 52 2 22 10 38 22 38 8 0 12-10 12-26V96c0-6-5-7-12-4Z"/>
<path d="M96 92c16 6 24 28 22 52-2 22-10 38-22 38-8 0-12-10-12-26V96c0-6 5-7 12-4Z"/>
<path class="oxygen__trachea" d="M74 48v48"/>
</g>
<g class="oxygen__cell">
<circle cx="552" cy="120" r="46"/>
<ellipse class="oxygen__mito" cx="540" cy="110" rx="18" ry="9" transform="rotate(-24 540 110)"/>
<ellipse class="oxygen__mito" cx="564" cy="136" rx="15" ry="8" transform="rotate(14 564 136)"/>
</g>
<path class="oxygen__path" data-oxygen-path fill="none" d="M74 120C170 44 240 196 340 120C420 58 480 170 540 122"/>
<circle class="oxygen__dot" data-dot="0.00" cx="74" cy="120" r="9"/>
</svg>`;
}

function oxygenChapter(site: SiteCopy): string {
  const tabs = site.oxygen.stages
    .map(
      (stage, index) =>
        `<button type="button" role="tab" id="oxygen-tab-${index + 1}" aria-controls="oxygen-panel-${index + 1}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}" data-stage-tab="${index + 1}">${escapeHtml(stage.name)}</button>`,
    )
    .join('');
  const panels = site.oxygen.stages
    .map(
      (stage, index) =>
        `<div role="tabpanel" id="oxygen-panel-${index + 1}" aria-labelledby="oxygen-tab-${index + 1}" tabindex="0" class="stage-panel" data-stage-panel="${index + 1}"${index === 0 ? '' : ' hidden'}>
<h3 class="stage-panel__title">${escapeHtml(stage.title)}</h3>
<p class="stage-panel__text">${escapeHtml(stage.text)}</p>
</div>`,
    )
    .join('');
  return `${chapterOpen(2, 'chapter--night chapter--oxygen', ' data-stage="1"')}
<div class="held" data-held>
<div class="chapter__inner">
<h2 class="chapter__heading" id="${headingId('oxygen')}" tabindex="-1">${escapeHtml(site.oxygen.heading)}</h2>
<div class="oxygen__diagram">${oxygenDiagram()}</div>
<div class="oxygen__stages">
<div class="tablist" role="tablist" aria-label="Oxygen stages">${tabs}</div>
${panels}
</div>
</div>
</div>
</section>`;
}

function nitrateDiagram(site: SiteCopy): string {
  const nodes = site.science.steps
    .map((step, index) => {
      const x = 70 + index * 150;
      return `<g class="nitrate__node" data-nitrate-node="${index + 1}">
<circle cx="${x}" cy="70" r="34"/>
<text x="${x}" y="132" text-anchor="middle">${escapeHtml(step.name)}</text>
</g>`;
    })
    .join('');
  const arrows = [0, 1]
    .map((index) => {
      const from = 70 + index * 150 + 40;
      const to = 70 + (index + 1) * 150 - 40;
      return `<path class="nitrate__arrow" d="M${from} 70H${to}m-9-6 9 6-9 6"/>`;
    })
    .join('');
  return `<svg class="nitrate__svg" role="img" aria-label="Nitrate pathway diagram" data-step="1" data-nitrate-diagram viewBox="0 0 440 150">
${arrows}
${nodes}
</svg>`;
}

function beetDrawing(): string {
  return `<svg class="beet" viewBox="0 0 160 200" aria-hidden="true" focusable="false">
<path class="beet__leaf" d="M80 70C72 44 56 26 34 18c6 26 20 46 46 56Z"/>
<path class="beet__leaf" d="M80 70c8-26 24-44 46-52-6 26-20 46-46 56Z"/>
<path class="beet__stem" d="M80 70V54"/>
<path class="beet__root" d="M80 66c30 0 46 22 46 48 0 34-26 72-46 82-20-10-46-48-46-82 0-26 16-48 46-48Z"/>
<path class="beet__grain" d="M62 112c12 10 24 16 36 18M66 140c10 8 20 12 30 14"/>
</svg>`;
}

function scienceChapter(site: SiteCopy): string {
  const disclosures = site.science.disclosures
    .map((disclosure, index) => {
      const extra =
        index === site.science.disclosures.length - 1
          ? `<p><a href="/#product" data-chapter-link="product">See the amounts per stick</a></p>`
          : '';
      return `<div class="disclosure">
<h3 class="disclosure__heading"><button type="button" class="disclosure__button" aria-expanded="false" aria-controls="science-panel-${index + 1}" data-disclosure="${index + 1}">${escapeHtml(disclosure.title)}</button></h3>
<div class="disclosure__panel" id="science-panel-${index + 1}" data-disclosure-panel="${index + 1}" hidden>
<p>${escapeHtml(disclosure.text)}</p>${extra}
</div>
</div>`;
    })
    .join('');
  const firstStep = site.science.steps[0];
  if (firstStep === undefined) {
    throw new Error('The nitrate pathway has no steps.');
  }
  const stepTexts = site.science.steps
    .map(
      (step, index) =>
        `<p class="nitrate__text" data-nitrate-text="${index + 1}" data-step-name="${escapeHtml(step.name)}"${index === 0 ? '' : ' hidden'}>${escapeHtml(step.text)}</p>`,
    )
    .join('');
  return `${chapterOpen(3, 'chapter--paper chapter--science')}
<div class="chapter__inner spread">
<h2 class="chapter__heading" id="${headingId('science')}" tabindex="-1">${escapeHtml(site.science.heading)}</h2>
<p class="lead">${escapeHtml(site.science.lead)}</p>
<div class="spread__columns">
<div class="disclosures">${disclosures}</div>
<div class="spread__art">${beetDrawing()}</div>
</div>
<div class="nitrate">
<div class="nitrate__diagram">${nitrateDiagram(site)}</div>
<div class="nitrate__control">
<input class="slider" type="range" min="1" max="${site.science.steps.length}" step="1" value="1" aria-label="Nitrate pathway" aria-valuetext="${escapeHtml(firstStep.name)}" data-nitrate-slider>
<div class="nitrate__texts">${stepTexts}</div>
</div>
</div>
<p class="notice" data-notice></p>
</div>
</section>`;
}

function productChapter(): string {
  const views = PACK_VIEWS.map(
    (view, index) =>
      `<label class="radio"><input type="radio" name="pack-view" value="${view.toLowerCase()}"${index === 0 ? ' checked' : ''} data-pack-view="${view.toLowerCase()}"><span>${view}</span></label>`,
  ).join('');
  const tabs = PRODUCT_TABS.map(
    (tab, index) =>
      `<button type="button" role="tab" id="product-tab-${index + 1}" aria-controls="product-panel-${index + 1}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}" data-product-tab="${index + 1}">${escapeHtml(tab)}</button>`,
  ).join('');
  const panels = PRODUCT_TABS.map(
    (tab, index) =>
      `<div role="tabpanel" id="product-panel-${index + 1}" aria-labelledby="product-tab-${index + 1}" tabindex="0" class="product-panel" data-product-panel="${index + 1}"${index === 0 ? '' : ' hidden'}></div>`,
  ).join('');
  return `${chapterOpen(4, 'chapter--paper chapter--product')}
<div class="chapter__inner spread">
<h2 class="chapter__heading" id="${headingId('product')}" tabindex="-1" data-product-name></h2>
<p class="lead" data-product-line></p>
<div class="product__grid">
<div class="pack-showcase">
<div class="pack" role="img" data-pack data-view="front"></div>
<div class="radiogroup" role="radiogroup" aria-label="Pack view">${views}</div>
</div>
<div class="product__info">
<div class="tablist" role="tablist" aria-label="Product information">${tabs}</div>
${panels}
<div class="product__actions" data-sheet-host><button type="button" class="button" data-sheet-download>Download product sheet (PDF)</button></div>
<p class="product__edition" data-edition-line></p>
<p><a href="/store">Visit the online store</a></p>
</div>
</div>
</div>
</section>`;
}

function interviewsChapter(site: SiteCopy): string {
  const filters = INTERVIEW_FILTERS.map(
    (filter, index) =>
      `<label class="radio"><input type="radio" name="interview-filter" value="${filter.toLowerCase()}"${index === 0 ? ' checked' : ''} data-interview-filter="${filter.toLowerCase()}"><span>${escapeHtml(filter)}</span></label>`,
  ).join('');
  return `${chapterOpen(5, 'chapter--paper chapter--interviews')}
<div class="chapter__inner spread">
<h2 class="chapter__heading" id="${headingId('interviews')}" tabindex="-1">${escapeHtml(site.interviews.heading)}</h2>
<p class="note">${escapeHtml(site.interviews.note)}</p>
<div class="radiogroup" role="radiogroup" aria-label="Show interviews">${filters}</div>
<ul class="interviews" aria-label="Interviews" data-interviews></ul>
</div>
</section>`;
}

function lifestyleChapter(site: SiteCopy): string {
  const modes = MODE_LABELS.map(
    (label, index) =>
      `<label class="radio"><input type="radio" name="mode" value="${label.toLowerCase()}"${index === 0 ? ' checked' : ''} data-mode-radio="${label.toLowerCase()}"><span>${label}</span></label>`,
  ).join('');
  return `${chapterOpen(6, 'chapter--meridian', ' data-mode="on" data-scenario="on-work"')}
<div class="chapter__inner">
<h2 class="chapter__heading" id="${headingId('lifestyle')}" tabindex="-1">${escapeHtml(site.lifestyle.heading)}</h2>
<p class="lead">${escapeHtml(site.lifestyle.lead)}</p>
<div class="radiogroup" role="radiogroup" aria-label="Mode">${modes}</div>
<div class="meridian__stops-wrap">
<div class="meridian__stops" role="radiogroup" aria-label="Moments" data-moments></div>
<span class="meridian__marker" data-marker aria-hidden="true"></span>
</div>
<div class="meridian__panel" data-meridian-panel>
<div class="meridian__art" data-scenario-art></div>
<div class="meridian__copy" data-scenario-copy-block>
<p class="meridian__time" data-scenario-time></p>
<h3 class="meridian__title" data-scenario-title></h3>
<p class="meridian__text" data-scenario-text></p>
<p class="meridian__label">Where it fits</p>
<p class="meridian__moment" data-scenario-moment></p>
</div>
</div>
</div>
</section>`;
}

export function storyPage(site: SiteCopy): string {
  return renderPage({
    page: 'story',
    title: 'Vireo Pace | Alder Quay Laboratories',
    site,
    skipTarget: headingId('opening'),
    withRail: true,
    main: [
      openingChapter(site),
      aboutChapter(site),
      oxygenChapter(site),
      scienceChapter(site),
      productChapter(),
      interviewsChapter(site),
      lifestyleChapter(site),
    ].join('\n'),
  });
}

export function interviewPage(site: SiteCopy, name: string, slug: string): string {
  return renderPage({
    page: 'interview',
    title: `${name} | Vireo Pace interviews`,
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<article class="interview" data-interview-slug="${escapeHtml(slug)}">
<div class="chapter__inner spread">
<h1 class="interview__name" id="page-heading" tabindex="-1" data-interview-name></h1>
<p class="interview__role" data-interview-role></p>
<p class="lead" data-interview-lede></p>
<div class="interview__portrait" data-interview-portrait></div>
<div class="interview__answers" data-interview-answers></div>
<p class="note">${escapeHtml(site.interviews.note)}</p>
<nav class="interview__nav" aria-label="Interview pages" data-interview-nav></nav>
<p><a href="/#interviews" data-chapter-link="interviews">All interviews</a></p>
</div>
</article>`,
  });
}

export function interviewMissingPage(site: SiteCopy): string {
  return renderPage({
    page: 'interview-missing',
    title: 'Not found | Vireo Pace',
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<div class="chapter__inner spread">
<h1 id="page-heading" tabindex="-1">${escapeHtml(INTERVIEW_NOT_FOUND_MESSAGE)}</h1>
<p><a href="/#interviews" data-chapter-link="interviews">All interviews</a></p>
</div>`,
  });
}

export function storePage(site: SiteCopy): string {
  return renderPage({
    page: 'store',
    title: 'Online store | Vireo Pace',
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<div class="chapter__inner spread">
<h1 id="page-heading" tabindex="-1">Online store</h1>
<div class="store__packs" data-store-packs></div>
<h2>Where to buy</h2>
<ul class="store__links" data-store-links></ul>
<p class="product__edition" data-edition-line></p>
</div>`,
  });
}

export function contactPage(site: SiteCopy): string {
  return renderPage({
    page: 'contact',
    title: 'Contact | Alder Quay Laboratories',
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<div class="chapter__inner spread">
<h1 id="page-heading" tabindex="-1">${escapeHtml(site.contact.heading)}</h1>
<p>${escapeHtml(site.contact.care)}</p>
<p>${escapeHtml(site.contact.phone)}</p>
<p><a href="mailto:${escapeHtml(site.contact.email)}">${escapeHtml(site.contact.email)}</a></p>
</div>`,
  });
}

export function privacyPage(site: SiteCopy): string {
  return renderPage({
    page: 'privacy',
    title: 'Privacy | Alder Quay Laboratories',
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<div class="chapter__inner spread">
<h1 id="page-heading" tabindex="-1">${escapeHtml(site.privacy.heading)}</h1>
<p>${escapeHtml(site.privacy.body)}</p>
</div>`,
  });
}

export function legalPage(site: SiteCopy): string {
  return renderPage({
    page: 'legal',
    title: 'Legal | Alder Quay Laboratories',
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<div class="chapter__inner spread">
<h1 id="page-heading" tabindex="-1">${escapeHtml(site.legal.heading)}</h1>
<p>${escapeHtml(site.legal.body)}</p>
</div>`,
  });
}

export function notFoundPage(site: SiteCopy): string {
  return renderPage({
    page: 'not-found',
    title: 'Not found | Vireo Pace',
    site,
    skipTarget: 'page-heading',
    withRail: false,
    main: `<div class="chapter__inner spread">
<h1 id="page-heading" tabindex="-1">${escapeHtml(PAGE_NOT_FOUND_HEADING)}</h1>
<p><a href="/">${escapeHtml(PAGE_NOT_FOUND_LINK)}</a></p>
</div>`,
  });
}
