export const qs = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null => root.querySelector<T>(selector);

export const qsa = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] => [...root.querySelectorAll<T>(selector)];

export const bootstrap = <T>(): T => {
  const node = document.getElementById('gw-bootstrap');
  return node === null ? ({} as T) : (JSON.parse(node.textContent ?? '{}') as T);
};

export type ErrorBody = { error: string; message: string; fields?: Record<string, string> };

export type ApiResult<T> = { status: number; ok: boolean; body: T & Partial<ErrorBody> };

export const api = async <T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {},
): Promise<ApiResult<T>> => {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: init.method ?? (init.body !== undefined || init.form !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    credentials: 'same-origin',
  });
  let body: unknown = {};
  const text = await response.text();
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return { status: response.status, ok: response.ok, body: body as T & Partial<ErrorBody> };
};

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export type TweenStop = () => void;

export const tween = (
  durationMs: number,
  step: (progress: number) => void,
  done?: () => void,
): TweenStop => {
  if (reducedMotion() || durationMs <= 0) {
    step(1);
    done?.();
    return () => undefined;
  }
  let frame = 0;
  const start = performance.now();
  const run = (now: number): void => {
    const linear = Math.min(1, (now - start) / durationMs);
    step(easeOut(linear));
    if (linear < 1) frame = requestAnimationFrame(run);
    else done?.();
  };
  frame = requestAnimationFrame(run);
  return () => cancelAnimationFrame(frame);
};

export const announce = (region: HTMLElement | null, text: string): void => {
  if (region === null) return;
  if (region.textContent === text) return;
  region.textContent = text;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusables = (root: HTMLElement): HTMLElement[] =>
  qsa<HTMLElement>(FOCUSABLE, root).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );

export type Dialog = {
  element: HTMLElement;
  open: (opener: HTMLElement | null) => void;
  close: (options?: { restoreFocus?: boolean }) => void;
  isOpen: () => boolean;
};

/** Dialogs keep focus inside, wrap with Tab, and return focus to their opener. */
export const createDialog = (
  element: HTMLElement,
  hooks: { onClose?: () => void } = {},
): Dialog => {
  let opener: HTMLElement | null = null;

  const close = (options: { restoreFocus?: boolean } = {}): void => {
    if (element.hidden) return;
    element.hidden = true;
    hooks.onClose?.();
    if (options.restoreFocus !== false) opener?.focus();
  };

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(element);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return {
    element,
    isOpen: () => !element.hidden,
    open: (nextOpener) => {
      opener = nextOpener;
      element.hidden = false;
      focusables(element)[0]?.focus();
    },
    close,
  };
};

export const setFieldErrors = (
  root: ParentNode,
  fields: Record<string, string> | undefined,
): void => {
  for (const slot of qsa<HTMLElement>('[data-field-error]', root)) slot.textContent = '';
  for (const [name, message] of Object.entries(fields ?? {})) {
    const slot = qs<HTMLElement>(`[data-field-error="${CSS.escape(name)}"]`, root);
    if (slot !== null) slot.textContent = message;
  }
};

export const showErrorSummary = (
  form: HTMLElement,
  fields: Record<string, string> | undefined,
  fallback: string,
): void => {
  const summary = qs<HTMLElement>('[data-error-summary]', form);
  if (summary === null) return;
  const entries = Object.entries(fields ?? {});
  summary.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'There is a problem';
  summary.append(heading);
  if (entries.length === 0) {
    const paragraph = document.createElement('p');
    paragraph.textContent = fallback;
    summary.append(paragraph);
  } else {
    const list = document.createElement('ul');
    for (const [name, message] of entries) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = message;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        qs<HTMLElement>(`[data-field="${CSS.escape(name)}"]`, form)?.focus();
      });
      item.append(link);
      list.append(item);
    }
    summary.append(list);
  }
  summary.hidden = false;
  summary.setAttribute('tabindex', '-1');
  summary.focus();
};

export const pending = (button: HTMLElement | null, label: string | null): void => {
  if (button === null) return;
  if (label === null) {
    const original = button.dataset.labelWas;
    if (original !== undefined) button.textContent = original;
    button.removeAttribute('aria-busy');
    delete button.dataset.labelWas;
    return;
  }
  button.dataset.labelWas = button.textContent ?? '';
  button.textContent = label;
  button.setAttribute('aria-busy', 'true');
};

export const onBreakpointChange = (run: (phone: boolean, tablet: boolean) => void): void => {
  const phone = window.matchMedia('(max-width: 767px)');
  const desktop = window.matchMedia('(min-width: 1200px)');
  const apply = (): void => run(phone.matches, !phone.matches && !desktop.matches);
  phone.addEventListener('change', apply);
  desktop.addEventListener('change', apply);
  apply();
};
