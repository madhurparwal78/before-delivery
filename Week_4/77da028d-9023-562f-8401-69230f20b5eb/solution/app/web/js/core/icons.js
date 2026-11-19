// One consistent line set drawn for this app: 24px grid, 1.75 stroke, inline SVG.
const PATHS = {
  plan: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 15c3-2.5 5 .5 8.5-1.5s5.5-2 8.5.5"/><path d="M12 3.5v3"/>',
  projects: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  sessions: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 8.5h8M8 12.5h8M8 16.5h5"/>',
  library: '<path d="M5 4v16M10 4v16"/><path d="m14.5 5.5 4.8-1.2 3.2 14.7-4.8 1.2Z" transform="translate(-3 0)"/>',
  site: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  alert: '<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  go: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'no-go': '<path d="m6 6 12 12M18 6 6 18"/>',
  unknown: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.1"/>',
};

export function icon(name, size = 24) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('viewBox', '0 0 24 24');
  element.setAttribute('width', String(size));
  element.setAttribute('height', String(size));
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke', 'currentColor');
  element.setAttribute('stroke-width', '1.75');
  element.setAttribute('stroke-linecap', 'round');
  element.setAttribute('stroke-linejoin', 'round');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('focusable', 'false');
  element.innerHTML = PATHS[name];
  return element;
}
