/* Workspace shared pieces: the store every module reads, DOM helpers, icons and the status line. */

export const S = {
  me: null,
  slug: null,
  communityId: 0,
  channelId: 0,
  communities: [],
  community: null,
  channels: [],
  perms: new Set(),
  timeoutUntil: null,
  members: [],
  ready: false,
  started: false,
  dropped: false,
  lost: false,
  channelName: '',
  hooks: {},
};

/* Settles once the live stream's first answer names the open community's slug; reads that need it wait here. */
let knowSlug;
export const slugKnown = new Promise((resolve) => { knowSlug = resolve; });
export function setSlug(slug) { S.slug = slug; knowSlug(slug); }

export const $ = (id) => document.getElementById(id);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const ICONS = {
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  speaker: 'M4 9v6h4l5 4V5L8 9H4zM16.5 9a4 4 0 0 1 0 6',
  clip: 'M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M17 4.5a3.5 3.5 0 0 1 0 6.5M22 20a6 6 0 0 0-4-5.6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  x: 'M6 6l12 12M18 6L6 18',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01',
  reply: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v3',
  pencil: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
};

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/* The single Workspace status line: the same element carries every update. */
export function status(text) {
  $('status').textContent = text;
}

export const api = (method, path, options) => window.Hub.api(method, path, options);

export function newNonce() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatTime(iso) {
  const moment = new Date(iso);
  const time = moment.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (moment.toDateString() === now.toDateString()) return time;
  return moment.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
}

export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* The quote line of a reply: the parent as it stands now, cut at 100 code points. */
export function quoteText(ref) {
  const letters = Array.from(ref.body);
  const text = letters.length > 100 ? letters.slice(0, 100).join('') + '…' : ref.body;
  return `Replying to ${ref.author.display_name}: ${text}` + (ref.edited_at ? ' (edited)' : '');
}

export function durationLabel(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const EMOJI = [
  ['thumbs up', '👍'], ['heart', '❤️'], ['laughing', '😂'], ['party', '🎉'],
  ['surprised', '😮'], ['sad', '😢'], ['fire', '🔥'], ['eyes', '👀'],
];
export const emojiName = (emoji) => (EMOJI.find(([, glyph]) => glyph === emoji) || [emoji])[0];

export const UPLOAD_LIMITS = { free: 10485760, basic: 52428800, max: 524288000 };

export const draftKey = () => `hub.draft.${S.me.id}.${S.channelId}`;

/* Wait for an open/close slide, then run done; immediately under reduced motion. */
export function afterSlide(node, done) {
  if (reducedMotion()) { done(); return; }
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  node.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 320);
}
