export function pick<Element_ extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): Element_ | null {
  return root.querySelector(selector) as Element_ | null;
}

export function pickAll<Element_ extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): Element_[] {
  return [...root.querySelectorAll(selector)] as Element_[];
}

export function pageData(): Record<string, unknown> {
  const holder = pick('[data-part="page-data"]');
  if (!holder || !holder.textContent) return {};
  return JSON.parse(holder.textContent) as Record<string, unknown>;
}

/** One message made twice in a row is announced twice. */
export function announce(text: string): void {
  const region = pick('[data-part="announcements"]');
  if (!region) return;
  const a = pick('[data-slot="a"]', region);
  const b = pick('[data-slot="b"]', region);
  if (!a || !b) return;
  if (a.textContent === '') {
    a.textContent = text;
    b.textContent = '';
  } else {
    b.textContent = text;
    a.textContent = '';
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function focusHeading(): void {
  const found = pick<HTMLElement>('#page-heading');
  if (found) found.focus();
}

export interface ApiAnswer {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

export async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<ApiAnswer> {
  const headers: Record<string, string> = { accept: 'application/json', ...extraHeaders };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json';
    payload = '{}';
  }
  const answer = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  let parsed: Record<string, unknown> = {};
  const kind = answer.headers.get('content-type') ?? '';
  if (kind.includes('application/json')) {
    parsed = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
  }
  return { status: answer.status, body: parsed, headers: answer.headers };
}

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  busyUntil?: string;
  lastValue?: string;
  lastAt?: string;
}

export function errorOf(answer: ApiAnswer): ApiError | null {
  const held = answer.body.error as ApiError | undefined;
  return held ?? null;
}

/** While a button's request is open its text and accessible name read `Working…`. */
export async function working<Value>(
  button: HTMLElement,
  workingText: string,
  run: () => Promise<Value>,
): Promise<Value> {
  const was = button.textContent ?? '';
  const hadFocus = document.activeElement === button;
  button.textContent = workingText;
  button.setAttribute('aria-disabled', 'true');
  try {
    return await run();
  } finally {
    button.textContent = was;
    button.removeAttribute('aria-disabled');
    if (hadFocus) button.focus();
  }
}

export function clearProblems(scope: ParentNode = document): void {
  for (const region of pickAll('[data-part="problems"]', scope)) {
    region.textContent = '';
    region.hidden = true;
  }
  for (const field of pickAll('[aria-invalid="true"]', scope)) field.removeAttribute('aria-invalid');
}

/**
 * Every form error appears in a Problems summary whose links move focus to their
 * fields, and pressing a refused action moves focus to that summary.
 */
export function showProblems(scope: ParentNode, error: ApiError, problemsName = 'Problems'): void {
  const region = pick('[data-part="problems"]', scope) ?? pick('[data-part="problems"]');
  if (!region) return;
  region.textContent = '';
  const title = document.createElement('p');
  title.className = 'problems-title';
  title.textContent = problemsName;
  region.append(title);
  const fields = error.fields;
  if (fields && Object.keys(fields).length > 0) {
    const list = document.createElement('ul');
    for (const [key, message] of Object.entries(fields)) {
      const field = findField(scope, key);
      const item = document.createElement('li');
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        if (!field.id) field.id = `field-${key.replace(/[^a-z0-9]+/gi, '-')}`;
        const link = document.createElement('a');
        link.href = `#${field.id}`;
        link.textContent = message;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          field.focus();
        });
        item.append(link);
      } else {
        item.textContent = message;
      }
      list.append(item);
    }
    region.append(list);
  } else {
    const text = document.createElement('p');
    text.textContent = error.message;
    region.append(text);
  }
  region.hidden = false;
  (region as HTMLElement).setAttribute('tabindex', '-1');
  (region as HTMLElement).focus();
}

function findField(scope: ParentNode, key: string): HTMLElement | null {
  const name = key.split('.')[0] ?? key;
  const direct = pick<HTMLElement>(`[name="${cssEscape(key)}"]`, scope) ?? pick<HTMLElement>(`[name="${cssEscape(name)}"]`, scope);
  if (direct) return direct;
  const root = document;
  return pick<HTMLElement>(`[name="${cssEscape(key)}"]`, root) ?? pick<HTMLElement>(`[name="${cssEscape(name)}"]`, root);
}

function cssEscape(text: string): string {
  return text.replace(/["\\]/g, '\\$&');
}

export function valueOf(name: string, scope: ParentNode = document): string {
  const field = pick<HTMLInputElement>(`[name="${name}"]`, scope);
  return field ? field.value.trim() : '';
}
