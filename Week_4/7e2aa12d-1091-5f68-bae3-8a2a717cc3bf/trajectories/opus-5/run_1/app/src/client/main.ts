import { checkLayoutName } from '../shared/accounts.js';
import type { LayoutObject } from '../shared/types.js';
import { keepFocusInside } from './dialog.js';
import { api } from './dom.js';
import { mountEditor } from './editor.js';
import { mountView } from './view.js';

interface Boot {
  page: 'signup' | 'signin' | 'library' | 'editor' | 'view' | 'not-available';
  username?: string;
  token?: string;
  layout?: LayoutObject;
}

const boot = (window as unknown as { __MULLION__: Boot }).__MULLION__;

function authForm(kind: 'signup' | 'signin'): void {
  const form = document.querySelector<HTMLFormElement>(`[data-auth-form="${kind}"]`);
  const alert = document.querySelector<HTMLElement>('[data-form-problem]');
  if (!form || !alert) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const reply = await api<{ message?: string }>(
      'POST',
      kind === 'signup' ? '/api/signup' : '/api/session',
      { username: String(data.get('username') ?? ''), password: String(data.get('password') ?? '') },
    );
    if (!reply) {
      alert.textContent = 'Mullion could not be reached. Your last change was not saved.';
      return;
    }
    if (reply.status === 200 || reply.status === 201) {
      const next = String(data.get('next') ?? '');
      window.location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/');
      return;
    }
    alert.textContent = reply.body.message ?? '';
  });
}

function library(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-dialog="new-layout"]');
  const opener = document.querySelector<HTMLButtonElement>('[data-new-layout]');
  const problem = dialog?.querySelector<HTMLElement>('[data-dialog-problem]');
  const nameField = dialog?.querySelector<HTMLInputElement>('[data-layout-name]');
  const create = dialog?.querySelector<HTMLButtonElement>('[data-create-layout]');
  const cancel = dialog?.querySelector<HTMLButtonElement>('[data-cancel]');
  const editProblem = document.querySelector<HTMLElement>('[data-edit-problem]');

  document.querySelector<HTMLButtonElement>('[data-sign-out]')?.addEventListener('click', async () => {
    await api('DELETE', '/api/session');
    window.location.assign('/signin');
  });

  if (!dialog || !opener || !problem || !nameField || !create || !cancel) return;

  keepFocusInside(dialog);
  opener.addEventListener('click', () => {
    problem.textContent = '';
    nameField.value = '';
    dialog.showModal();
    nameField.focus();
  });
  dialog.addEventListener('close', () => opener.focus());
  cancel.addEventListener('click', () => dialog.close());

  const submit = async (): Promise<void> => {
    const name = nameField.value;
    const nameProblem = checkLayoutName(name);
    if (nameProblem) {
      problem.textContent = nameProblem;
      return;
    }
    const template =
      dialog.querySelector<HTMLInputElement>('input[name="template"]:checked')?.value ?? 'blank';
    const reply = await api<{ id?: string; message?: string }>('POST', '/api/layouts', {
      name: name.trim(),
      template,
    });
    if (!reply) {
      problem.textContent = 'Mullion could not be reached. Your last change was not saved.';
      return;
    }
    if (reply.status !== 201 || !reply.body.id) {
      problem.textContent = reply.body.message ?? '';
      return;
    }
    window.location.assign(`/layouts/${reply.body.id}`);
  };

  create.addEventListener('click', () => void submit());
  nameField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });
  if (editProblem) editProblem.textContent = '';
}

function start(): void {
  const root = document.getElementById('app');
  switch (boot.page) {
    case 'signup':
    case 'signin':
      authForm(boot.page);
      return;
    case 'library':
      library();
      return;
    case 'editor':
      if (root && boot.layout && boot.username) {
        mountEditor(root, { username: boot.username, layout: boot.layout });
      }
      return;
    case 'view':
      if (root && boot.layout && boot.token) mountView(root, { token: boot.token, layout: boot.layout });
      return;
    case 'not-available':
      return;
  }
}

start();

