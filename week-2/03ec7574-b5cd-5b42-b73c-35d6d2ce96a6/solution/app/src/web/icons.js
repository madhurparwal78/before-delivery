import { html, trusted } from './html.js';

// Inline icons drawn for this app. Decorative icons are hidden from assistive technology; an icon that
// is a control's only content carries the control's name.
const PATHS = {
  diamond: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill="currentColor" stroke="none"/><path d="M12 8 16 12 12 16 8 12Z" fill="#fff" stroke="none"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
  checklist: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  transfer: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  layers: '<path d="M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  blocks: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  bank: '<path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  agent: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/>',
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  scale: '<path d="M4 18 9 12l4 3 7-9M15 6h5v5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
  policy: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.8.8 3 2.7 3 5.5"/>',
  audit: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="M9 12h6M9 15h4M9 9h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
};

export function icon(name, label = '') {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return trusted(`<svg class="icon icon--${name}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" `
    + `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name]}</svg>`);
}

// A display heading in two tones: the statement in ink, the closing phrase in slate. Each word is its
// own span so the words can sharpen one after another.
export function display(tag, statement, subject, cls = '') {
  const words = (text) => text.split(' ').map((w, i, all) => html`<span class="word">${w}</span>${i < all.length - 1 ? ' ' : ''}`);
  return trusted(`<${tag} class="display ${cls}" data-blur>${html`${words(statement)} <span class="tail">${words(subject)}</span>`}</${tag}>`);
}
