import { COPY, SEARCH_STATUS } from '../../shared/copy';
import type { SearchResult } from '../../shared/types';
import { call } from '../lib/api';
import { el } from '../lib/dom';
import { requestRender, state } from '../store';
import { openCard } from '../navigation';

const SETTLE_MS = 250;

let sequence = 0;
let timer: number | null = null;

function sentenceFor(total: number, query: string): string {
  if (total === 0) return SEARCH_STATUS.none(query);
  if (total === 1) return SEARCH_STATUS.one(query);
  if (total > 50) return SEARCH_STATUS.capped(total, query);
  return SEARCH_STATUS.many(total, query);
}

export function searchFor(text: string): void {
  state.search.text = text;
  const points = [...text];
  sequence += 1;
  const mine = sequence;
  if (timer !== null) window.clearTimeout(timer);
  if (points.length < 2) {
    state.search.results = [];
    state.search.status = '';
    requestRender();
    return;
  }
  if (points.length > 100) {
    state.search.results = [];
    state.search.status = COPY.searchLimit;
    requestRender();
    return;
  }
  requestRender();
  timer = window.setTimeout(() => {
    const workspace = state.workspace;
    if (workspace === null) return;
    void (async () => {
      try {
        const reply = await call<{ results: SearchResult[]; total: number }>(
          `/api/workspaces/${workspace.id}/search?q=${encodeURIComponent(text)}`,
        );
        if (mine !== sequence || state.search.text !== text) return;
        state.search.results = reply.results;
        state.search.status = sentenceFor(reply.total, text);
        requestRender();
      } catch {
        if (mine !== sequence || state.search.text !== text) return;
        state.search.results = [];
        state.search.status = '';
        requestRender();
      }
    })();
  }, SETTLE_MS);
}

export function clearSearch(): void {
  sequence += 1;
  if (timer !== null) window.clearTimeout(timer);
  state.search = { text: '', results: [], status: '' };
  requestRender();
}

export function renderSearch(): HTMLElement {
  const wrap = el('div', { class: 'search' });
  wrap.append(
    el('input', {
      class: 'search-box',
      focusKey: 'search',
      attrs: {
        type: 'text',
        role: 'searchbox',
        'aria-label': 'Search this workspace',
        placeholder: 'Search cards',
        value: state.search.text,
      },
      on: {
        input: (event: Event) => searchFor((event.target as HTMLInputElement).value),
        keydown: (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            clearSearch();
          }
        },
      },
    }),
  );
  const results = el('div', { class: 'search-results', attrs: { role: 'region', 'aria-label': 'Search results' } });
  for (const result of state.search.results) {
    results.append(
      el('a', {
        text: result.title,
        focusKey: `result:${result.cardId}`,
        attrs: { href: `/cards/${result.cardId}` },
        on: {
          click: (event: MouseEvent) => {
            event.preventDefault();
            openCard(result.cardId);
          },
        },
      }),
    );
  }
  wrap.append(results);
  wrap.append(
    el('div', {
      class: 'visually-hidden',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Search results status' },
      text: state.search.status,
    }),
  );
  return wrap;
}
