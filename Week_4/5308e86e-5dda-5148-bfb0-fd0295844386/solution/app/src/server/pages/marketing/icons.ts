/** Original single-colour line icons and the Tallwind mark. Every icon is decorative: the control that holds it carries the name. */

const ICON_PATHS = {
  arrowRight: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  play: `<path d="M8 5.5v13l11-6.5z"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/>`,
  calendar: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>`,
  invoice: `<path d="M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6"/>`,
  scan: `<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 12h8"/>`,
  shield: `<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>`,
  bolt: `<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>`,
  users: `<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M17 14.3c2.3.7 4 2.9 4 5.7"/>`,
  repeat: `<path d="M4 12V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 12v3a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>`,
  chat: `<path d="M4 5h16v11H9l-5 4z"/>`,
  plug: `<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>`,
  chart: `<path d="M4 20V4M4 20h16M8 15l4-5 3 3 5-7"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`,
  percent: `<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>`,
  layers: `<path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5"/>`,
  banknote: `<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/>`,
  sparkle: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

/** The Tallwind mark: a looping knot whose over-strand is drawn twice so the crossing reads as a knot. */
export function markSvg(): string {
  return `<svg class="brand-mark" viewBox="0 0 40 28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 14C23 9.5 27 5 31.5 5S37.5 9 37.5 14 35.5 23 31.5 23C27 23 23 18.5 20 14S13 5 8.5 5 2.5 9 2.5 14 4.5 23 8.5 23C13 23 17 18.5 20 14Z"/><path class="brand-mark-halo" d="M22.9 18.2 17.1 9.8"/><path d="M22.9 18.2 17.1 9.8"/></svg>`;
}
