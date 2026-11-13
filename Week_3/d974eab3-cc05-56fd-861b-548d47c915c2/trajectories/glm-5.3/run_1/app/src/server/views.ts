import { CHAPTERS } from '../domain/seed.js';
import { INNER_PACE_PANELS, NITRATE_STEPS, OXYGEN_STAGES, SCIENCE_DISCLOSURES, SITE_COPY } from '../domain/copy.js';
import { escapeXml } from './xml.js';

export function storyPage(): string {
  const openingWords = SITE_COPY.opening.heading.split(' ');
  return `
<div class="chapter-rail" role="navigation" aria-label="Chapters">
${CHAPTERS.map(
  (chapter) => `  <a class="rail-link" href="#${chapter.id}" data-rail-chapter="${chapter.id}">${chapter.num} ${escapeXml(chapter.title)}</a>`,
).join('\n')}
</div>
<div class="chapters">
<section class="chapter chapter-opening" id="opening" role="region" aria-labelledby="opening-heading">
  <div class="night-stage opening-stage">
    <h1 class="hero-heading" id="opening-heading" tabindex="-1" data-hero-heading>${openingWords
      .map((word) => `<span class="hero-word" data-word>${escapeXml(word)}</span>`)
      .join(' ')}</h1>
    <p class="hero-line">${escapeXml(SITE_COPY.opening.line)}</p>
    <p class="hero-links">
      <a class="action-link" href="#about" data-chapter-jump="about">Begin the story</a>
      <a class="action-link" href="#product" data-chapter-jump="product">See Vireo Pace</a>
    </p>
  </div>
</section>

<section class="chapter chapter-about" id="about" role="region" aria-labelledby="about-heading" data-innerpace>
  <div class="paper-stage about-stage" data-stage-holder>
    <div class="stage-inner">
      <h2 class="chapter-heading" id="about-heading" tabindex="-1" data-chapter-heading>${escapeXml(SITE_COPY.about.heading)}</h2>
      <p class="lead">${escapeXml(SITE_COPY.about.lead)}</p>
      <div class="panel-track" data-track>
        ${INNER_PACE_PANELS.map(
          (panel) => `<article class="pace-panel"><h3>${escapeXml(panel.title)}</h3><p>${escapeXml(panel.text)}</p></article>`,
        ).join('\n        ')}
      </div>
      <div class="pace-controls">
        <button class="panel-button" type="button" data-panel-prev disabled>Previous panel</button>
        <span class="pace-counter" data-panel-counter>1 / 3</span>
        <button class="panel-button" type="button" data-panel-next>Next panel</button>
      </div>
    </div>
  </div>
</section>

<section class="chapter chapter-oxygen" id="oxygen" role="region" aria-labelledby="oxygen-heading" data-oxygen>
  <div class="night-stage oxygen-stage" data-stage-holder>
    <div class="stage-inner">
      <h2 class="chapter-heading" id="oxygen-heading" tabindex="-1" data-chapter-heading>${escapeXml(SITE_COPY.oxygen.heading)}</h2>
      <div class="oxygen-layout">
        <div class="oxygen-diagram" data-dot-holder></div>
        <div class="oxygen-tabs">
          <div class="tablist" role="tablist" aria-label="Oxygen stages" data-stage-tablist>
            ${OXYGEN_STAGES.map(
              (stage, index) => `<button class="tab" type="button" role="tab" id="stage-tab-${index + 1}" aria-controls="stage-panel-${index + 1}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-stage-tab="${index + 1}">${escapeXml(stage.name)}</button>`,
            ).join('\n            ')}
          </div>
          ${OXYGEN_STAGES.map(
            (stage, index) => `<div class="tabpanel" role="tabpanel" id="stage-panel-${index + 1}" aria-labelledby="stage-tab-${index + 1}" tabindex="0" data-stage-panel="${index + 1}"${index === 0 ? '' : ' hidden'}><h3>${escapeXml(stage.title)}</h3><p>${escapeXml(stage.text)}</p></div>`,
          ).join('\n          ')}
        </div>
      </div>
    </div>
  </div>
</section>

<section class="chapter chapter-science" id="science" role="region" aria-labelledby="science-heading">
  <div class="paper-stage science-stage">
    <div class="stage-inner">
      <h2 class="chapter-heading" id="science-heading" tabindex="-1" data-chapter-heading>${escapeXml(SITE_COPY.science.heading)}</h2>
      <p class="lead">${escapeXml(SITE_COPY.science.lead)}</p>
      <div class="disclosures">
${SCIENCE_DISCLOSURES.map(
  (disclosure, index) => `        <div class="disclosure" data-disclosure>
          <h3 class="disclosure-name"><button class="disclosure-button" type="button" aria-expanded="false" aria-controls="disclosure-panel-${index + 1}" id="disclosure-button-${index + 1}" data-disclosure-button>${escapeXml(disclosure.name)}</button></h3>
          <div class="disclosure-panel" id="disclosure-panel-${index + 1}" role="region" aria-labelledby="disclosure-button-${index + 1}" data-disclosure-panel hidden>${escapeXml(disclosure.text)}${
    index === 2 ? ' <a class="action-link" href="#product" data-chapter-jump="product">See the amounts per stick</a>' : ''
  }</div>
        </div>`,
).join('\n')}
      </div>
      <div class="pathway">
        <label class="pathway-label" for="pathway-slider">Nitrate pathway</label>
        <input class="pathway-slider" id="pathway-slider" type="range" min="1" max="3" step="1" value="1" aria-valuetext="Nitrate" data-pathway-slider>
        <div class="pathway-diagram" data-step="1" data-pathway-diagram role="img" aria-label="Nitrate pathway diagram"></div>
        <p class="pathway-text" data-pathway-text>${escapeXml(NITRATE_STEPS[0]?.text ?? '')}</p>
      </div>
      <p class="notice" data-not-medicine></p>
    </div>
  </div>
</section>

<section class="chapter chapter-product" id="product" role="region" aria-labelledby="product-heading">
  <div class="paper-stage product-stage">
    <div class="stage-inner">
      <h2 class="chapter-heading product-heading" id="product-heading" tabindex="-1" data-chapter-heading data-product-name></h2>
      <p class="lead" data-product-line></p>
      <div class="product-layout">
        <div class="pack-showcase">
          <div class="pack-picture" data-view="front" data-pack-picture></div>
          <fieldset class="pack-view">
            <legend>Pack view</legend>
            <label><input type="radio" name="pack-view" value="front" checked data-view-radio> Front</label>
            <label><input type="radio" name="pack-view" value="side" data-view-radio> Side</label>
            <label><input type="radio" name="pack-view" value="back" data-view-radio> Back</label>
          </fieldset>
        </div>
        <div class="product-information">
          <div class="tablist" role="tablist" aria-label="Product information" data-product-tablist>
            <button class="tab" type="button" role="tab" id="product-tab-1" aria-controls="product-panel-1" aria-selected="true" tabindex="0" data-product-tab="1">Details</button>
            <button class="tab" type="button" role="tab" id="product-tab-2" aria-controls="product-panel-2" aria-selected="false" tabindex="-1" data-product-tab="2">Ingredients</button>
            <button class="tab" type="button" role="tab" id="product-tab-3" aria-controls="product-panel-3" aria-selected="false" tabindex="-1" data-product-tab="3">How to use</button>
          </div>
          <div class="tabpanel product-panel" role="tabpanel" id="product-panel-1" aria-labelledby="product-tab-1" tabindex="0" data-product-panel="1"></div>
          <div class="tabpanel product-panel" role="tabpanel" id="product-panel-2" aria-labelledby="product-tab-2" tabindex="0" data-product-panel="2" hidden></div>
          <div class="tabpanel product-panel" role="tabpanel" id="product-panel-3" aria-labelledby="product-tab-3" tabindex="0" data-product-panel="3" hidden></div>
          <p class="sheet-alert-slot" data-sheet-alert></p>
          <button class="sheet-button" type="button" data-sheet-button>Download product sheet (PDF)</button>
          <p class="edition-line" data-edition-line></p>
          <p><a class="action-link" href="/store">Visit the online store</a></p>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="chapter chapter-interviews" id="interviews" role="region" aria-labelledby="interviews-heading">
  <div class="paper-stage interviews-stage">
    <div class="stage-inner">
      <h2 class="chapter-heading" id="interviews-heading" tabindex="-1" data-chapter-heading>${escapeXml(SITE_COPY.interviews.heading)}</h2>
      <p class="fictional-note">${escapeXml(SITE_COPY.interviews.fictionalNote)}</p>
      <fieldset class="interview-filter">
        <legend>Show interviews</legend>
        <label><input type="radio" name="interview-filter" value="all" checked data-interview-filter> All</label>
        <label><input type="radio" name="interview-filter" value="expert" data-interview-filter> Experts</label>
        <label><input type="radio" name="interview-filter" value="everyday" data-interview-filter> Everyday</label>
      </fieldset>
      <ul class="interview-list" role="list" aria-label="Interviews" data-interview-list></ul>
    </div>
  </div>
</section>

<section class="chapter chapter-lifestyle" id="lifestyle" role="region" aria-labelledby="lifestyle-heading" data-meridian data-mode="on" data-scenario="on-work">
  <div class="meridian-stage" data-meridian-stage>
    <div class="stage-inner">
      <h2 class="chapter-heading" id="lifestyle-heading" tabindex="-1" data-chapter-heading>${escapeXml(SITE_COPY.lifestyle.heading)}</h2>
      <p class="lead">${escapeXml(SITE_COPY.lifestyle.lead)}</p>
      <fieldset class="mode-fieldset">
        <legend>Mode</legend>
        <label><input type="radio" name="meridian-mode" value="on" checked data-mode-radio> ON</label>
        <label><input type="radio" name="meridian-mode" value="off" data-mode-radio> OFF</label>
      </fieldset>
      <div class="moments">
        <fieldset class="moments-fieldset">
          <legend>Moments</legend>
          <div class="stops" data-stops></div>
        </fieldset>
      </div>
      <div class="scenario-panel" data-scenario-panel aria-busy="true">
        <div class="scenario-picture" data-scenario-picture aria-hidden="true"></div>
        <div class="scenario-copy">
          <p class="scenario-time" data-scenario-time></p>
          <h3 class="scenario-title" data-scenario-title></h3>
          <p class="scenario-copy-text" data-scenario-copy></p>
          <p class="scenario-moment"><span class="moment-label">Where it fits</span> <span data-scenario-moment></span></p>
        </div>
      </div>
    </div>
  </div>
</section>
</div>`;
}

export function storePage(): string {
  return `
<article class="page page-store">
  <h1 class="page-heading" id="main-heading" tabindex="-1" data-store-heading>Online store</h1>
  <div class="store-packs" data-store-packs></div>
  <h2>Where to buy</h2>
  <ul class="store-list" data-store-list></ul>
  <p class="edition-line" data-edition-line></p>
</article>`;
}

export function contactPage(): string {
  return `
<article class="page page-info">
  <h1 class="page-heading" id="main-heading" tabindex="-1">${escapeXml(SITE_COPY.contact.heading)}</h1>
  <p>${escapeXml(SITE_COPY.contact.lines[0] ?? '')}</p>
  <p>${escapeXml(SITE_COPY.contact.lines[1] ?? '')}</p>
  <p><a class="action-link" href="mailto:${SITE_COPY.contact.email}">${SITE_COPY.contact.email}</a></p>
</article>`;
}

export function privacyPage(): string {
  return `
<article class="page page-info">
  <h1 class="page-heading" id="main-heading" tabindex="-1">${escapeXml(SITE_COPY.privacy.heading)}</h1>
  <p>${escapeXml(SITE_COPY.privacy.text)}</p>
</article>`;
}

export function legalPage(): string {
  return `
<article class="page page-info">
  <h1 class="page-heading" id="main-heading" tabindex="-1">${escapeXml(SITE_COPY.legal.heading)}</h1>
  <p>${escapeXml(SITE_COPY.legal.text)}</p>
</article>`;
}

export function notFoundPage(): string {
  return `
<article class="page page-info">
  <h1 class="page-heading" id="main-heading" tabindex="-1">This page does not exist.</h1>
  <p><a class="action-link" href="/">Back to the story</a></p>
</article>`;
}

export function interviewPage(): string {
  return `
<article class="page page-interview" data-interview-page>
  <header class="interview-header" data-interview-header>
    <h1 class="page-heading" id="main-heading" tabindex="-1" data-interview-name></h1>
    <p class="interview-role" data-interview-role></p>
    <p class="interview-lede" data-interview-lede></p>
    <div class="interview-portrait" data-interview-portrait aria-hidden="true"></div>
  </header>
  <div class="interview-answers" data-interview-answers></div>
  <p class="fictional-note">${escapeXml(SITE_COPY.interviews.fictionalNote)}</p>
  <nav class="interview-nav" role="navigation" aria-label="Interview pages" data-interview-nav></nav>
  <p><a class="action-link" href="/#interviews" data-chapter-jump="interviews">All interviews</a></p>
</article>`;
}

export function interviewNotFoundPage(): string {
  return `
<article class="page page-info">
  <h1 class="page-heading" id="main-heading" tabindex="-1">This interview does not exist.</h1>
  <p><a class="action-link" href="/#interviews">All interviews</a></p>
</article>`;
}
