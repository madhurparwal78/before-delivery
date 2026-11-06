// The sign-in and diagrams screens, with their dialogs.

import { apiGet, apiPost, setCsrfToken, validNext, decodeNextParam, NetworkError, ApiRequestError } from './api.js';
import { SessionUser } from './api.js';
import { COPY } from '../shared/constants.js';
import { h } from './hyperscript.js';
import { encodeNext, navigate, signOut, state } from './app.js';
import { openDialog } from './dialogs.js';

export function renderSignIn(): HTMLElement {
  const main = h('main', { class: 'signin-screen' });
  const card = h('div', { class: 'card' });
  const title = h('h1', { class: 'product-name' }, 'Scopewright');
  const errorAlert = h('div', { role: 'alert', class: 'alert hidden' });
  const email = h('input', { type: 'email', id: 'signin-email', class: 'field' }) as HTMLInputElement;
  const emailLabel = h('label', { for: 'signin-email' }, 'Email');
  const password = h('input', { type: 'password', id: 'signin-password', class: 'field', autocomplete: 'current-password' }) as HTMLInputElement;
  const passwordLabel = h('label', { for: 'signin-password' }, 'Password');
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');
  const form = h('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault();
      submit.textContent = 'Sign in';
      errorAlert.classList.add('hidden');
      try {
        const resp = await apiPost('/api/session', { email: email.value, password: password.value }) as { user: SessionUser; csrfToken: string };
        state.user = resp.user;
        setCsrfToken(resp.csrfToken);
        const params = new URLSearchParams(location.search);
        const next = validNext(decodeNextParam(params.get('next') ?? ''));
        navigate(next ?? '/', true);
      } catch (err) {
        if (err instanceof NetworkError) {
          errorAlert.textContent = COPY.genericFailureBanner;
        } else if (err instanceof ApiRequestError) {
          if (err.code === 'signin_locked') {
            errorAlert.textContent = COPY.signInLocked;
          } else {
            errorAlert.textContent = COPY.signInIncorrect;
          }
        } else {
          errorAlert.textContent = COPY.genericFailureBanner;
        }
        errorAlert.classList.remove('hidden');
      }
    },
  }, emailLabel, email, passwordLabel, password, submit);
  card.append(title, errorAlert, form);
  main.appendChild(card);
  email.focus();
  return main;
}

interface DiagramSummary {
  id: string;
  title: string;
  role: 'owner' | 'editor' | 'viewer';
  updatedAt: string;
}

export function renderDiagrams(user: SessionUser): HTMLElement {
  void user;
  const main = h('main', { class: 'diagrams-screen' });
  const announcements = h('div', { role: 'status', 'aria-live': 'polite', id: 'announcements', class: 'sr-only' });
  const heading = h('h1', {}, 'Diagrams');
  const list = h('ul', { role: 'list', 'aria-label': 'Your diagrams', class: 'diagram-list' });
  const buttonsRow = h('div', { class: 'diagram-actions' });
  const newDiagram = h('button', { onclick: () => openNewDiagramDialog(announcements) }, 'New diagram');
  const changePassword = h('button', { onclick: () => openChangePasswordDialog(announcements) }, 'Change password');
  const signOutButton = h('button', { onclick: () => void signOut() }, 'Sign out');
  buttonsRow.append(newDiagram, changePassword, signOutButton);

  main.append(heading, list, buttonsRow, announcements);

  void loadDiagrams(list);
  return main;
}

async function loadDiagrams(list: HTMLElement): Promise<void> {
  try {
    const resp = await apiGet('/api/diagrams') as { diagrams: DiagramSummary[] };
    list.innerHTML = '';
    for (const diagram of resp.diagrams) {
      const roleText = diagram.role === 'owner' ? 'Owner' : diagram.role === 'editor' ? 'Editor' : 'Viewer';
      const link = h('a', { href: `/d/${diagram.id}`, onclick: (e: Event) => { e.preventDefault(); navigate(`/d/${diagram.id}`); } }, diagram.title);
      const item = h('li', { class: 'diagram-item' },
        link,
        h('span', { class: 'diagram-role' }, roleText),
        h('span', { class: 'diagram-updated mono' }, diagram.updatedAt),
      );
      list.appendChild(item);
    }
  } catch {
    list.innerHTML = '';
  }
}

export function openNewDiagramDialog(announcements: HTMLElement): void {
  const title = h('input', { type: 'text', class: 'field', id: 'new-diagram-title' }) as HTMLInputElement;
  const error = h('div', { class: 'field-error hidden' });
  const create = h('button', {
    class: 'primary',
    onclick: async () => {
      error.classList.add('hidden');
      create.setAttribute('disabled', '');
      try {
        const resp = await apiPost('/api/diagrams', { title: title.value }) as {
          diagram: { id: string; pages: { id: string }[] };
        };
        const firstPage = resp.diagram.pages[0].id;
        handle.close();
        navigate(`/d/${resp.diagram.id}/p/${firstPage}`);
      } catch (err) {
        create.removeAttribute('disabled');
        if (err instanceof ApiRequestError && err.code === 'validation') {
          error.textContent = 'Enter a title.';
          error.classList.remove('hidden');
        } else {
          announcements.textContent = COPY.genericFailureBanner;
        }
      }
    },
  }, 'Create diagram');
  const dialog = h('div', { class: 'dialog-body' },
    h('h2', {}, 'New diagram'),
    h('label', { for: 'new-diagram-title' }, 'Title'),
    title,
    error,
    h('div', { class: 'dialog-actions' }, create),
  );
  const handle = openDialog('New diagram', dialog, {
    firstFocus: () => title.focus(),
  });
}

export function openChangePasswordDialog(announcements: HTMLElement): void {
  const current = h('input', { type: 'password', class: 'field', id: 'cp-current' }) as HTMLInputElement;
  const currentLabel = h('label', { for: 'cp-current' }, 'Current password');
  const fresh = h('input', { type: 'password', class: 'field', id: 'cp-new' }) as HTMLInputElement;
  const freshLabel = h('label', { for: 'cp-new' }, 'New password');
  const currentError = h('div', { class: 'field-error hidden' });
  const newError = h('div', { class: 'field-error hidden' });
  const lockAlert = h('div', { role: 'alert', class: 'alert hidden' });
  const save = h('button', {
    class: 'primary',
    onclick: async () => {
      currentError.classList.add('hidden');
      newError.classList.add('hidden');
      lockAlert.classList.add('hidden');
      try {
        const resp = await apiPost('/api/session/password', { currentPassword: current.value, newPassword: fresh.value }) as { csrfToken: string };
        setCsrfToken(resp.csrfToken);
        handle.close();
        announcements.textContent = COPY.passwordChanged;
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.code === 'validation') {
            const fields = err.fields ?? {};
            if (fields.currentPassword !== undefined) {
              currentError.textContent = COPY.currentPasswordIncorrect;
              currentError.classList.remove('hidden');
            } else if (fields.newPassword === 'length') {
              newError.textContent = COPY.passwordLength;
              newError.classList.remove('hidden');
            } else if (fields.newPassword === 'unchanged') {
              newError.textContent = COPY.passwordUnchanged;
              newError.classList.remove('hidden');
            }
          } else if (err.code === 'signin_locked') {
            lockAlert.textContent = COPY.signInLocked;
            lockAlert.classList.remove('hidden');
          } else {
            announcements.textContent = COPY.genericFailureBanner;
          }
        } else {
          announcements.textContent = COPY.genericFailureBanner;
        }
      }
    },
  }, 'Save password');
  const dialog = h('div', { class: 'dialog-body' },
    h('h2', {}, 'Change password'),
    lockAlert,
    currentLabel, current, currentError,
    freshLabel, fresh, newError,
    h('div', { class: 'dialog-actions' }, save),
  );
  const handle = openDialog('Change password', dialog, { firstFocus: () => current.focus() });
}

export { encodeNext };
