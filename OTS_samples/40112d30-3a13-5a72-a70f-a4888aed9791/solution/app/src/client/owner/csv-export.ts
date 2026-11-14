import { M60_61 } from '../../shared/messages.ts';
import { api, ApiFailure } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { alertText, announce } from '../lib/live.ts';

// `Export CSV` stores the file first; only then is it announced and `Download CSV` offered.

interface Stored { responses: number; url: string }

export function csvExport(formId: string): HTMLElement {
  const button = h('button', { type: 'button' }, 'Export CSV');
  const area = h('div', { class: 'actions' }, button);
  button.addEventListener('click', () => { void store(formId, button, area); });
  return area;
}

async function store(formId: string, button: HTMLElement, area: HTMLElement): Promise<void> {
  button.setAttribute('aria-busy', 'true');
  area.querySelector('.export-error')?.remove();
  try {
    const stored = await api<Stored>('POST', `/api/forms/${formId}/exports`, {});
    showDownload(area, stored.url);
    announce(M60_61(stored.responses));
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    area.append(h('p', { class: 'error-text export-error' }, failure.message));
    alertText(failure.message);
  } finally {
    button.removeAttribute('aria-busy');
  }
}

function showDownload(area: HTMLElement, url: string): void {
  const existing = area.querySelector('a');
  if (existing) existing.setAttribute('href', url);
  else area.append(h('a', { href: url }, 'Download CSV'));
}
