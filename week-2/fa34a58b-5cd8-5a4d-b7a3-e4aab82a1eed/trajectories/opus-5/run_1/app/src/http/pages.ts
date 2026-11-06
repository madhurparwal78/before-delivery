import { abbrAt, formatHhMm } from '../domain/time';
import { hubNow } from '../services/hubClock';
import { dimensionTicks, measuredLength, PLAN_VIEWBOX, ROOM_SHAPES } from '../shared/floorplan';
import { icon } from '../web/icons';

export type PageName = 'plan' | 'schedules' | 'scenes' | 'guests' | 'log' | 'notices';

export const PAGE_ROUTES: Record<string, PageName> = {
  '/plan': 'plan',
  '/schedules': 'schedules',
  '/scenes': 'scenes',
  '/guests': 'guests',
  '/log': 'log',
  '/notices': 'notices',
};

const PAGE_TITLES: Record<PageName, string> = {
  plan: 'Plan',
  schedules: 'Schedules',
  scenes: 'Scenes',
  guests: 'Guests',
  log: 'Day log',
  notices: 'Notices',
};

const NAV_LINKS: { href: string; label: string; iconName: Parameters<typeof icon>[0] }[] = [
  { href: '/plan', label: 'Plan', iconName: 'map' },
  { href: '/schedules', label: 'Schedules', iconName: 'calendar' },
  { href: '/scenes', label: 'Scenes', iconName: 'lamp' },
  { href: '/guests', label: 'Guests', iconName: 'users' },
  { href: '/log', label: 'Day log', iconName: 'list' },
  { href: '/notices', label: 'Notices', iconName: 'bell' },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function floorPlanSvg(): string {
  const shapes = ROOM_SHAPES.map((shape) => {
    const widthLabel = measuredLength(shape.width);
    const heightLabel = measuredLength(shape.height);
    return `<g class="room" role="img" aria-label="${escapeHtml(shape.name)}: Unplanned" data-room="${shape.roomId}" data-room-name="${escapeHtml(shape.name)}">
      <rect class="room-fill" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"></rect>
      <rect class="room-outline" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"></rect>
      <path class="room-ticks" d="${dimensionTicks(shape)}"></path>
      <text class="room-dim" x="${shape.x + shape.width / 2}" y="${shape.y + 24}" text-anchor="middle">${widthLabel}</text>
      <text class="room-dim" x="${shape.x + 20}" y="${shape.y + shape.height / 2}" transform="rotate(-90 ${shape.x + 20} ${shape.y + shape.height / 2})" text-anchor="middle">${heightLabel}</text>
      <text class="room-label" x="${shape.x + shape.width / 2}" y="${shape.y + shape.height / 2 + 9}" text-anchor="middle">${escapeHtml(shape.name)}</text>
    </g>`;
  }).join('');
  return `<svg class="floorplan" role="presentation" viewBox="0 0 ${PLAN_VIEWBOX.width} ${PLAN_VIEWBOX.height}" preserveAspectRatio="xMidYMid meet">${shapes}</svg>`;
}

function planBody(): string {
  return `
<section class="panel plan-panel" aria-label="Floor plan">
  <h1 class="page-heading">Plan</h1>
  ${floorPlanSvg()}
  <ul class="legend" aria-label="Scene legend" data-legend></ul>
</section>

<section class="panel scrub-panel" aria-label="Day and time">
  <p class="day-line" data-day-line>&nbsp;</p>
  <div class="day-controls">
    <button type="button" class="control icon-button" data-prev-day aria-label="Previous day">${icon('chevron-left')}<span class="label-text">Previous day</span></button>
    <span class="field inline-field">
      <label class="field-label" for="plan-day">Plan day</label>
      <input class="control input num" type="date" id="plan-day" data-plan-day>
    </span>
    <button type="button" class="control icon-button" data-next-day aria-label="Next day">${icon('chevron-right')}<span class="label-text">Next day</span></button>
    <button type="button" class="control" data-jump-now>${icon('crosshair')}<span>Jump to now</span></button>
  </div>
  <div class="scrubber">
    <div class="scrub-track" data-track>
      <div class="scrub-ticks" data-ticks aria-hidden="true"></div>
      <div class="scrub-fill" data-scrub-fill></div>
      <div class="now-marker num" data-now-marker hidden></div>
      <div class="scrub-thumb" data-thumb></div>
      <div class="scrub-input" role="slider" tabindex="0" aria-label="Time of day"
           aria-valuemin="0" aria-valuemax="1440" aria-valuenow="0" aria-valuetext="00:00 CST" data-slider></div>
    </div>
  </div>
  <p class="sr-only" role="status" aria-live="polite" aria-label="Plan time" data-region="plan-time"></p>
</section>

<div class="plan-lists">
  <section class="panel" aria-labelledby="at-this-time-heading">
    <h2 class="panel-heading" id="at-this-time-heading">At this time</h2>
    <ul class="at-this-time" aria-label="At this time" data-at-this-time></ul>
  </section>
  <section class="panel" aria-labelledby="rooms-heading">
    <h2 class="panel-heading" id="rooms-heading">Rooms</h2>
    <ul class="room-list" aria-label="Rooms" data-room-list></ul>
  </section>
</div>`;
}

function schedulesBody(): string {
  return `
<section class="panel">
  <h1 class="page-heading">Schedules</h1>
  <div class="tablist" role="tablist" aria-label="Schedules" data-schedule-tabs></div>
  <div data-schedule-panels></div>
</section>`;
}

function scenesBody(): string {
  return `
<section class="panel">
  <h1 class="page-heading">Scenes</h1>
  <button type="button" class="control" data-new-scene>${icon('plus')}<span>New scene</span></button>
  <ul class="scene-list" aria-label="Scenes" data-scene-list></ul>
</section>`;
}

function guestsBody(): string {
  return `
<section class="panel">
  <h1 class="page-heading">Guests</h1>
  <button type="button" class="control" data-new-guest>${icon('plus')}<span>New guest scene</span></button>
  <p class="status-line" role="status" aria-live="polite" aria-label="Guest scene" data-region="guest-scene"></p>
  <ul class="guest-list" aria-label="Guest scenes" data-guest-list></ul>
</section>`;
}

function logBody(): string {
  return `
<section class="panel">
  <h1 class="page-heading">Day log</h1>
  <div class="day-controls">
    <button type="button" class="control icon-button" data-prev-log-day aria-label="Previous day">${icon('chevron-left')}<span class="label-text">Previous day</span></button>
    <span class="field inline-field">
      <label class="field-label" for="log-day">Log day</label>
      <input class="control input num" type="date" id="log-day" data-log-day>
    </span>
    <button type="button" class="control icon-button" data-next-log-day aria-label="Next day">${icon('chevron-right')}<span class="label-text">Next day</span></button>
  </div>
  <h2 class="panel-heading" data-log-heading>&nbsp;</h2>
</section>
<section class="panel">
  <h2 class="panel-heading" id="runs-heading">Runs</h2>
  <ul class="runs-list" aria-label="Runs" data-runs-list></ul>
</section>
<section class="panel">
  <h2 class="panel-heading" id="clips-heading">Clips</h2>
  <ul class="clips-list" aria-label="Clips" data-clips-list></ul>
</section>`;
}

function noticesBody(): string {
  return `
<section class="panel">
  <h1 class="page-heading">Notices</h1>
  <p class="status-line" role="status" aria-live="polite" aria-label="Mail" data-region="mail"></p>
  <ul class="notice-list" aria-label="Notices" data-notice-list></ul>
</section>`;
}

const BODIES: Record<PageName, () => string> = {
  plan: planBody,
  schedules: schedulesBody,
  scenes: scenesBody,
  guests: guestsBody,
  log: logBody,
  notices: noticesBody,
};

export function renderPage(page: PageName): string {
  const now = hubNow();
  const currentHref = `/${page}`;
  const nav = NAV_LINKS.map((link) => {
    const current = link.href === currentHref;
    return (
      `<li><a class="nav-link${current ? ' current' : ''}" href="${link.href}"` +
      `${current ? ' aria-current="page"' : ''}>${icon(link.iconName)}<span>${link.label}</span></a></li>`
    );
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PAGE_TITLES[page]} · Gablework Nightplan</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/space-grotesk-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/jetbrains-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<script src="/app.js" defer></script>
</head>
<body class="page-${page}" data-page="${page}">
<div class="shell">
  <header class="header">
    <button type="button" class="control icon-button menu-button" data-menu-button>${icon('menu')}<span class="label-text">Menu</span></button>
    <p class="hub-time">Hub time <span class="num" data-hub-time>${formatHhMm(now)}</span> <span data-hub-abbr>${abbrAt(now)}</span></p>
  </header>

  <div class="rail" data-rail>
    <p class="brand">Gablework Nightplan</p>
    <nav aria-label="Nightplan"><ul class="nav-list">${nav}</ul></nav>
    <button type="button" class="control icon-button rail-close" data-rail-close>${icon('x')}<span class="label-text">Close</span></button>
  </div>

  <main class="main">
    <div class="banner-slot" data-banner-slot></div>
    ${(BODIES[page] as () => string)()}
  </main>

  ${
    page === 'plan'
      ? `<aside class="inspector" aria-label="Room inspector" data-inspector>
    <div class="inspector-body" data-inspector-body></div>
  </aside>`
      : ''
  }
</div>

<div class="sheet-root" data-sheet-root></div>
<div class="backdrop" data-backdrop hidden></div>

<p class="sr-only" role="status" aria-live="polite" aria-label="Device updates" data-region="device-updates"></p>
<p class="sr-only" role="status" aria-live="polite" aria-label="Scene changes" data-region="scene-changes"></p>
<p class="sr-only" role="status" aria-live="polite" aria-label="Connection" data-region="connection"></p>
</body>
</html>`;
}
