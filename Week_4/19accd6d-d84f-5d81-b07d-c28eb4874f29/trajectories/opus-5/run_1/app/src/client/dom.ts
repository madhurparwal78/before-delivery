import { iconPaths } from './icons.generated.js';

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'text') element.textContent = String(value);
    else if (key.startsWith('.')) (element as unknown as Record<string, unknown>)[key.slice(1)] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) element.append(child);
  return element;
}

export function icon(name: keyof typeof iconPaths | string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  svg.innerHTML = iconPaths[name] ?? '';
  return svg;
}

/** The original wrung-cloth mascot. */
export function mascot(extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('mascot');
  if (extraClass !== '') svg.classList.add(extraClass);
  svg.innerHTML =
    '<path d="M4 4c3 0 3 3 6 3s3-3 6-3c2 0 3 1 3 2 0 2-4 2-6 4s2 3 2 5c0 3-3 5-6 5s-6-2-6-5c0-2 4-3 2-5S2 7 2 6c0-1 1-2 2-2z" fill="currentColor" opacity="0.92"/>' +
    '<path d="M9 9c1.5 1.5 1.5 3.5 0 5M15 9c-1.5 1.5-1.5 3.5 0 5" stroke="#ffffff" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
  return svg;
}

export function iconButton(options: {
  name: string;
  label: string;
  onActivate: (event: MouseEvent) => void;
  pressed?: boolean;
  disabled?: boolean;
  extraClass?: string;
}): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    class: `icon-button${options.extraClass === undefined ? '' : ` ${options.extraClass}`}`,
    'aria-label': options.label,
    'aria-pressed': options.pressed === undefined ? null : String(options.pressed),
    disabled: options.disabled ?? false,
  });
  button.append(icon(options.name));
  button.addEventListener('click', options.onActivate);
  return button;
}

export function clear(element: Element): void {
  while (element.firstChild !== null) element.firstChild.remove();
}

/** Writes into a polite live region so repeated messages are announced again. */
export function announceInto(region: HTMLElement, message: string): void {
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 10);
}

export function isPhoneLayout(): boolean {
  return window.matchMedia('(max-width: 700px)').matches;
}

/** Traps Tab and Shift+Tab inside a dialog or sheet. */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null || element === document.activeElement);
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
