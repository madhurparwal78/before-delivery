import { announce, one } from './dom.js';
import { ApiCallError } from './api.js';
import type { Locale } from '../shared/locale.js';
import { ERROR_SUMMARY_TITLE } from '../shared/copy.js';

/** One error summary, titled with the published copy, listing one link per field. */
export function showFailure(
  alertNode: Element | null,
  error: unknown,
  locale: Locale,
  form?: HTMLElement | null,
): void {
  if (alertNode === null) return;
  if (!(error instanceof ApiCallError)) throw error;
  const fields = Object.entries(error.failure.fields);
  if (fields.length === 0) {
    alertNode.replaceChildren(document.createTextNode(error.failure.message));
    return;
  }
  const heading = document.createElement('p');
  heading.className = 'field-error';
  heading.textContent = locale === 'de' ? ERROR_SUMMARY_TITLE[1] : ERROR_SUMMARY_TITLE[0];
  const list = document.createElement('ul');
  for (const [name, message] of fields) {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = `#field-${name}`;
    anchor.textContent = message;
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      const field = form?.querySelector<HTMLElement>(`[name="${name}"]`) ?? null;
      field?.focus();
    });
    item.append(anchor);
    list.append(item);
  }
  alertNode.replaceChildren(heading, list);
}

export function notices(): Element | null {
  return one('[data-studio-notices]');
}

export function notify(text: string): void {
  announce(notices(), text);
}

/** Announces first, so the notice is read before the screen is refreshed. */
export function notifyThenRefresh(text: string): void {
  notify(text);
  window.setTimeout(() => window.location.reload(), 1200);
}
