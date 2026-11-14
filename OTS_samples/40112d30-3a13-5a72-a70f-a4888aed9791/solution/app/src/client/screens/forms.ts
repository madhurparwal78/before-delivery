import { api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { frame, ready } from '../lib/shell.ts';
import { formList, type FormLine } from '../owner/form-list.ts';
import { openNewFormDialog } from '../owner/new-form-dialog.ts';

const fetchForms = async (): Promise<FormLine[]> => (await api<{ forms: FormLine[] }>('GET', '/api/forms')).forms;

export async function render(): Promise<void> {
  const main = frame({ owner: true });
  main.classList.add('owner-screen');
  const title = h('h1', { tabindex: '-1' }, 'Forms');
  const create = h('button', { type: 'button' }, 'New form');
  let list = formList(await fetchForms());
  const showCreated = async (id: string): Promise<void> => {
    const refreshed = formList(await fetchForms());
    list.replaceWith(refreshed);
    list = refreshed;
    list.querySelector<HTMLElement>(`a[href="/forms/${id}/edit"]`)?.focus();
  };
  create.addEventListener('click', () => openNewFormDialog(create, showCreated));
  ready(main, 'Forms - Nightform');
  main.append(title, h('p', {}, create), list);
}
