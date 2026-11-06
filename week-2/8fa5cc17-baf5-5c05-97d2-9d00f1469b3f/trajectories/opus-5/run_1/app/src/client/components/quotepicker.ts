import { api } from '../api';
import { clear, el } from '../dom';
import { DialogHandle, openDialog } from './dialog';
import { BlockSearchResultDto } from '../types';
import { matchingBlocksCopy } from '../../shared/copy';
import { SEARCH_DEBOUNCE_MS } from '../../shared/motion';

export type QuotePickerOptions = {
  excludeObjectId: string;
  opener: HTMLElement;
  onChoose: (result: BlockSearchResultDto, row: HTMLElement) => void;
  onCancel: () => void;
};

/** The picker only ever lists results for the text now in its search box. */
export function openQuotePicker(options: QuotePickerOptions): DialogHandle {
  let active = 0;
  let results: BlockSearchResultDto[] = [];
  let sequence = 0;
  let answered = -1;
  let timer = 0;
  let chose = false;

  const search = el('input', {
    className: 'picker-search',
    attrs: { type: 'text', role: 'combobox', 'aria-label': 'Search blocks', 'aria-expanded': 'true', autocomplete: 'off' },
  });
  const list = el('div', { className: 'picker-list', attrs: { role: 'listbox', 'aria-label': 'Matching blocks' } });
  const status = el('div', {
    className: 'picker-status',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Picker results' },
  });
  const error = el('div', { className: 'picker-error' });

  const handle = openDialog({
    label: 'Quote a block',
    className: 'quote-picker',
    opener: options.opener,
    content: () => [search, list, error, status],
    onClose: () => {
      if (timer !== 0) window.clearTimeout(timer);
      if (!chose) options.onCancel();
    },
  });

  function renderList(): void {
    clear(list);
    results.forEach((result, index) => {
      const option = el('div', {
        className: 'picker-option',
        text: `${result.object_title}: ${result.excerpt}`,
        attrs: { role: 'option', 'aria-selected': index === active ? 'true' : 'false', tabindex: '-1' },
      });
      option.addEventListener('click', () => choose(index));
      list.append(option);
    });
    status.textContent = matchingBlocksCopy(results.length);
  }

  function choose(index: number): void {
    const result = results[index];
    if (result === undefined) return;
    const row = list.children[index] as HTMLElement;
    chose = true;
    handle.close();
    options.onChoose(result, row);
  }

  async function run(text: string): Promise<void> {
    const mine = ++sequence;
    const query = new URLSearchParams({ q: text, exclude_object_id: options.excludeObjectId });
    const result = await api.get<{ results: BlockSearchResultDto[] }>(`/api/blocks/search?${query.toString()}`);
    if (mine < answered) return;
    if (search.value !== text) return;
    answered = mine;
    if (!result.ok) {
      error.textContent = result.errors?.['q'] ?? '';
      results = [];
      renderList();
      return;
    }
    error.textContent = '';
    results = result.data.results;
    active = 0;
    renderList();
  }

  search.addEventListener('input', () => {
    if (timer !== 0) window.clearTimeout(timer);
    const text = search.value;
    timer = window.setTimeout(() => void run(text), SEARCH_DEBOUNCE_MS);
  });

  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length > 0) active = (active + 1) % results.length;
      renderList();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length > 0) active = (active - 1 + results.length) % results.length;
      renderList();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  });

  void run('');
  return handle;
}
