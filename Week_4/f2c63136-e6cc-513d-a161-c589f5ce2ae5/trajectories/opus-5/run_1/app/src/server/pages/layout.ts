import { config } from '../config.js';
import type { UserRow } from '../../domain/model.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attr(value: string): string {
  return escapeHtml(value);
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.workspaceTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

/** Workspace-zone time, as `<YYYY-MM-DD> <HH:mm:ss> <zone>`. */
export function workspaceTime(date: Date): string {
  const parts = TIME_FORMAT.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}:${pick('second')} ${pick(
    'timeZoneName',
  )}`;
}

export function timeElement(date: Date): string {
  return `<time datetime="${attr(`${date.toISOString().slice(0, 19)}Z`)}">${escapeHtml(workspaceTime(date))}</time>`;
}

export interface PageOptions {
  title: string;
  user: UserRow | null;
  announcement?: string | null;
  bodyClass?: string;
  serviceStatusOk?: boolean;
  statusRegions?: boolean;
}

function navPill(user: UserRow | null): string {
  const links = user
    ? `<a href="/inbox">Inbox</a><a href="/repos">Repositories</a><button type="button" class="flat" data-action="logout">Log out</button>`
    : `<a href="/login">Log in</a><a href="/signup">Sign up</a>`;
  return `<nav class="navpill" aria-label="Workspace"><a class="wordmark" href="/">Ridgestack</a><div class="navlinks">${links}</div></nav>`;
}

export function footer(serviceStatusOk: boolean): string {
  return `<footer class="sitefooter">
  <div class="footcols">
    <div><p class="footlogo">Ridgestack</p><p class="muted">Stacked review for teams that ship in small steps.</p></div>
    <div><h3>Product</h3><ul><li><a href="/">Why stacks</a></li><li><a href="/#push-api">The push route <span class="badge">NEW</span></a></li><li><a href="/">Checks and runners</a></li></ul></div>
    <div><h3>Review</h3><ul><li><a href="/">Line comments <span class="badge">2</span></a></li><li><a href="/">Approval carry-over</a></li><li><a href="/">The merge box</a></li></ul></div>
    <div><h3>Workspace</h3><ul><li><a href="/">Roles and teams</a></li><li><a href="/">Repository tokens</a></li><li><a href="/">Uptime</a></li></ul></div>
  </div>
  <hr />
  <p class="statusrow"><span class="dot" aria-hidden="true"></span><span role="status" aria-label="Service status">${
    serviceStatusOk ? 'All services are running' : 'Some services are unavailable'
  }</span></p>
  <p class="copyright muted">Ridgestack, an invented workspace for stacked review.</p>
  <p class="neonmark"><img src="/assets/wordmark.svg" alt="Ridgestack neon wordmark" width="1100" height="180" /></p>
</footer>`;
}

export function page(options: PageOptions, main: string): string {
  const announcement =
    options.announcement && options.announcement !== ''
      ? `<div class="announcement" role="alert" aria-label="Announcement">${escapeHtml(options.announcement)}</div>`
      : '';
  const statusRegions =
    options.statusRegions === false
      ? ''
      : `<div class="statusregions"><div id="review-updates" class="reviewupdates" role="status" aria-label="Review updates"></div><div id="action-status" class="actionstatus" role="status" aria-label="Action status"></div></div>`;
  return `<!doctype html>
<html lang="en" data-diff-breakpoint="${config.diffBreakpointPx}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)} — Ridgestack</title>
<link rel="stylesheet" href="/assets/app.css" />
</head>
<body class="${attr(options.bodyClass ?? '')}">
${announcement}
${navPill(options.user)}
<main class="column">
${main}
</main>
${statusRegions}
${footer(options.serviceStatusOk !== false)}
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}

export function statusBar(word: string): string {
  const kind = word.toLowerCase();
  return `<span class="statusbar statusbar-${attr(kind)}"><span class="statusicon" aria-hidden="true"></span><span class="statusword">${escapeHtml(
    word,
  )}</span></span>`;
}

export const STATE_WORDS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  queued: 'Queued',
  merged: 'Merged',
  removed: 'Removed',
};
