// Search: results on bone, count set huge, query and tags live in the address.

import { el, announce, codePoints } from '../dom';
import { api, ApiError } from '../api';
import { COPY } from '../../shared/copy';
import { pageTimeout } from '../clock';

interface SearchResult {
  id: string;
  slug: string;
  title: string;
  author_name: string;
  tags: string[];
  like_count: number;
  step_count: number;
  parts_cost_text: string;
}

interface SearchJson {
  items: SearchResult[];
  total: number;
  next_cursor: string | null;
}

export function renderSearch(main: HTMLElement): void {
  main.textContent = '';
  const column = el('div', { class: 'search-column' });
  const searchBox = el('input', { type: 'search', class: 'pw-field', 'aria-label': 'Search guides' }) as HTMLInputElement;
  const tagBox = el('input', { type: 'text', role: 'combobox', 'aria-label': 'Filter by tag', 'aria-expanded': 'false' }) as HTMLInputElement;
  const tagsRow = el('div', { class: 'dialog__row', 'aria-label': 'Chosen tags' });
  const searchStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'search' });
  const resultCount = el('div', { class: 'search-count display', 'data-figure': 'result-count' }, '0');
  const results = el('div', { class: 'search-results' });
  const loadMore = el('button', { class: 'pw-btn' }, 'Load more');
  column.append(searchBox, tagBox, tagsRow, resultCount, searchStatus, results, loadMore);
  main.append(column);

  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') ?? '';
  const tags = params.getAll('tag');
  searchBox.value = query;
  for (const tag of tags) addTagChip(tag);

  let searchTimer: (() => void) | null = null;
  let lastCursor: string | null = null;

  const runSearch = async (): Promise<void> => {
    const q = searchBox.value.trim();
    const activeTags = [...tagsRow.querySelectorAll('[data-tag]')].map((node) => (node as HTMLElement).dataset.tag ?? '');
    searchStatus.textContent = COPY.search.searching;
    try {
      const search = new URLSearchParams();
      if (q.length > 0) search.set('q', q);
      for (const tag of activeTags) search.append('tag', tag);
      const data = await api<SearchJson>(`/api/search?${search.toString()}`);
      results.textContent = '';
      for (const item of data.items) {
        const row = el('a', { class: 'search-result', href: `/g/${item.slug}` });
        row.append(el('span', { class: 'search-result-title' }, item.title));
        row.append(el('span', { class: 'search-result-meta' }, `${item.author_name} - ${item.step_count} steps - ${item.parts_cost_text}`));
        results.append(row);
      }
      resultCount.textContent = String(data.total);
      searchStatus.textContent = data.total === 0 ? COPY.search.none : data.total === 1 ? COPY.search.foundOne : COPY.search.found(data.total);
      lastCursor = data.next_cursor;
      if (data.next_cursor === null) loadMore.setAttribute('aria-disabled', 'true');
      else loadMore.removeAttribute('aria-disabled');
      // The query and tags live in the address, with no history entry.
      const address = `/search${search.toString().length > 0 ? `?${search.toString()}` : ''}`;
      window.history.replaceState(null, '', address);
    } catch (error) {
      const err = error as ApiError;
      if (err.code === 'query_too_long') searchStatus.textContent = COPY.search.queryTooLong(Number(err.body.limit ?? 0));
      else if (err.code === 'too_many_tags') searchStatus.textContent = COPY.search.tooManyTags(Number(err.body.limit ?? 0));
      else if (err.code === 'search_timeout') searchStatus.textContent = COPY.search.timeout;
    }
  };

  // Typing runs the search 250 ms after the last keystroke.
  searchBox.addEventListener('input', () => {
    searchTimer?.();
    searchTimer = pageTimeout(() => {
      void runSearch();
    }, 250);
  });

  // The tag combobox: arrows move in options, Enter adds, Backspace on empty removes the last.
  const optionsPopup = el('ul', { class: 'tag-options', role: 'listbox', 'aria-label': 'Tag options' });
  optionsPopup.style.display = 'none';
  column.append(optionsPopup);
  let highlightIndex = -1;
  const showOptions = async (): Promise<void> => {
    const prefix = tagBox.value.trim().toLowerCase();
    try {
      const data = await api<{ items: string[] }>(`/api/tags?prefix=${encodeURIComponent(prefix)}`);
      optionsPopup.textContent = '';
      data.items.forEach((tag, index) => {
        const option = el('li', { role: 'option', 'aria-selected': String(index === highlightIndex) }, tag);
        optionsPopup.append(option);
      });
      optionsPopup.style.display = data.items.length > 0 ? 'block' : 'none';
      tagBox.setAttribute('aria-expanded', String(data.items.length > 0));
    } catch {
      optionsPopup.style.display = 'none';
    }
  };

  tagBox.addEventListener('input', () => {
    highlightIndex = -1;
    void showOptions();
  });
  tagBox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const options = [...optionsPopup.children];
      if (options.length === 0) return;
      highlightIndex = event.key === 'ArrowDown'
        ? Math.min(options.length - 1, highlightIndex + 1)
        : Math.max(0, highlightIndex - 1);
      options.forEach((option, index) => option.setAttribute('aria-selected', String(index === highlightIndex)));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const options = [...optionsPopup.children];
      const chosen = highlightIndex >= 0 ? options[highlightIndex].textContent : tagBox.value.trim();
      if (chosen && chosen.length > 0) {
        addTagChip(chosen);
        tagBox.value = '';
        optionsPopup.style.display = 'none';
        void runSearch();
      }
      return;
    }
    if (event.key === 'Backspace' && tagBox.value.length === 0) {
      const chips = [...tagsRow.querySelectorAll('[data-tag]')];
      const last = chips[chips.length - 1];
      if (last) {
        last.remove();
        void runSearch();
      }
    }
  });

  function addTagChip(tag: string): void {
    const chip = el('span', { class: 'pw-chip', 'data-tag': tag }, tag);
    const remove = el('button', { class: 'pw-chip-remove', 'aria-label': `Remove tag ${tag}` }, 'x');
    remove.addEventListener('click', () => {
      chip.remove();
      void runSearch();
    });
    chip.append(remove);
    tagsRow.append(chip);
  }

  loadMore.addEventListener('click', async () => {
    if (lastCursor === null) return;
    const q = searchBox.value.trim();
    const activeTags = [...tagsRow.querySelectorAll('[data-tag]')].map((node) => (node as HTMLElement).dataset.tag ?? '');
    const search = new URLSearchParams();
    if (q.length > 0) search.set('q', q);
    for (const tag of activeTags) search.append('tag', tag);
    search.set('cursor', lastCursor);
    const data = await api<SearchJson>(`/api/search?${search.toString()}`);
    for (const item of data.items) {
      const row = el('a', { class: 'search-result', href: `/g/${item.slug}` });
      row.append(el('span', { class: 'search-result-title' }, item.title));
      row.append(el('span', { class: 'search-result-meta' }, `${item.author_name} - ${item.step_count} steps - ${item.parts_cost_text}`));
      results.append(row);
    }
    lastCursor = data.next_cursor;
    if (data.next_cursor === null) loadMore.setAttribute('aria-disabled', 'true');
  });

  if (query.length > 0 || tags.length > 0) {
    void runSearch();
  } else {
    void runSearch();
  }
  void announce;
  void codePoints;
}
