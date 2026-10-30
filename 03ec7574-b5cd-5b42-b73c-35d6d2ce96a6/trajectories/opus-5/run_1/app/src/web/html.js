const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export const h = escapeHtml;

export function attributes(map) {
  return Object.entries(map)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([key, value]) => (value === true ? key : `${key}="${escapeHtml(value)}"`))
    .join(' ');
}

/** A display heading whose closing phrase reads in slate. */
export function displayHeading(level, lead, phrase, options = {}) {
  const attrs = attributes({ class: ['display', options.className].filter(Boolean).join(' '), id: options.id });
  return `<h${level} ${attrs}>${h(lead)} <span class="phrase">${h(phrase)}</span></h${level}>`;
}

export function icon(name, { label = null } = {}) {
  const paths = {
    brand: '<path d="M12 2 22 12 12 22 2 12Z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20h-2"/>',
    ticks: '<path d="M4 7l2 2 4-4M4 17l2 2 4-4M14 7h6M14 17h6"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>',
    swap: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6Z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5Z"/><path d="M3 13l9 5 9-5"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
    wallet: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M16 12h3"/>'
  };
  const naming = label ? `role="img" aria-label="${h(label)}"` : 'aria-hidden="true"';
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${naming}>${paths[name]}</svg>`;
}
