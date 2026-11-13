import { apiSend, ApiFailure } from '../api.js';
import { clear, el } from '../dom.js';
import { mountServiceNotice } from '../notice.js';

export function renderDeskSignIn(root: HTMLElement): void {
  clear(root);
  const page = el('div', { class: 'page page-desk' });
  root.append(page);
  mountServiceNotice(page);

  const field = el('input', { type: 'password', id: 'passcode', class: 'text-field' });
  const error = el('p', { class: 'field-error', role: 'status', 'aria-live': 'polite' });
  const button = el('button', { type: 'submit', class: 'button button-primary' }, ['Sign in']);

  const form = el('form', { class: 'sheet sign-in' }, [
    el('h1', { class: 'kit-name' }, ['Northbar desk']),
    el('label', { class: 'field', for: 'passcode' }, [
      el('span', { class: 'field-label' }, ['Passcode']),
      field,
    ]),
    error,
    button,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.textContent = '';
    void (async () => {
      try {
        const session = await apiSend<{ role: 'owner' | 'prep_tech' }>('POST', '/api/session', {
          passcode: field.value,
        });
        window.location.assign(session.role === 'owner' ? '/desk/owner' : '/desk/counter');
      } catch (failure) {
        if (!(failure instanceof ApiFailure)) throw failure;
        error.textContent = failure.controlMessage();
      }
    })();
  });

  page.append(form);
}

export function signOutButton(): HTMLElement {
  const button = el('button', { type: 'button', class: 'button' }, ['Sign out']);
  button.addEventListener('click', () => {
    void (async () => {
      try {
        await apiSend<void>('DELETE', '/api/session', {});
      } finally {
        window.location.assign('/desk');
      }
    })();
  });
  return button;
}
