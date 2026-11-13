import { el, announce } from '../dom.js';
import { api } from '../api.js';
import { openDialog } from '../dialogs.js';
import { navigate } from '../router.js';
import { state, loadLists, loadCloset, currentUnit, currentGoalGrams, loadProfile } from '../main.js';
import type { ListSummary, TripList, Item, Share, PackSheet } from '../apiTypes.js';
import { renderWorkspaceContent } from './workspace.js';
import { formatWeight } from '../../domain/format.js';

/** The Trips page: every list as a ruled row, newest first. */
export async function renderTrips(page: HTMLElement): Promise<void> {
  await loadLists();
  page.textContent = '';
  page.append(el('h1', { text: 'Trips' }));
  const actions = el('div', { class: 'page-head' });
  const newButton = el('button', { type: 'button', text: 'New trip list' });
  newButton.addEventListener('click', () => openNewListDialog(newButton));
  actions.append(newButton);
  page.append(actions);

  const table = el('table', { class: 'ledger', 'aria-label': 'Trips' });
  const body = el('tbody');
  for (const list of state.lists) {
    const row = el('tr');
    const link = el('a', { href: `/lists/${list.id}`, text: list.name });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(`/lists/${list.id}`);
    });
    row.append(el('td', {}, [link]), el('td', { text: list.state }), el('td', { class: 'mono', text: list.totals.display.base }));
    body.append(row);
  }
  table.append(body);
  page.append(table);
}

function openNewListDialog(opener: HTMLElement): void {
  const nameError = el('div', { class: 'field-error', hidden: 'hidden' });
  openDialog('New trip list', (dialog) => {
    const input = el('input', { id: 'new-list-name', type: 'text' }) as HTMLInputElement;
    const create = el('button', { type: 'button', text: 'Create list' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { class: 'field-label', for: 'new-list-name', text: 'List name' }), input, nameError);
    dialog.append(wrap, el('div', { class: 'actions' }, [create, cancel]));
    create.addEventListener('click', () => {
      void (async () => {
        nameError.setAttribute('hidden', 'hidden');
        const answer = await api.post<{ list: TripList }>('/api/lists', { name: input.value });
        if (!answer.ok) {
          const message = answer.failure.fields?.['name'];
          if (message !== undefined) {
            nameError.textContent = message;
            nameError.removeAttribute('hidden');
            input.focus();
          }
          return;
        }
        dialog.remove();
        navigate(`/lists/${answer.body.list.id}`);
      })();
    });
    cancel.addEventListener('click', () => {
      dialog.remove();
      opener.focus();
    });
  }, opener);
}

/** The trip workspace: totals, actions, three zones and Pack Strata. */
export async function renderWorkspace(page: HTMLElement, listId: string): Promise<void> {
  await loadCloset();
  await loadProfile();
  const list = await (await import('../main.js')).loadList(listId);
  if (list === null) {
    page.append(el('h1', { text: 'List not found' }));
    return;
  }
  await renderWorkspaceContent(page, list);
}

export { renderWorkspaceContent };
