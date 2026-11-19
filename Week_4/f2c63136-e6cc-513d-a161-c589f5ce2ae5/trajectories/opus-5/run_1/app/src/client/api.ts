export interface ApiFailure {
  status: number;
  error?: string;
  errors?: Record<string, string>;
  current_head?: string;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.error ?? 'Request failed');
    this.failure = failure;
  }
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const failure = parsed as ApiFailure;
    throw new ApiCallError({ ...failure, status: response.status });
  }
  return parsed as T;
}

export function announcement(): HTMLElement {
  let strip = document.querySelector<HTMLElement>('.announcement');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'announcement';
    strip.setAttribute('role', 'alert');
    strip.setAttribute('aria-label', 'Announcement');
    document.body.insertBefore(strip, document.body.firstChild);
  }
  return strip;
}

export function announce(message: string): HTMLElement {
  const strip = announcement();
  strip.textContent = message;
  return strip;
}

export function actionStatus(message: string): void {
  const region = document.getElementById('action-status');
  if (region) region.textContent = message;
}

export function fieldError(field: HTMLElement | null, message: string): void {
  if (!field) {
    announce(message);
    return;
  }
  const holder = field.closest('label') ?? field;
  let error = holder.parentElement?.querySelector<HTMLElement>(`[data-error-for="${field.getAttribute('aria-label')}"]`);
  if (!error) {
    error = document.createElement('p');
    error.className = 'fielderror';
    error.setAttribute('role', 'alert');
    error.setAttribute('data-error-for', field.getAttribute('aria-label') ?? '');
    holder.insertAdjacentElement('afterend', error);
  }
  error.textContent = message;
}

export function clearFieldErrors(scope: ParentNode): void {
  scope.querySelectorAll('.fielderror').forEach((node) => node.remove());
}

/** Runs one async action: pending state, success message, published refusal copy. */
export async function act(
  button: HTMLElement | null,
  pending: string,
  run: () => Promise<string | void>,
  onFailure?: (failure: ApiFailure) => boolean,
): Promise<void> {
  if (button) button.setAttribute('aria-busy', 'true');
  actionStatus(pending);
  try {
    const message = await run();
    if (typeof message === 'string') actionStatus(message);
  } catch (error) {
    actionStatus('');
    if (error instanceof ApiCallError) {
      if (!onFailure || !onFailure(error.failure)) {
        const failure = error.failure;
        const message = failure.error ?? Object.values(failure.errors ?? {})[0] ?? 'Request failed';
        announce(message);
      }
    } else {
      announce('Something went wrong. Nothing was saved.');
    }
  } finally {
    if (button) button.removeAttribute('aria-busy');
  }
}
