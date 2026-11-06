type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
export type Child = Node | string | number | null | undefined | false | Child[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child = null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child): void {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return;
  }
  parent.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function svgIcon(name: string, title?: string): SVGElement {
  const paths: Record<string, string> = {
    arrow: 'M4 12h16M14 6l6 6-6 6',
    caret: 'M6 9l6 6 6-6',
    cross: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    tick: 'M5 13l4 4L19 7',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.5-4.5',
    bag: 'M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2',
    person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    notAllowed: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 18L18 6',
    warning: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16.5v.5',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (title) {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    label.textContent = title;
    svg.appendChild(label);
    svg.setAttribute('role', 'img');
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] ?? '');
  svg.appendChild(path);
  return svg;
}

let idCounter = 0;
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${negative ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatRatePcm(ratePcm: number): string {
  const whole = Math.floor(ratePcm / 1000);
  const frac = String(ratePcm % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "29 October 2026" in UTC */
export function formatLongDate(iso: string): string {
  const at = new Date(iso);
  return `${at.getUTCDate()} ${MONTHS_LONG[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** "29 October 2026, 14:05 UTC" */
export function formatLongDateTime(iso: string): string {
  const at = new Date(iso);
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${formatLongDate(iso)}, ${hh}:${mm} UTC`;
}

/** "Thu, Oct 29" for a stored calendar date */
export function formatCalendarDate(value: string): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const weekday = WEEKDAYS_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${MONTHS_SHORT[month - 1]} ${day}`;
}

/** "D Mon YYYY" for a stored calendar date */
export function formatEventDate(value: string): string {
  const month = Number(value.slice(5, 7));
  return `${Number(value.slice(8, 10))} ${MONTHS_SHORT[month - 1]} ${value.slice(0, 4)}`;
}

export function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
