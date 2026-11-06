import { get } from './api.js';
import { clear, el, formatCents } from './dom.js';
import { openDialog } from './ui.js';
import type { ApiErrorBody } from './api.js';

interface SearchResult {
  sku: string;
  name: string;
  price_cents: number;
}

export function openSearchDialog(opener: HTMLElement): void {
  const input = el('input', { type: 'search', class: 'search-input', 'aria-label': 'Search the catalog' });
  const errorId = 'search-error';
  const error = el('p', { class: 'field-error', id: errorId, hidden: true });
  const results = el('ul', { 'aria-label': 'Search results', class: 'stack', style: 'list-style:none;padding:0' });
  const empty = el('p', { class: 'muted', hidden: true }, 'No matches.');

  let token = 0;
  const run = async (): Promise<void> => {
    const mine = ++token;
    const query = input.value.trim();
    if (query.length < 2) {
      clear(results);
      empty.hidden = true;
      error.hidden = true;
      return;
    }
    const response = await get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
    if (mine !== token) return;
    if (!response.ok) {
      const body = response.body as unknown as ApiErrorBody;
      error.textContent = body.fields?.q ?? body.message;
      error.hidden = false;
      input.setAttribute('aria-errormessage', errorId);
      clear(results);
      empty.hidden = true;
      return;
    }
    error.hidden = true;
    input.removeAttribute('aria-errormessage');
    clear(results);
    for (const item of response.body.results) {
      results.appendChild(el('li', {}, `${item.name} — ${formatCents(item.price_cents)}`));
    }
    empty.hidden = response.body.results.length > 0;
  };

  input.addEventListener('input', () => void run());

  openDialog({
    title: 'Search',
    opener,
    content: [
      el('div', { class: 'field' }, [input, error]),
      results,
      empty,
    ],
  });
  input.focus();
}
