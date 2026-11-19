export const SHORT = 160;
export const MEDIUM = 320;
export const LONG = 640;

export function one<T extends Element = HTMLElement>(selector: string, within: ParentNode = document): T | null {
  return within.querySelector<T>(selector);
}

export function all<T extends Element = HTMLElement>(selector: string, within: ParentNode = document): T[] {
  return [...within.querySelectorAll<T>(selector)];
}

export function pageData<T extends Record<string, unknown>>(): T {
  const holder = document.getElementById('page-data');
  if (!holder?.textContent) return {} as T;
  try {
    return JSON.parse(holder.textContent) as T;
  } catch {
    return {} as T;
  }
}

export function announce(message: string): void {
  const region = one('[data-part="announcements"]');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 20);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Every motion runs on the browser's animation timeline at one of the three published durations. */
export function play(
  element: Element,
  frames: Keyframe[],
  duration: typeof SHORT | typeof MEDIUM | typeof LONG,
): Animation | null {
  if (reducedMotion()) return null;
  return element.animate(frames, { duration, easing: 'cubic-bezier(0.2, 0, 0.1, 1)', fill: 'both' });
}

export type ApiAnswer<T> = { ok: true; status: number; body: T } | { ok: false; status: number; body: ApiError };
export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };

export async function api<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; body?: unknown; raw?: BodyInit; contentType?: string } = {},
): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
    if (options.contentType) headers['content-type'] = options.contentType;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const answer = await fetch(path, { method: options.method ?? 'GET', headers, body });
  const text = await answer.text();
  let parsed: unknown = {};
  try {
    parsed = text === '' ? {} : JSON.parse(text);
  } catch {
    parsed = {};
  }
  if (!answer.ok) {
    return { ok: false, status: answer.status, body: parsed as ApiError };
  }
  return { ok: true, status: answer.status, body: parsed as T };
}

/** SR11: a button's text and name read `Working…` while its request is open. */
export async function whileWorking(button: HTMLElement, work: () => Promise<void>): Promise<void> {
  if (button.getAttribute('aria-disabled') === 'true') return;
  const held = button.textContent ?? '';
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('aria-label', 'Working…');
  button.textContent = 'Working…';
  try {
    await work();
  } finally {
    button.textContent = held;
    button.removeAttribute('aria-label');
    button.removeAttribute('aria-disabled');
    if (document.contains(button)) button.focus({ preventScroll: true });
  }
}

export function showProblems(holder: ParentNode, fields: Record<string, string>, message?: string): void {
  const group = one('[data-part="problems"]', holder) ?? one('[data-part="problems"]');
  if (!group) return;
  const list = one('.problems-list', group);
  if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(fields);
  const rows = entries.length > 0 ? entries : message ? [['', message] as [string, string]] : [];
  for (const [field, text] of rows) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = field ? `#${fieldId(field)}` : '#';
    link.textContent = text;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const input = document.getElementById(fieldId(field));
      input?.focus();
    });
    item.append(link);
    list.append(item);
    const input = document.getElementById(fieldId(field));
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `${input.id}-message`);
    }
  }
  group.removeAttribute('hidden');
}

export function clearProblems(holder: ParentNode = document): void {
  for (const group of all('[data-part="problems"]', holder)) {
    group.setAttribute('hidden', '');
    const list = one('.problems-list', group);
    if (list) list.innerHTML = '';
  }
  for (const field of all('[aria-invalid="true"]', holder)) field.removeAttribute('aria-invalid');
}

function fieldId(field: string): string {
  return field
    .replace(/\./g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

export function showRefreshLine(show: boolean, message = "Couldn't refresh. Trying again."): void {
  const line = one('[data-part="refresh-line"]');
  if (!line) return;
  if (show) {
    line.textContent = message;
    line.removeAttribute('hidden');
  } else {
    line.setAttribute('hidden', '');
  }
}

export function ddmmyyyyToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  const read = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(read.getTime()) || read.toISOString().slice(0, 10) !== date) return null;
  return date;
}

export function isoToDdmmyyyy(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
