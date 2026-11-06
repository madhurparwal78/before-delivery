import { queryOne } from '../db/pool.ts';
import { isPublicStatus, publicStatusOf } from '../../domain/dropstate.ts';
import { MARKETS, marketCity, type Market } from '../../domain/markets.ts';
import { DEAD_LINK_COPY, previewLinkState } from '../../domain/previewstate.ts';
import {
  copenhagenToday,
  formatCopenhagenDate,
  formatInstant,
  formatMarketTime,
  isoWeekOfDate,
  isoWeekOfInstant,
  parseDate,
  weekLabel,
  weekValue,
} from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { loadDrops, earliestInstant, type DropRecord } from '../repo/drops.ts';
import { loadLooks } from '../api/publicdrops.ts';
import { button, field, link, pageData, panel, stickyBar, table } from './components.ts';
import { attrs, html, raw, type RawHtml } from './html.ts';
import { page, problemsRegion, statusMark, statusRegion } from './layout.ts';

const MARKET_OPTIONS = [
  { value: '', label: 'All markets' },
  ...MARKETS.map((market) => ({ value: market, label: marketCity(market) })),
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'live', label: 'Live' },
  { value: 'sold_out', label: 'Sold out' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'simultaneous', label: 'Simultaneous' },
  { value: 'rolling', label: 'Rolling' },
];

const SORT_OPTIONS = [
  { value: 'soonest', label: 'Soonest first' },
  { value: 'latest', label: 'Latest first' },
  { value: 'name', label: 'Name A–Z' },
];

async function brandOf(workspaceId: string): Promise<string> {
  const row = await queryOne<{ name: string }>('select name from workspaces where id = $1', [
    workspaceId,
  ]);
  return row?.name ?? '';
}

function filterControls(): RawHtml {
  return html`${field({ name: 'market', label: 'Market', kind: 'select', options: MARKET_OPTIONS })}
${field({ name: 'status', label: 'Status', kind: 'select', options: STATUS_OPTIONS })}
${field({ name: 'type', label: 'Type', kind: 'select', options: TYPE_OPTIONS })}
${field({ name: 'week', label: 'Week', kind: 'select', options: [{ value: '', label: 'All weeks' }] })}
${field({ name: 'sort', label: 'Sort', kind: 'select', options: SORT_OPTIONS, value: 'soonest' })}`;
}

export async function calendarPage(ctx: Ctx): Promise<string> {
  const drops = (await loadDrops('1 = 1', [], ctx.nowMs)).filter((drop) =>
    isPublicStatus(drop.status),
  );
  const weeks = new Map<string, string>();
  for (const drop of drops) {
    const instant = earliestInstant(drop);
    if (instant === null) continue;
    const week = isoWeekOfInstant(instant);
    weeks.set(weekValue(week), weekLabel(week));
  }
  const today = copenhagenToday(ctx.nowMs);
  const todayWall = parseDate(today);
  const currentWeek =
    todayWall === null ? '' : weekValue(isoWeekOfDate(todayWall.year, todayWall.month, todayWall.day));

  const main = html`<div class="intro-band">
  <p class="intro-band__tagline" data-intro-roll>
    <span>One drop.</span>
    <span class="intro-band__city" data-intro-city>Copenhagen time.</span>
    <span>Every market.</span>
  </p>
  <p class="intro-band__spoken" data-intro-spoken>One drop. Copenhagen time. Every market.</p>
</div>
<h1 class="page-heading">Drop calendar</h1>
<p class="calendar__today mono">Today in Copenhagen: ${formatCopenhagenDate(today)}</p>
<form class="calendar__filters" data-calendar-filters>
  ${problemsRegion()}
  ${field({ name: 'q', label: 'Search drops', kind: 'text', placeholder: 'Search drops' })}
  <div class="calendar__filter-grid" data-filter-host>${filterControls()}</div>
  ${button('Filters', { variant: 'quiet', action: 'open-filters' })}
</form>
${statusRegion('Calendar results')}
<ul class="drop-weeks" aria-label="Drops" data-drop-list></ul>
<nav class="pager" aria-label="Pages" data-pager>
  <a class="link" href="?page=1" data-pager-previous>Previous page</a>
  <span class="pager__count mono" data-pager-count>Page 1 / 1</span>
  <a class="link" href="?page=1" data-pager-next>Next page</a>
</nav>
<dialog class="dialog dialog--sheet" aria-label="Filters" data-dialog="Filters">
  <form class="dialog__form" method="dialog" data-dialog-form="Filters">
    <h2 class="dialog__heading">Filters</h2>
    <p class="dialog__alert" role="alert" tabindex="-1" data-dialog-alert hidden></p>
    <div class="dialog__body" data-sheet-host></div>
    <div class="dialog__actions sticky-bar">
      <button type="button" class="button button--primary" data-action="apply-filters">Show 0 drops</button>
    </div>
  </form>
</dialog>
${pageData({
  screen: 'calendar',
  weeks: [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([value, label]) => ({ value, label })),
  currentWeek,
  today,
})}`;

  return page({ title: 'Drop calendar' }, main);
}

export async function dropPage(ctx: Ctx, drop: DropRecord): Promise<string> {
  const brand = await brandOf(drop.workspaceId);
  const story = await queryOne<{ published_html: string | null }>(
    'select published_html from stories where drop_id = $1',
    [drop.id],
  );
  const looks = await loadLooks(drop.id);
  const liveMarkets = drop.markets.filter(
    (market) => market.status === 'live' && market.piecesLeft > 0,
  );
  const defaultMarket = liveMarkets[0]?.market ?? drop.markets[0]?.market ?? 'copenhagen';

  const main = html`<section class="night-band">
  <h1 class="page-heading page-heading--drop">${drop.name}</h1>
  <p class="night-band__brand">${brand}</p>
  <p class="night-band__status">${statusMark(publicStatusOf(drop.status))}</p>
  ${table({
    name: 'Market availability',
    columns: ['Market', 'Opens', 'Status', 'Pieces left'],
    className: 'table-wrap--night',
    bodyAttributes: { 'data-availability': 'rows' },
    rows: drop.markets.map(
      (market) => html`<tr data-market-row="${market.market}">
      <td>${market.city}</td>
      <td class="mono">${market.goLiveAtMs === null ? '—' : formatMarketTime(market.goLiveAtMs, market.market)}</td>
      <td>${statusMark(market.status)}</td>
      <td class="mono" data-pieces-left>${market.piecesLeft}</td>
    </tr>`,
    ),
  })}
</section>
<section class="carousel" role="region" aria-label="Look carousel" data-carousel>
  <div class="carousel__track" data-carousel-track>
    ${looks.map(
      (look, index) => html`<figure class="carousel__item"${attrs({ 'data-carousel-item': index })}>
      <img${attrs({
        src: `/api/public/drops/${drop.slug}/looks/${look.id}/image`,
        alt: look.alt_text,
        width: look.width,
        height: look.height,
        loading: index === 0 ? 'eager' : 'lazy',
      })}>
      <figcaption>${look.title}</figcaption>
    </figure>`,
    )}
  </div>
  <div class="carousel__controls">
    ${button('Previous look', { variant: 'quiet', action: 'carousel-previous' })}
    <p class="status-region mono" role="status" aria-live="polite" aria-label="Look position" data-status-region="Look position">${looks.length === 0 ? '0 / 0' : `1 / ${looks.length}`}</p>
    ${button('Next look', { variant: 'quiet', action: 'carousel-next' })}
  </div>
</section>
<article class="story" aria-label="Story" data-story>${raw(story?.published_html ?? '')}</article>
${
  liveMarkets.length === 0
    ? raw('')
    : html`<form class="form" aria-label="Claim a piece" data-form="claim-open">
  <h2 class="panel__heading">Claim a piece</h2>
  ${problemsRegion()}
  ${field({
    name: 'market',
    label: 'Market',
    kind: 'select',
    value: defaultMarket,
    options: liveMarkets.map((market) => ({ value: market.market, label: market.city })),
  })}
  ${field({ name: 'name', label: 'Name', autocomplete: 'name' })}
  ${field({ name: 'email', label: 'Email', kind: 'email', autocomplete: 'email' })}
  ${button('Claim a piece', { pending: 'Claiming…' })}
  ${statusRegion('Claim status')}
</form>`
}
<form class="form" aria-label="Join the waitlist" data-form="waitlist">
  <h2 class="panel__heading">Join the waitlist</h2>
  ${problemsRegion()}
  ${field({ name: 'name', label: 'Name', autocomplete: 'name' })}
  ${field({ name: 'email', label: 'Email', kind: 'email', autocomplete: 'email' })}
  ${field({
    name: 'market',
    label: 'Market',
    kind: 'select',
    value: 'copenhagen',
    options: MARKETS.map((market) => ({ value: market, label: marketCity(market) })),
  })}
  ${field({ name: 'consent', label: 'I agree to receive drop emails', kind: 'checkbox' })}
  ${statusRegion('Waitlist status')}
  <div class="form__actions form__actions--desktop">${button('Join waitlist', { pending: 'Joining…' })}</div>
</form>
${stickyBar(button('Join waitlist', { pending: 'Joining…', action: 'join-waitlist' }))}
${pageData({ screen: 'drop', slug: drop.slug, looks: looks.length })}`;

  return page({ title: drop.name, night: true }, main);
}

export function withdrawnDropPage(): string {
  return page(
    { title: 'This drop was withdrawn' },
    html`<h1 class="page-heading">This drop was withdrawn</h1>
<p class="lead">${statusMark('withdrawn')}</p>
<p>${link('Back to the drop calendar', '/')}</p>`,
  );
}

export function notFoundPage(): string {
  return page(
    { title: 'Page not found' },
    html`<h1 class="page-heading">Page not found</h1>
<p>${link('Back to the drop calendar', '/')}</p>`,
  );
}

interface HoldPageData {
  token: string;
  dropName: string;
  city: string;
  market: Market;
  status: string;
  expiresAtMs: number;
}

export function claimPage(data: HoldPageData): string {
  const main = html`<h1 class="page-heading">Your held piece</h1>
<p class="lead">${data.dropName} · ${data.city}</p>
<p class="countdown mono" role="timer" aria-label="Hold ends in" data-countdown="hold" data-deadline="${formatInstant(data.expiresAtMs)}">00:00:00</p>
${statusRegion('Claim status')}
${stickyBar(button('Claim piece', { pending: 'Claiming…', action: 'claim-hold' }))}
${pageData({
  screen: 'claim',
  token: data.token,
  dropName: data.dropName,
  city: data.city,
  market: data.market,
  status: data.status,
  expiresAt: formatInstant(data.expiresAtMs),
})}`;
  return page({ title: 'Your held piece' }, main);
}

export function optInPage(token: string): string {
  const main = html`<h1 class="page-heading">Waitlist confirmation</h1>
<p class="lead" data-optin-summary></p>
${button('Confirm my place', { pending: 'Confirming…', action: 'confirm-optin' })}
${statusRegion('Waitlist status')}
${pageData({ screen: 'optin', token })}`;
  return page({ title: 'Waitlist confirmation' }, main);
}

export interface PressPageModel {
  token: string;
  brand: string;
  dropName: string;
  embargoLine: string;
  markets: { city: string; opens: string }[];
  storyHtml: string;
  looks: { id: string; title: string; altText: string; position: number; width: number; height: number }[];
}

export function pressPage(model: PressPageModel): string {
  const main = html`<h1 class="page-heading">Press preview: ${model.dropName}</h1>
<p class="lead">${model.brand}</p>
<p class="press__embargo mono">${model.embargoLine}</p>
${table({
  name: 'Market opening times',
  columns: ['Market', 'Opens'],
  rows: model.markets.map(
    (market) => html`<tr><td>${market.city}</td><td class="mono">${market.opens}</td></tr>`,
  ),
})}
<article class="story" aria-label="Story">${raw(model.storyHtml)}</article>
<ul class="looks-list" aria-label="Looks">
  ${model.looks.map(
    (look) => html`<li class="looks-list__item">
    <img${attrs({
      src: `/api/press/${model.token}/looks/${look.id}/image`,
      alt: look.altText,
      width: look.width,
      height: look.height,
      loading: 'lazy',
    })}>
    <p>${look.title}</p>
    <p class="mono">${look.position} / ${model.looks.length}</p>
  </li>`,
  )}
</ul>
${statusRegion('Download status')}
${stickyBar(button('Download images', { pending: 'Preparing download…', action: 'download-press' }))}
${pageData({ screen: 'press', token: model.token })}`;
  return page({ title: `Press preview: ${model.dropName}` }, main);
}

export function deadPreviewPage(state: Exclude<ReturnType<typeof previewLinkState>, 'active'>): string {
  return page(
    { title: 'This preview is no longer available' },
    html`<h1 class="page-heading">This preview is no longer available</h1>
<p class="lead" data-dead-link-copy>${DEAD_LINK_COPY[state]}</p>
<p>${link('Back to the drop calendar', '/')}</p>`,
  );
}
