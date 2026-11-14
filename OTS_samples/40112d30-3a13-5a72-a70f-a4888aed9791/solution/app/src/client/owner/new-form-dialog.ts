import { api, ApiFailure } from '../lib/api.ts';
import { dialogShell, openDialog } from '../lib/dialog.ts';
import { h } from '../lib/dom.ts';
import { textField, type Field } from './fields.ts';
import { clearFailure, showFailure } from './failure.ts';

// `New form` asks for a title; the new draft joins the list.

export function openNewFormDialog(opener: HTMLElement, onCreated: (id: string) => Promise<void>): void {
  const title = textField({ name: 'title', label: 'Form title' });
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const form = h('form', { novalidate: true }, title.row,
    h('div', { class: 'actions dialog-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Create form'), cancel));
  const { close } = openDialog(dialogShell('New form', form), opener);
  cancel.addEventListener('click', close);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void create(form, title, close, onCreated);
  });
}

async function create(form: HTMLFormElement, title: Field, close: () => void, onCreated: (id: string) => Promise<void>): Promise<void> {
  clearFailure(form, [title]);
  let created: { id: string };
  try {
    created = await api<{ id: string }>('POST', '/api/forms', { title: title.input.value });
  } catch (failure) {
    if (failure instanceof ApiFailure) return showFailure(form, [title], failure);
    throw failure;
  }
  close();
  await onCreated(created.id);
}
