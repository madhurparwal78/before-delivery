/** Shared browser helpers: announcements, page-timer tweens, dialogs and the theme choice. */

export const $ = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null => root.querySelector<T>(selector);

export const $$ = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] => [...root.querySelectorAll<T>(selector)];

export function announce(text: string): void {
  const region = document.getElementById('announcer');
  if (region !== null) region.textContent = text;
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const pageData = <T>(): T => {
  const node = document.getElementById('page-data');
  return node === null ? ({} as T) : (JSON.parse(node.textContent ?? '{}') as T);
};

export interface ApiFailure {
  code: string;
  message: string;
  fields?: Record<string, string>;
  cycle?: string[];
  savedBy?: { id: string; name: string };
  report?: unknown;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiFailure };

export async function api<T>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed as { error?: ApiFailure }).error;
    return {
      ok: false,
      status: response.status,
      error: error ?? { code: 'unknown', message: 'Something went wrong.' },
    };
  }
  return { ok: true, status: response.status, data: parsed as T };
}

export interface Tween {
  cancel: () => void;
  progress: () => number;
}

const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3);

/** Runs on animation frames so a paused page clock drives it. */
export function tween(
  duration: number,
  step: (eased: number, raw: number) => void,
  done?: () => void,
): Tween {
  if (duration <= 0 || reducedMotion()) {
    step(1, 1);
    done?.();
    return { cancel: () => undefined, progress: () => 1 };
  }
  const start = performance.now();
  let raw = 0;
  let frame = 0;
  let cancelled = false;
  const run = (now: number): void => {
    if (cancelled) return;
    raw = Math.min(1, (now - start) / duration);
    step(easeOut(raw), raw);
    if (raw < 1) frame = requestAnimationFrame(run);
    else done?.();
  };
  frame = requestAnimationFrame(run);
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    },
    progress: () => raw,
  };
}

export const wait = (ms: number, run: () => void): number => window.setTimeout(run, ms);

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (element: HTMLElement): boolean =>
  element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement;

export const focusables = (container: HTMLElement): HTMLElement[] =>
  $$<HTMLElement>(FOCUSABLE, container).filter(visible);

/** Tab wraps inside the container, so focus never reaches the page behind. */
export function trapFocus(container: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusables(container);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}

export interface Dialog {
  element: HTMLElement;
  close: () => void;
}

let openDialogs: Dialog[] = [];

export function openDialog(
  element: HTMLElement,
  options: { opener: HTMLElement | null; focus?: HTMLElement | null; onClose?: () => void } = {
    opener: null,
  },
): Dialog {
  element.hidden = false;
  const release = trapFocus(element);
  const target = options.focus ?? focusables(element)[0] ?? element;
  target.focus();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dialog.close();
    }
  };
  element.addEventListener('keydown', onKeyDown);
  const dialog: Dialog = {
    element,
    close: () => {
      element.hidden = true;
      release();
      element.removeEventListener('keydown', onKeyDown);
      openDialogs = openDialogs.filter((candidate) => candidate !== dialog);
      options.onClose?.();
      options.opener?.focus();
    },
  };
  openDialogs.push(dialog);
  return dialog;
}

export const THEME_KEY = 'galley.theme';
export const CODE_GROUP_KEY = 'galley.codeGroup';
export const THEME_TIMER = 200;

function applyTheme(choice: string): void {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  if (!reducedMotion()) {
    document.body.classList.add('theme-fading');
    wait(THEME_TIMER, () => document.body.classList.remove('theme-fading'));
  }
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themeChoice = choice;
}

/** One remembered choice shared by the editor and the public site (DP-48). */
export function setupTheme(): void {
  const radios = $$<HTMLInputElement>('input[name="theme"]');
  const choice = localStorage.getItem(THEME_KEY) ?? 'system';
  for (const radio of radios) {
    radio.checked = radio.value === choice;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      localStorage.setItem(THEME_KEY, radio.value);
      applyTheme(radio.value);
    });
  }
  applyTheme(choice);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) ?? 'system') === 'system') applyTheme('system');
  });
}

export type MotionState = 'opening' | 'open' | 'closing' | 'closed';

export const setMotion = (element: HTMLElement, state: MotionState): void => {
  element.dataset.motion = state;
};

export function connectEvents(
  url: string,
  handlers: Record<string, (data: unknown) => void>,
): EventSource {
  const source = new EventSource(url);
  for (const [name, handler] of Object.entries(handlers)) {
    source.addEventListener(name, (event) => {
      handler(JSON.parse((event as MessageEvent<string>).data) as unknown);
    });
  }
  return source;
}
