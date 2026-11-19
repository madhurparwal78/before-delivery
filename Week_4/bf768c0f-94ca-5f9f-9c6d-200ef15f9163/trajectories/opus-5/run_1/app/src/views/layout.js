/**
 * The club's chrome: the document, the rail, the public top bar and the
 * original line-drawn icon set.
 */

import { avatarUrl } from '../members.js';
import { ratingDisplay } from '../ratings.js';

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** Original line drawings on a twenty-four unit grid, in the current colour. */
const ICONS = {
  pawn: '<circle cx="12" cy="6.5" r="3.2"/><path d="M9 10h6l-1.4 4.5h-3.2z"/><path d="M6.5 20c0-2.4 2.5-3.4 5.5-3.4s5.5 1 5.5 3.4z"/>',
  knight: '<path d="M7 20c0-4 1.5-6 4.5-8L10 9l-2 1.5L6.5 8 10 4.5l1.5 1.2L13 4c3.5.8 5 4 5 8 0 3.4-.6 6-1 8z"/><circle cx="11.2" cy="7.4" r=".7"/>',
  bishop: '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2c3 2 4.4 4.4 4.4 6.6 0 2-1.9 3.4-4.4 3.4s-4.4-1.4-4.4-3.4c0-2.2 1.4-4.6 4.4-6.6z"/><path d="M10 11.5h4"/><path d="M7 20c0-1.6 2.2-2.4 5-2.4s5 .8 5 2.4z"/>',
  rook: '<path d="M6 4h3v2h2V4h2v2h2V4h3v4l-1.6 1.6v5L18 16v4H6v-4l1.6-1.4v-5L6 8z"/>',
  queen: '<path d="M4 7l2.4 3.2L8.6 5l3.4 4.6L15.4 5l2.2 5.2L20 7l-2 9H6z"/><path d="M6 17.2h12V20H6z"/><circle cx="4" cy="5.4" r="1.2"/><circle cx="20" cy="5.4" r="1.2"/><circle cx="12" cy="3.4" r="1.2"/>',
  king: '<path d="M11 2h2v2.4h2.4v2H13V9h-2V6.4H8.6v-2H11z"/><path d="M5.6 10h12.8l-1.2 6H6.8z"/><path d="M6 17h12v3H6z"/>',
  challenge: '<path d="M4 4l9 9"/><path d="M20 4l-9 9"/><path d="M4 20l5-5"/><path d="M20 20l-5-5"/><circle cx="12" cy="12" r="1.6"/>',
  chat: '<path d="M4 5h16v10H9l-5 4z"/>',
  bell: '<path d="M12 3a5 5 0 0 1 5 5v4l2 3H5l2-3V8a5 5 0 0 1 5-5z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>',
  person: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-4 3.4-6 7-6s7 2 7 6"/>',
  group: '<circle cx="9" cy="8.5" r="3"/><circle cx="17" cy="9.5" r="2.4"/><path d="M3 19c0-3.4 2.8-5.2 6-5.2s6 1.8 6 5.2"/><path d="M15.4 13.9c2.8.2 5.1 1.8 5.1 5.1"/>',
  ladder: '<path d="M7 3v18"/><path d="M17 3v18"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h10"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  grid: '<path d="M4 4h16v16H4z"/><path d="M10 4v16"/><path d="M16 4v16"/><path d="M4 10h16"/><path d="M4 16h16"/>',
  keyboard: '<path d="M3 7h18v10H3z"/><path d="M6.5 10.5h.01"/><path d="M10 10.5h.01"/><path d="M13.5 10.5h.01"/><path d="M17 10.5h.01"/><path d="M7.5 14h9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/>',
  speaker: '<path d="M4 9h3l4-3v12l-4-3H4z"/><path d="M14.5 8.5a5 5 0 0 1 0 7"/><path d="M17 6a8.5 8.5 0 0 1 0 12"/>',
  'speaker-off': '<path d="M4 9h3l4-3v12l-4-3H4z"/><path d="M15 9.5l5 5"/><path d="M20 9.5l-5 5"/>',
  flag: '<path d="M6 3v18"/><path d="M6 4h11l-2 4 2 4H6z"/>',
  equals: '<path d="M4 9h16"/><path d="M4 15h16"/>',
  takeback: '<path d="M4 10h9a5 5 0 1 1 0 10H8"/><path d="M8 6l-4 4 4 4"/>',
  download: '<path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  upload: '<path d="M12 20V10"/><path d="M8 13l4-4 4 4"/><path d="M5 5h14"/>',
  play: '<path d="M7 4l12 8-12 8z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L21 21"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  logo: '<path d="M12 2.5l2.4 4.3 4.8.8-3.4 3.5.7 4.9L12 13.8l-4.5 2.2.7-4.9L4.8 7.6l4.8-.8z"/><path d="M6 20.5h12"/>',
};

export function icon(name, { filled = false, className = '' } = {}) {
  const body = ICONS[name] || ICONS.logo;
  const style = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="icon ${className}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" ${style}>${body}</svg>`;
}

const PIECE_ICON_FILLED = new Set(['pawn', 'rook', 'queen', 'king', 'knight', 'bishop']);

export function pieceIcon(name) {
  return icon(name, { filled: PIECE_ICON_FILLED.has(name) });
}

const RAIL = [
  { href: '/play', label: 'Play', iconName: 'play' },
  { href: '/challenges', label: 'Challenges', iconName: 'challenge' },
  { href: '/clubs', label: 'Clubs', iconName: 'shield' },
  { href: '/members', label: 'Members', iconName: 'group' },
  { href: '/leaderboard', label: 'Leaderboard', iconName: 'ladder' },
  { href: '/notifications', label: 'Notifications', iconName: 'bell' },
];

function rail(member, active, unread) {
  const items = RAIL.map((item) => {
    const current = active === item.href;
    const badge = item.href === '/notifications'
      ? `<span class="rail-badge" data-unread-badge hidden>0</span>`
      : '';
    return `<li><a class="rail-link${current ? ' is-current' : ''}" href="${item.href}"${current ? ' aria-current="page"' : ''}>
      ${icon(item.iconName, { filled: item.iconName === 'play' })}<span>${escapeHtml(item.label)}</span>${badge}
    </a></li>`;
  }).join('');

  return `<nav class="rail" id="rail" aria-label="Club">
    <a class="rail-mark" href="/hall">${icon('logo', { filled: true })}<span>Gambit Hall</span></a>
    <ul class="rail-list">${items}</ul>
    <form class="rail-search" role="search" action="/members" method="get">
      <label class="visually-hidden" for="rail-search-input">Search members</label>
      <span class="rail-search-icon">${icon('search')}</span>
      <input id="rail-search-input" type="search" name="q" placeholder="Search members" autocomplete="off">
    </form>
    <div class="rail-account">
      <a class="rail-me" href="/members/${encodeURIComponent(member.username)}">
        <img src="${escapeAttr(avatarUrl(member))}" width="40" height="40" alt="">
        <span class="rail-me-text">
          <strong class="me-name">${escapeHtml(member.username)}</strong>
          <span class="me-rating">${escapeHtml(ratingDisplay(member.rating, member.rated_games))}</span>
        </span>
      </a>
      <div class="rail-menu">
        <button type="button" class="icon-button" id="account-menu-button" aria-expanded="false" aria-controls="account-menu" aria-label="Account menu">${icon('menu')}</button>
        <div class="menu-sheet" id="account-menu" hidden>
          <a href="/settings">${icon('gear')}<span>Settings</span></a>
          <button type="button" data-sign-out>${icon('flag')}<span>Sign out</span></button>
        </div>
      </div>
    </div>
  </nav>`;
}

function topBar() {
  return `<header class="top-bar">
    <a class="top-mark" href="/">${icon('logo', { filled: true })}<span>Gambit Hall</span></a>
    <nav class="top-actions" aria-label="Account">
      <a class="button button-quiet" href="/login">Sign in</a>
      <a class="button button-primary" href="/join">Join</a>
    </nav>
  </header>`;
}

/**
 * The whole document.  The member's own preferences dress it, so the board
 * arrives already in their set and theme.
 */
export function layout({
  member = null,
  title,
  active = null,
  body,
  scripts = [],
  skipLabel = 'Skip to content',
  skipTarget = '#main',
  unread = 0,
  bodyClass = '',
  description = 'Gambit Hall Club: a turn-based chess club with no clocks.',
}) {
  const theme = member ? member.theme : 'Forest';
  const set2d = member ? member.piece_set_2d : 'Classic';
  const set3d = member ? member.piece_set_3d : 'Marble';
  const sound = member ? member.sound : true;
  const scriptTags = scripts
    .map((src) => `<script type="module" src="${escapeAttr(src)}"></script>`)
    .join('\n    ');

  return `<!doctype html>
<html lang="en" data-theme="${escapeAttr(theme)}" data-set2d="${escapeAttr(set2d)}" data-set3d="${escapeAttr(set3d)}" data-sound="${sound ? 'on' : 'off'}"${member ? ` data-member="${escapeAttr(member.username)}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Gambit Hall</title>
  <meta name="description" content="${escapeAttr(description)}">
  <meta name="referrer" content="same-origin">
  <link rel="icon" href="/media/avatars/house.png">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body class="${escapeAttr(bodyClass)}${member ? ' is-member' : ' is-public'}">
  <a class="skip-link" href="${escapeAttr(skipTarget)}">${escapeHtml(skipLabel)}</a>
  ${skipTarget === '#main' ? '' : '<a class="skip-link" href="#main">Skip to content</a>'}
  <div class="live-region" aria-live="polite" aria-atomic="true" id="live-region"></div>
  <div class="live-region" role="status" aria-live="polite" id="status-region"></div>
  ${member ? `<button type="button" class="rail-toggle" id="rail-toggle" aria-expanded="false" aria-controls="rail" aria-label="Menu">${icon('menu')}</button>` : ''}
  ${member ? rail(member, active, unread) : topBar()}
  <main id="main" class="main">
    ${body}
  </main>
  <script type="module" src="/js/app.js"></script>
  ${scriptTags}
</body>
</html>`;
}

export function emptyState(text, action = '') {
  return `<p class="empty-state">${escapeHtml(text)}${action ? ` ${action}` : ''}</p>`;
}

export function panel(heading, inner, { className = '', id = null, headingLevel = 2 } = {}) {
  return `<section class="panel ${className}"${id ? ` id="${escapeAttr(id)}"` : ''}>
    <h${headingLevel} class="panel-heading">${escapeHtml(heading)}</h${headingLevel}>
    ${inner}
  </section>`;
}
