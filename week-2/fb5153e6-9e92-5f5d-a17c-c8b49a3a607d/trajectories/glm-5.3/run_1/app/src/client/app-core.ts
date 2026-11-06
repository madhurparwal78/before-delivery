interface TsGlobal {
  locale: 'en' | 'de';
  copy: Record<string, string>;
  user: string | null;
}

export function ts(): TsGlobal {
  return (window as unknown as { TS: TsGlobal }).TS;
}

export function copy(key: string, params?: Record<string, string | number>): string {
  const raw = ts().copy[key] ?? key;
  if (params === undefined) return raw;
  return raw.replace(/\{([\w ]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function locale(): 'en' | 'de' {
  return ts().locale;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text === '' ? undefined : JSON.parse(text);
  if (response.status >= 400) {
    const err = new ApiFailure(body?.error ?? 'not_found', body?.message ?? 'Not found.', body?.fields ?? {}, response.status);
    throw err;
  }
  return body as T;
}

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
    readonly status: number,
  ) {
    super(message);
  }
}

export function showError(el: HTMLElement | null, failure: unknown): void {
  if (el === null) return;
  const failure_ = failure instanceof ApiFailure ? failure : new ApiFailure('not_found', 'Not found.', {}, 500);
  if (Object.keys(failure_.fields).length > 0) {
    const list = Object.entries(failure_.fields)
      .map(([, message]) => `<li>${escapeHtml(message)}</li>`)
      .join('');
    el.innerHTML = `<p>${escapeHtml(copy('error.summary_title'))}</p><ul>${list}</ul>`;
    el.hidden = false;
    return;
  }
  el.textContent = copy(failure_.code) === failure_.code ? failure_.message : copy(failure_.code);
  el.hidden = false;
}

export function announce(el: HTMLElement | null, message: string): void {
  if (el === null) return;
  el.textContent = message;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The language picker: re-renders in place, replaces lang in the address, keeps scroll and focus. */
export function wireLanguagePicker(): void {
  const picker = document.getElementById('language-picker') as HTMLSelectElement | null;
  if (picker === null) return;
  picker.addEventListener('change', () => {
    const value = picker.value;
    const url = new URL(window.location.href);
    if (value === 'de') url.searchParams.set('lang', 'de');
    else url.searchParams.delete('lang');
    const scrollY = window.scrollY;
    const focusWithin = document.activeElement === picker;
    window.history.replaceState(null, '', url);
    void (async () => {
      const response = await fetch(url.toString());
      const text = await response.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const main = document.getElementById('main');
      const newMain = doc.getElementById('main');
      if (main !== null && newMain !== null) main.innerHTML = newMain.innerHTML;
      const topbar = document.querySelector('header.topbar');
      const newTopbar = doc.querySelector('header.topbar');
      if (topbar !== null && newTopbar !== null) topbar.innerHTML = newTopbar.innerHTML;
      window.scrollTo(0, scrollY);
      wireLanguagePicker();
      if (focusWithin) document.getElementById('language-picker')?.focus();
    })();
  });
}

export function wireSignOut(): void {
  const button = document.getElementById('sign-out');
  if (button === null) return;
  button.addEventListener('click', () => {
    void api('/api/session', { method: 'DELETE' }).then(() => {
      const url = new URL(window.location.href);
      url.pathname = '/catalogue';
      url.searchParams.delete('lang');
      url.searchParams.delete('lang');
      window.location.href = url.toString();
    });
  });
}

/** Runs the shared top-bar wiring on every page. */
export function wireCore(): void {
  wireLanguagePicker();
  wireSignOut();
}
