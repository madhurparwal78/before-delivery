import { el, reducedMotion } from './dom.js';
import { copy } from './copy.js';
import { ApiError } from './api.js';

/**
 * `status "Notices"` is the only live region for feedback. Each sequence also shows a
 * visual toast with the same copy, whose text is aria-hidden so nothing is announced
 * twice.
 */
let region: HTMLElement | null = null;
let toastStack: HTMLElement | null = null;

export function mountNotices(target: HTMLElement): HTMLElement {
  region = el('div', { class: 'notices', role: 'status', 'aria-live': 'polite', 'aria-label': 'Notices' });
  target.append(region);
  // Rendering a screen clears the body, so the toast stack is re-attached each time.
  if (toastStack === null) toastStack = el('div', { class: 'toast-stack' });
  if (!toastStack.isConnected) document.body.append(toastStack);
  return region;
}

export function announce(message: string): void {
  if (region === null) return;
  region.textContent = message;
}

export function currentNotice(): string {
  return region?.textContent ?? '';
}

/** A toast for 4000 ms, pausing while the pointer rests on it or focus is inside. */
export function toast(message: string): void {
  if (toastStack === null) return;
  const text = el('p', { 'aria-hidden': 'true', text: message });
  const dismiss = el('button', { type: 'button', 'aria-label': 'Dismiss notice', text: 'Dismiss notice' });
  const node = el('div', { class: 'toast' }, [text, dismiss]);
  toastStack.append(node);

  let remaining = 4000;
  let startedAt = performance.now();
  let timer = 0;

  const remove = (): void => {
    window.clearTimeout(timer);
    node.remove();
  };
  const resume = (): void => {
    startedAt = performance.now();
    timer = window.setTimeout(remove, remaining);
  };
  const pause = (): void => {
    window.clearTimeout(timer);
    remaining = Math.max(0, remaining - (performance.now() - startedAt));
  };

  dismiss.addEventListener('click', remove);
  node.addEventListener('pointerenter', pause);
  node.addEventListener('pointerleave', resume);
  dismiss.addEventListener('focus', pause);
  dismiss.addEventListener('blur', resume);
  resume();
}

/** Announces once in Notices and shows the matching toast. */
export function announceWithToast(message: string): void {
  announce(message);
  toast(message);
}

export interface PendingHandle {
  done: (message?: string) => void;
  failed: (message: string) => void;
}

/**
 * Shows an action's pending copy within a tenth of a second and marks its button busy
 * and disabled, then replaces it with the success or failure copy.
 */
export function pending(button: HTMLButtonElement | null, pendingCopy: string): PendingHandle {
  announce(pendingCopy);
  if (button !== null) {
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
  }
  const release = (): void => {
    if (button === null) return;
    button.removeAttribute('aria-busy');
    button.disabled = false;
  };
  return {
    done: (message) => {
      release();
      if (message !== undefined) announce(message);
    },
    failed: (message) => {
      release();
      announce(message);
    },
  };
}

/** Turns a failure into its published line, including the shared 429 and network copy. */
export function failureCopy(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const failure = error.failure;
  if (failure.network) return copy.networkFailure;
  if (failure.status === 429) return copy.rateLimited(failure.retryAfter ?? 1);
  return fallback;
}

export function isReducedMotion(): boolean {
  return reducedMotion();
}
