import type { Page } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';
import type { Context } from './context.ts';
import { commit } from './commit.ts';
import { KeyedList } from './keyed.ts';

// The pages pane: the pages as plain text, the current one in ink, and Add page.

export function pagesPane(context: Context): HTMLElement {
  const { store } = context;
  const list = h('ul', { class: 'page-list' });
  const pages = new KeyedList<Page>(list, {
    key: (page) => page.key,
    create: (page) => {
      const button = h('button', { type: 'button', class: 'page-button' });
      button.addEventListener('click', () => store.select({ page: page.key, question: null }));
      return h('li', {}, button);
    },
    update: (item, page) => {
      const button = item.querySelector('button');
      if (!button) return;
      button.textContent = page.title || page.key;
      button.setAttribute('aria-pressed', String(store.selection.page === page.key));
    },
  });
  const add = h('button', { type: 'button' }, 'Add page');
  add.addEventListener('click', () => { void addPage(context); });
  const render = (): void => pages.render(store.draft.pages);
  store.drafted.listen(render);
  store.selected.listen(render);
  render();
  return h('nav', { 'aria-label': 'Pages', class: 'pages-pane' }, h('h2', {}, 'Pages'), list, add);
}

async function addPage(context: Context): Promise<void> {
  const { store } = context;
  const used = new Set([...store.draft.pages.map((page) => page.key), ...store.questions().map((question) => question.key)]);
  let number = store.draft.pages.length + 1;
  while (used.has(`page_${number}`)) number += 1;
  const page: Page = { key: `page_${number}`, title: `Page ${number}`, questions: [] };
  const added = await commit(context, { op: 'add_page', page, position: store.draft.pages.length + 1, base_rev: store.rev }, () => undefined);
  if (added) store.select({ page: page.key, question: null });
}
