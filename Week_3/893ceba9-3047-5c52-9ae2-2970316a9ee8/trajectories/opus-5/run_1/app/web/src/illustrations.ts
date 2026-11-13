// Flat SVG illustration panels and icon tiles. Colour appears only here.

import { el } from './dom';

const gridPattern = `
  <defs>
    <pattern id="grid-%ID%" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0v24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1"/>
    </pattern>
    <linearGradient id="wash-%ID%" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde4d3"/>
      <stop offset="55%" stop-color="#fbdcea"/>
      <stop offset="100%" stop-color="#e7dcfb"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#wash-%ID%)"/>
  <rect width="100%" height="100%" fill="url(#grid-%ID%)"/>
`;

let counter = 0;
function unique(): string {
  counter += 1;
  return `i${counter}`;
}

function panel(width: number, height: number, inner: string, label: string, extraClass = ''): HTMLElement {
  const id = unique();
  const holder = el('div', {
    class: `illustration ${extraClass}`.trim(),
    role: 'img',
    'aria-label': label,
  });
  holder.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" focusable="false">
    ${gridPattern.replaceAll('%ID%', id)}
    ${inner}
  </svg>`;
  return holder;
}

function localeCard(x: number, y: number, code: string, rotation: number): string {
  return `
  <g transform="translate(${x} ${y}) rotate(${rotation})">
    <rect width="210" height="150" rx="14" fill="#ffffff" stroke="#d9dce3"/>
    <rect x="18" y="22" width="86" height="8" rx="4" fill="#111726"/>
    <rect x="18" y="42" width="140" height="8" rx="4" fill="#5b6275"/>
    <rect x="18" y="68" width="160" height="10" rx="5" fill="#e6e8ee"/>
    <rect x="18" y="88" width="120" height="10" rx="5" fill="#e6e8ee"/>
    <rect x="18" y="108" width="140" height="10" rx="5" fill="#e6e8ee"/>
    <rect x="150" y="16" width="44" height="22" rx="11" fill="#f3f4f7" stroke="#d9dce3"/>
    <text x="172" y="31" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="#111726">${code}</text>
  </g>`;
}

// heroCollage is the landing hero panel: three overlapping locale files with
// floating stat chips of real HTML text.
export function heroCollage(): HTMLElement {
  const art = panel(
    600,
    500,
    `${localeCard(40, 70, 'de', -6)}${localeCard(180, 170, 'fr', 3)}${localeCard(320, 60, 'ja', 7)}`,
    'Three locale files with MQM, match and conflict figures',
    'hero-illustration',
  );
  const chips = el('div', { class: 'stat-chips' }, [
    statChip('MQM 96'),
    statChip('312 exact matches reused'),
    statChip('2 branch conflicts open'),
  ]);
  return el('div', { class: 'hero-art' }, [art, chips]);
}

function statChip(text: string): HTMLElement {
  return el('p', { class: 'stat-chip' }, [
    el('span', { class: 'chip-text', text }),
    el('span', { class: 'chip-example', text: 'Example' }),
  ]);
}

// hubDiagram is the repository, memory and AI route hub of a persona card.
export function hubDiagram(label: string): HTMLElement {
  const tiles = ['de', 'fr', 'ja', 'pt', 'nl', 'it', 'TM', 'AI', 'en']
    .map((code, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      return `<g transform="translate(${236 + column * 46} ${86 + row * 46})">
        <rect width="40" height="40" rx="10" fill="#ffffff" stroke="#d9dce3"/>
        <text x="20" y="25" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="#111726">${code}</text>
      </g>`;
    })
    .join('');
  const inner = `
    <g>
      <rect x="40" y="110" width="120" height="90" rx="14" fill="#ffffff" stroke="#d9dce3"/>
      <text x="100" y="160" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" fill="#111726">App</text>
      <path d="M160 155h70" stroke="#5b6275" stroke-width="2"/>
      <rect x="226" y="76" width="146" height="146" rx="16" fill="rgba(255,255,255,0.6)" stroke="#d9dce3"/>
      ${tiles}
      <path d="M372 150h60" stroke="#5b6275" stroke-width="2"/>
      <rect x="432" y="110" width="90" height="90" rx="14" fill="#ffffff" stroke="#d9dce3"/>
      <circle cx="477" cy="142" r="16" fill="#e7dcfb" stroke="#d9dce3"/>
      <path d="M453 182c6-14 42-14 48 0" fill="#fde4d3" stroke="#d9dce3"/>
    </g>`;
  return panel(560, 300, inner, label);
}

// branchHub is the project panel diagram naming the repository, the memory
// entry count and each language's AI route.
export function branchHub(options: {
  branch: string;
  repository: string;
  entries: number;
  routes: [string, string][];
}): HTMLElement {
  const routeLines = options.routes
    .map(
      (route, index) =>
        `<text x="300" y="${118 + index * 26}" font-family="Inter, sans-serif" font-size="13" fill="#111726">${route[0]} → ${route[1]}</text>`,
    )
    .join('');
  const inner = `
    <g>
      <rect x="24" y="80" width="200" height="54" rx="12" fill="#ffffff" stroke="#d9dce3"/>
      <text x="124" y="112" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" fill="#111726">${options.repository}</text>
      <path d="M124 134v34h150" stroke="#5b6275" stroke-width="2" fill="none"/>
      <rect x="24" y="168" width="200" height="48" rx="12" fill="#ffffff" stroke="#d9dce3"/>
      <text x="124" y="197" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" fill="#111726">TM ${options.entries}</text>
      <rect x="274" y="80" width="250" height="140" rx="14" fill="rgba(255,255,255,0.7)" stroke="#d9dce3"/>
      ${routeLines}
    </g>`;
  return panel(
    560,
    300,
    inner,
    `How ${options.branch} connects to the repository, translation memory and AI route`,
  );
}

const glyphs: Record<string, string> = {
  cookie: '<circle cx="12" cy="12" r="8"/><circle cx="10" cy="10" r="1"/><circle cx="14" cy="14" r="1"/>',
  file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
  restore: '<path d="M4 12a8 8 0 1 0 8-8"/><path d="M4 5v7h7"/>',
  erase: '<path d="M5 7h14"/><path d="M8 7V4h8v3"/><path d="M6 7l1 14h10l1-14"/>',
  signature: '<path d="M4 16c4-10 8 6 12-2"/><path d="M4 20h16"/>',
  scope: '<circle cx="12" cy="12" r="7"/><path d="M12 5v14"/>',
  token: '<circle cx="9" cy="12" r="4"/><path d="M13 12h7"/><path d="M17 12v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l4 2"/>',
  table: '<rect x="4" y="5" width="16" height="14"/><path d="M4 10h16"/><path d="M10 10v9"/>',
  origin: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/>',
  storage: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/>',
  tracker: '<path d="M5 5l14 14"/><circle cx="12" cy="12" r="8"/>',
  branch: '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="12" r="2"/><path d="M7 8v8"/><path d="M9 12h6"/>',
  merge: '<path d="M6 4v10a4 4 0 0 0 4 4h8"/><path d="M14 14l4 4-4 4"/>',
  memory: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 6v12"/>',
  upload: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  ai: '<path d="M12 4v4"/><rect x="6" y="8" width="12" height="10" rx="3"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="13" r="1"/>',
  review: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/><path d="M15 16l2 2 4-4"/>',
  publish: '<path d="M12 20V7"/><path d="M7 12l5-5 5 5"/><path d="M5 20h14"/>',
  score: '<path d="M4 18l5-7 4 4 7-9"/>',
  conflict: '<path d="M12 4l8 14H4z"/><path d="M12 10v4"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h8"/><path d="M18 12v3"/>',
};

// iconTile is a bordered tile with a grey line glyph, or a gradient stroke.
export function iconTile(glyph: string, gradient = false): HTMLElement {
  const id = unique();
  const stroke = gradient ? `url(#stroke-${id})` : '#5b6275';
  const tile = el('span', { class: `icon-tile ${gradient ? 'gradient' : ''}`.trim(), 'aria-hidden': 'true' });
  tile.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" focusable="false">
    <defs>
      <linearGradient id="stroke-${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f0876a"/>
        <stop offset="100%" stop-color="#8b6ae0"/>
      </linearGradient>
    </defs>
    ${glyphs[glyph] ?? glyphs.file}
  </svg>`;
  return tile;
}

// emptyPanel is the small gridded panel of an empty state.
export function emptyPanel(): HTMLElement {
  return panel(320, 180, localeCard(55, 15, 'en', 0), 'An empty locale file', 'empty-illustration');
}
