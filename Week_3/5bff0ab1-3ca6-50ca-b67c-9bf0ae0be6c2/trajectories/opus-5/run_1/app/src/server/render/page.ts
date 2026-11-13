import {
  CHAPTERS,
  FINISHES,
  HUBS,
  MODELS,
  NEEDLE_MAX_HOURS,
  chapter as chapterDef,
  finish as finishDef,
  hexOfRgb,
  hub as hubDef,
  model as modelDef,
  COLOURS,
  type ChapterId,
  type FinishId,
  type HubId,
  type ModelId,
} from '../../shared/catalogue.js';
import { EASING } from '../../shared/easing.js';
import { formatPaise } from '../../shared/money.js';
import { COPY } from '../../shared/strings.js';
import type { LiveReading, User } from '../../shared/types.js';
import { clusterTime } from '../clock.js';
import { escapeHtml, escapeJson } from './html.js';

export type RouteName = 'long' | 'test-ride' | 'garage' | 'hub' | 'not-found' | 'wrong-role';

export interface PageOptions {
  route: RouteName;
  user: User | null;
  reading: LiveReading;
  selection: { hub: HubId; model: ModelId; finish: FinishId };
  chapter: ChapterId;
  part: string | null;
  progress: number;
  wrongRoleSentence?: string;
}

function needleDeg(hoursLeft: number): number {
  return -135 + (270 * Math.min(hoursLeft, NEEDLE_MAX_HOURS)) / NEEDLE_MAX_HOURS;
}

function tankFill(reading: LiveReading, finish: FinishId): string {
  const soldOut = reading.unitsLeft === 0 && reading.lock === null;
  return soldOut ? hexOfRgb(COLOURS.muted) : hexOfRgb(finishDef(finish).paint);
}

function displayUnits(reading: LiveReading): string {
  return String(Math.min(99, Math.max(0, reading.unitsLeft))).padStart(2, '0');
}

function displayRide(reading: LiveReading): string {
  return reading.nextSlot ? clusterTime(new Date(reading.nextSlot.startsAt)) : '--:--';
}

/** The side elevations carry the keyed-on reading, so they are true with scripts off. */
function elevation(
  chapter: (typeof CHAPTERS)[number],
  reading: LiveReading,
  selection: PageOptions['selection'],
  active: boolean,
): string {
  const fill = tankFill(reading, selection.finish);
  const units = displayUnits(reading);
  const ride = displayRide(reading);
  const lamp = reading.stale;
  const def = modelDef(selection.model);
  const deg = needleDeg(reading.hoursLeft);
  const wheelbase = def.wheelbaseMm === 1440 ? 0 : 10;
  return `<svg class="elevation" role="img" aria-label="Side elevation, ${chapter.name}"
  data-chapter="${chapter.id}" data-needle-deg="${deg}" data-lamp="${lamp}" data-units="${units}"
  data-ride="${ride}" data-tank="${fill}" viewBox="0 0 320 160" ${
    active ? '' : 'hidden'
  } focusable="false">
  <circle cx="${70 - wheelbase / 2}" cy="112" r="34" fill="none" stroke="#9c9ea3" stroke-width="3"/>
  <circle cx="${250 + wheelbase / 2}" cy="116" r="30" fill="none" stroke="#9c9ea3" stroke-width="3"/>
  <path d="M96 108 L150 70 L205 76 L232 110" fill="none" stroke="#eff0f1" stroke-width="4"/>
  <path d="M132 74 q28 -22 56 -4 l4 20 q-30 10 -62 2 z" fill="${fill}"/>
  <rect x="188" y="62" width="46" height="12" fill="#222427"/>
  <rect x="150" y="84" width="40" height="30" fill="#2b2d31"/>
  <rect x="214" y="104" width="${
    def.silencers === 2 ? 56 : 40
  }" height="10" fill="#9c9ea3"/>
  <g transform="translate(118 58)">
    <circle r="16" fill="#18191b" stroke="#9c9ea3" stroke-width="2"/>
    <line x1="0" y1="0" x2="${(12 * Math.sin((deg * Math.PI) / 180)).toFixed(2)}" y2="${(
      -12 * Math.cos((deg * Math.PI) / 180)
    ).toFixed(2)}" stroke="#eff0f1" stroke-width="2"/>
    <circle cx="10" cy="10" r="3" fill="${lamp ? hexOfRgb(COLOURS.accent) : '#2b2d31'}"/>
  </g>
  <text x="150" y="146" fill="#eff0f1" font-size="11" font-family="monospace">UNITS ${units} RIDE ${ride}</text>
</svg>`;
}

function stockSentence(reading: LiveReading, selection: PageOptions['selection']): string {
  const finishName = finishDef(selection.finish).name;
  const hubName = hubDef(selection.hub).name;
  if (reading.unitsLeft === 1) return `1 unit left in ${finishName} at ${hubName}.`;
  return `${reading.unitsLeft} units left in ${finishName} at ${hubName}.`;
}

function header(user: User | null): string {
  const links = [
    `<a href="/showroom">Showroom</a>`,
    `<a href="/test-ride" data-link="test-ride">Test ride</a>`,
    `<a href="/garage">Garage</a>`,
  ];
  const hostLink =
    user?.role === 'hub_host' ? `<a href="/hub" class="host-link">Hub console</a>` : '';
  return `<header class="top">
  <a class="wordmark" href="/">${COPY.wordmark}</a>
  <button type="button" class="menu-button" aria-expanded="false" data-menu>Menu</button>
  <nav class="links" data-links>${links.join('')}${hostLink}</nav>
</header>`;
}

function chapterStatements(current: ChapterId): string {
  return CHAPTERS.map(
    (c) =>
      `<h2 class="statement chapter-statement" data-chapter-statement="${c.id}" ${
        c.id === current ? '' : 'hidden'
      }>${escapeHtml(c.statement)}</h2>`,
  ).join('\n');
}

function toolbar(current: ChapterId): string {
  return `<div role="toolbar" aria-label="Chapters" class="chapters" data-chapters>
  ${CHAPTERS.map(
    (c) =>
      `<button type="button" role="button" data-chapter-button="${c.id}" aria-pressed="${
        c.id === current ? 'true' : 'false'
      }" tabindex="${c.id === current ? '0' : '-1'}">${c.name}</button>`,
  ).join('\n  ')}
</div>`;
}

function partsList(current: ChapterId, part: string | null): string {
  const parts = chapterDef(current).parts;
  return `<div class="parts-panel" data-parts-panel>
  <button type="button" class="parts-open" data-parts-open>Parts</button>
  <div role="listbox" aria-label="Parts" class="parts" data-parts tabindex="0">
    ${parts
      .map(
        (p) =>
          `<div role="option" data-part="${p.id}" aria-selected="${
            p.id === part ? 'true' : 'false'
          }">${p.name}</div>`,
      )
      .join('\n    ')}
  </div>
</div>`;
}

function selectionControls(selection: PageOptions['selection']): string {
  return `<div class="selection">
  <fieldset role="radiogroup" aria-label="Model" class="radios" data-model>
    ${MODELS.map(
      (m) =>
        `<label><input type="radio" name="model" value="${m.id}" ${
          m.id === selection.model ? 'checked' : ''
        }><span>${m.name}</span></label>`,
    ).join('\n    ')}
  </fieldset>
  <label class="hub-label">Hub city
    <select aria-label="Hub city" data-hub>
      ${HUBS.map(
        (h) =>
          `<option value="${h.id}" ${h.id === selection.hub ? 'selected' : ''}>${h.name}</option>`,
      ).join('\n      ')}
    </select>
  </label>
  <fieldset role="radiogroup" aria-label="Finish" class="radios" data-finish>
    ${FINISHES.map(
      (f) =>
        `<label><input type="radio" name="finish" value="${f.id}" ${
          f.id === selection.finish ? 'checked' : ''
        }><span>${f.name}</span></label>`,
    ).join('\n    ')}
  </fieldset>
</div>`;
}

function priceRegion(reading: LiveReading, selection: PageOptions['selection']): string {
  return `<section class="price" role="region" aria-label="On-road price" data-price>
  <p class="numeral" data-ex-showroom>${formatPaise(reading.quote.exShowroomPaise)}</p>
  <p class="sentence">Ex-showroom, before your state takes its share.</p>
  <p class="numeral" data-on-road>${formatPaise(reading.quote.onRoadPaise)}</p>
  <p class="sentence">On the road at ${escapeHtml(
    hubDef(selection.hub).name,
  )} today, tax and insurance counted.</p>
  <p class="as-of" data-as-of hidden></p>
  <p class="stock-line" data-stock-line>${escapeHtml(stockSentence(reading, selection))}</p>
  <p class="stock-as-of" data-stock-as-of ${reading.stale ? '' : 'hidden'}>Stock as of ${escapeHtml(
    reading.stockAsOfLabel,
  )}</p>
  <p class="outage-field" data-hub-outage hidden></p>
  <button type="button" class="primary" data-lock-button aria-disabled="true">Lock this price</button>
</section>`;
}

function longPage(options: PageOptions): string {
  const { reading, selection, chapter, part } = options;
  return `${header(options.user)}
<main class="long" data-route="long">
  <section class="hero" data-hero>
    <div class="hero-word-clip"><span class="hero-word">MALHAR</span></div>
    <p class="hero-sentence">${escapeHtml(COPY.heroSentence)}</p>
    <a class="primary start-build" href="/showroom?at=0.000">${COPY.startBuild}</a>
  </section>
  <section class="stage" data-stage>
    <div class="stage-pin" data-stage-pin>
      <canvas class="scene" data-scene role="img" aria-label="Malhar ${
        modelDef(selection.model).name
      } showroom"></canvas>
      <div class="elevations" data-elevations>
        ${CHAPTERS.map((c) => elevation(c, reading, selection, c.id === chapter)).join('\n        ')}
      </div>
      ${chapterStatements(chapter)}
      ${toolbar(chapter)}
      ${partsList(chapter, part)}
      ${selectionControls(selection)}
    </div>
  </section>
  ${priceRegion(reading, selection)}
  <section class="ride-invite">
    <h2 class="statement">${escapeHtml(COPY.rideInvitation)}</h2>
    <a href="/test-ride?hub=${selection.hub}&amp;model=${selection.model}" data-link="test-ride">Book a test ride</a>
  </section>
  <footer class="footer"><span>MALHAR</span></footer>
</main>`;
}

function workingShell(
  route: 'test-ride' | 'garage' | 'hub',
  options: PageOptions,
): string {
  if (route === 'test-ride') {
    return `${header(options.user)}
<main class="working" data-route="test-ride">
  <h1 class="statement" data-statement>${escapeHtml(COPY.testRideStatement)}</h1>
  <div class="working-body" data-test-ride></div>
</main>`;
  }
  if (route === 'garage') {
    return `${header(options.user)}
<main class="working" data-route="garage">
  <h1 class="statement" data-statement>Your machine, held.</h1>
  <div class="bands" data-garage></div>
</main>`;
  }
  return `${header(options.user)}
<main class="working" data-route="hub">
  <h1 class="statement" data-statement>Your hub, today.</h1>
  <div class="console" data-hub-console></div>
</main>`;
}

function notFound(options: PageOptions): string {
  return `${header(options.user)}
<main class="working" data-route="not-found">
  <h1 class="statement">${escapeHtml(COPY.notFound)}</h1>
  <a href="/showroom">${COPY.backToShowroom}</a>
</main>`;
}

function wrongRole(options: PageOptions): string {
  return `${header(options.user)}
<main class="working" data-route="wrong-role">
  <h1 class="statement">${escapeHtml(options.wrongRoleSentence ?? '')}</h1>
  <a href="/showroom">${COPY.backToShowroom}</a>
</main>`;
}

export function renderPage(options: PageOptions): string {
  const body =
    options.route === 'long'
      ? longPage(options)
      : options.route === 'not-found'
        ? notFound(options)
        : options.route === 'wrong-role'
          ? wrongRole(options)
          : workingShell(options.route, options);
  const bootstrap = {
    route: options.route,
    user: options.user,
    reading: options.reading,
    selection: options.selection,
    chapter: options.chapter,
    part: options.part,
    progress: options.progress,
  };
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Malhar Key-On</title>
<style>:root { --easing: ${EASING}; }</style>
<link rel="stylesheet" href="/assets/app.css">
<link rel="preload" href="/fonts/gloock-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/rethink-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/json" id="bootstrap">${escapeJson(bootstrap)}</script>
<script src="/assets/app.js" defer></script>
</head>
<body>
<div class="top-bar"></div>
${body}
<div class="status-region" role="status" aria-live="polite" aria-label="Showroom status" data-status></div>
<div class="dialog-layer" data-dialogs></div>
</body>
</html>`;
}
