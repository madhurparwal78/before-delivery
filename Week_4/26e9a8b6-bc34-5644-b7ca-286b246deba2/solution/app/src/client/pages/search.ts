import { ApiFailure, get, readLimits } from '../api';
import { searchStatus } from '../../shared/copy';
import type { Limits, SearchItem } from '../../shared/types';
import { h, replace } from '../dom';
import { Status } from '../status';

interface Page { items: SearchItem[]; total: number; next_cursor: string | null }

const DEBOUNCE_MS = 250;

export function mountSearch(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  let query = params.get('q') ?? '';
  const tags = params.getAll('tag');
  let items: SearchItem[] = [];
  let cursor: string | null = null;
  let timer = 0;
  let serial = 0;
  let limits: Limits | null = null;
  void readLimits().then((l) => (limits = l));

  const status = new Status('Search status', 'status');
  const box = h('input', { id: 'search-box', type: 'search', class: 'field-input', 'aria-label': 'Search guides', autocomplete: 'off', value: query });
  const combo = h('input', {
    id: 'tag-box', type: 'text', class: 'field-input', role: 'combobox', 'aria-label': 'Filter by tag', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
    'aria-controls': 'tag-options', autocomplete: 'off',
  });
  const options = h('ul', { id: 'tag-options', class: 'combo-list', role: 'listbox', 'aria-label': 'Tag suggestions', hidden: true });
  const chips = h('ul', { class: 'tag-chips' });
  const count = h('p', { class: 'result-count', 'data-figure': 'result-count' }, '0');
  const list = h('ul', { class: 'result-rows' });
  const more = h('button', { type: 'button', class: 'button', hidden: true }, 'Load more');
  let suggestions: string[] = [];
  let active = -1;

  root.append(h('main', { class: 'search-page' },
    h('a', { class: 'wordmark', href: '/' }, 'Pennywasher'),
    h('h1', { class: 'page-title' }, 'Find a guide'),
    h('div', { class: 'form search-form' },
      h('label', { class: 'cell', for: 'search-box' }, h('span', { class: 'cell-label' }, 'Search guides'), box),
      h('div', { class: 'cell combo' }, h('label', { class: 'cell-label', for: 'tag-box' }, 'Filter by tag'), combo, options)),
    chips, status.element, count, list, more));

  const urlFor = () => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    for (const tag of tags) next.append('tag', tag);
    return next.toString() ? `?${next}` : location.pathname;
  };

  function renderChips(): void {
    replace(chips, ...tags.map((tag) => {
      const chip = h('button', { type: 'button', class: 'tag-chip', 'aria-label': `Remove tag ${tag}` }, tag, h('span', { 'aria-hidden': 'true' }, '×'));
      chip.addEventListener('click', () => {
        tags.splice(tags.indexOf(tag), 1);
        renderChips();
        void run();
      });
      return h('li', {}, chip);
    }));
  }

  function renderItems(): void {
    replace(list, ...items.map((item) =>
      h('li', { class: 'result-row' }, h('a', { href: `/g/${item.slug}` },
        h('span', { class: 'result-title' }, item.title),
        h('span', { class: 'result-meta' }, `${item.author_name} · ${item.step_count} steps · ${item.parts_cost_text} · ${item.tags.join(', ')}`)))));
    more.hidden = cursor === null;
  }

  async function run(append = false): Promise<void> {
    const mine = ++serial;
    status.set(searchStatus.searching);
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    for (const tag of tags) search.append('tag', tag);
    if (append && cursor) search.set('cursor', cursor);
    try {
      const page = await get<Page>(`/api/search?${search}`);
      if (mine !== serial) return;
      items = append ? [...items, ...page.items] : page.items;
      cursor = page.next_cursor;
      count.textContent = String(page.total);
      status.set(page.total === 0 ? searchStatus.none : searchStatus.found(page.total));
      renderItems();
    } catch (error) {
      if (mine !== serial) return;
      const lim = limits ?? (await readLimits());
      if (error instanceof ApiFailure && error.code === 'query_too_long') status.set(searchStatus.queryTooLong(lim.search_query_max), 'error');
      else if (error instanceof ApiFailure && error.code === 'too_many_tags') status.set(searchStatus.tooManyTags(lim.search_tag_max), 'error');
      else status.set(searchStatus.timeout, 'error');
    }
    history.replaceState(null, '', urlFor());
  }

  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      query = box.value;
      void run();
    }, DEBOUNCE_MS);
  });
  more.addEventListener('click', () => void run(true));

  function close(): void {
    options.hidden = true;
    combo.setAttribute('aria-expanded', 'false');
    combo.removeAttribute('aria-activedescendant');
    active = -1;
  }
  function renderOptions(): void {
    replace(options, ...suggestions.map((tag, i) => {
      const option = h('li', { id: `tag-option-${i}`, class: 'combo-option', role: 'option', 'aria-selected': String(i === active) }, tag);
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        add(tag);
      });
      return option;
    }));
    options.hidden = suggestions.length === 0;
    combo.setAttribute('aria-expanded', String(suggestions.length > 0));
    if (active >= 0) combo.setAttribute('aria-activedescendant', `tag-option-${active}`);
    else combo.removeAttribute('aria-activedescendant');
  }
  function add(raw: string): void {
    const tag = raw.trim().toLowerCase();
    if (tag === '') return;
    if (!tags.includes(tag)) tags.push(tag);
    combo.value = '';
    suggestions = [];
    close();
    renderChips();
    void run();
  }
  let suggestTimer = 0;
  combo.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(async () => {
      const found = await get<{ items: string[] }>(`/api/tags?prefix=${encodeURIComponent(combo.value.trim())}`).catch(() => ({ items: [] as string[] }));
      suggestions = combo.value.trim() === '' ? [] : found.items.filter((t) => !tags.includes(t));
      active = -1;
      renderOptions();
    }, DEBOUNCE_MS - 50);
  });
  combo.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      renderOptions();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      add(active >= 0 ? suggestions[active]! : combo.value);
    } else if (event.key === 'Backspace' && combo.value === '' && tags.length) {
      tags.pop();
      renderChips();
      void run();
    } else if (event.key === 'Escape') close();
  });
  combo.addEventListener('blur', close);
  renderChips();
  void run();
}
