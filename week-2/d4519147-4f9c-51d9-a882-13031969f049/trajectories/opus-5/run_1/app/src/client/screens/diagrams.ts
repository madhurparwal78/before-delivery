import { ApiFailure, api, sessionState, setSession } from '../api';
import { COPY } from '../../shared/copy';
import { announce, el, field, openPanel } from '../dom';
import { navigate } from '../router';
import type { DiagramDetail, DiagramListItem, SessionBody } from '../../shared/types';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

export async function renderDiagrams(root: HTMLElement): Promise<void> {
  const heading = el('h1', { text: 'Diagrams' });
  const list = el('ul', { class: 'diagram-list', role: 'list', 'aria-label': 'Your diagrams' });
  const newButton = el('button', { type: 'button', text: 'New diagram' });
  const passwordButton = el('button', { type: 'button', text: 'Change password' });
  const signOutButton = el('button', { type: 'button', text: 'Sign out' });
  const actions = el('div', { class: 'row-actions' }, [newButton, passwordButton, signOutButton]);
  root.replaceChildren(el('div', { class: 'page' }, [heading, list, actions]));

  newButton.addEventListener('click', () => openNewDiagram());
  passwordButton.addEventListener('click', () => openChangePassword());
  signOutButton.addEventListener('click', () => {
    void api.del('/api/session').then(() => {
      setSession(null, null);
      return navigate('/signin');
    });
  });

  const body = await api.get<{ diagrams: DiagramListItem[] }>('/api/diagrams');
  list.replaceChildren(
    ...body.diagrams.map((diagram) => {
      const link = el('a', { href: `/d/${diagram.id}`, text: diagram.title });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void navigate(`/d/${diagram.id}`);
      });
      return el('li', {}, [
        link,
        el('span', { class: 'role-chip', text: ROLE_LABEL[diagram.role] ?? diagram.role }),
        el('span', { class: 'updated', text: formatUpdated(diagram.updatedAt) }),
      ]);
    }),
  );
}

function formatUpdated(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function openNewDiagram(): void {
  const titleInput = el('input', { type: 'text', value: 'Untitled diagram' });
  const create = el('button', { type: 'button', class: 'primary', text: 'Create diagram' });
  const errorHost = el('div');
  const content = el('div', {}, [
    el('h2', { id: 'new-diagram-title', text: 'New diagram' }),
    errorHost,
    field('Title', titleInput, { id: 'new-diagram-input' }),
    el('div', { class: 'dialog-actions' }, [create]),
  ]);
  const panel = openPanel(content, { labelledBy: 'New diagram', initialFocus: () => titleInput });
  create.addEventListener('click', () => {
    create.disabled = true;
    errorHost.replaceChildren();
    void api
      .post<{ diagram: DiagramDetail }>('/api/diagrams', { title: titleInput.value })
      .then((body) => {
        panel.close();
        const firstPage = body.diagram.pages[0];
        return navigate(`/d/${body.diagram.id}/p/${firstPage ? firstPage.id : ''}`);
      })
      .catch((error: unknown) => {
        create.disabled = false;
        const message = error instanceof ApiFailure ? 'Use 1 to 120 characters.' : COPY.genericFailure;
        errorHost.append(el('div', { class: 'alert', role: 'alert', text: message }));
      });
  });
}

function openChangePassword(): void {
  const currentInput = el('input', { type: 'password', autocomplete: 'current-password' });
  const newInput = el('input', { type: 'password', autocomplete: 'new-password' });
  const save = el('button', { type: 'button', class: 'primary', text: 'Save password' });
  const alertHost = el('div');
  const currentError = el('div', { class: 'field-error', id: 'current-password-error' });
  const newError = el('div', { class: 'field-error', id: 'new-password-error' });
  const currentField = field('Current password', currentInput, { id: 'current-password' });
  const newField = field('New password', newInput, { id: 'new-password' });
  currentField.append(currentError);
  newField.append(newError);
  const content = el('div', {}, [
    el('h2', { text: 'Change password' }),
    alertHost,
    currentField,
    newField,
    el('div', { class: 'dialog-actions' }, [save]),
  ]);
  const panel = openPanel(content, { labelledBy: 'Change password', initialFocus: () => currentInput });

  save.addEventListener('click', () => {
    save.disabled = true;
    alertHost.replaceChildren();
    currentError.textContent = '';
    newError.textContent = '';
    currentInput.removeAttribute('aria-describedby');
    newInput.removeAttribute('aria-describedby');
    void api
      .post<SessionBody>('/api/session/password', {
        currentPassword: currentInput.value,
        newPassword: newInput.value,
      })
      .then((body) => {
        setSession(body.user, body.csrfToken);
        panel.close();
        announce(COPY.passwordChanged);
      })
      .catch((error: unknown) => {
        save.disabled = false;
        if (error instanceof ApiFailure && error.code === 'signin_locked') {
          alertHost.append(el('div', { class: 'alert', role: 'alert', text: COPY.signInLocked }));
          return;
        }
        if (error instanceof ApiFailure && error.code === 'validation') {
          if (error.fields.currentPassword === 'incorrect') {
            currentError.textContent = COPY.passwordCurrentIncorrect;
            currentInput.setAttribute('aria-describedby', 'current-password-error');
            currentInput.focus();
          }
          if (error.fields.newPassword === 'length') {
            newError.textContent = COPY.passwordLength;
            newInput.setAttribute('aria-describedby', 'new-password-error');
          }
          if (error.fields.newPassword === 'unchanged') {
            newError.textContent = COPY.passwordUnchanged;
            newInput.setAttribute('aria-describedby', 'new-password-error');
          }
          return;
        }
        alertHost.append(el('div', { class: 'alert', role: 'alert', text: COPY.genericFailure }));
      });
  });
}

export function diagramsNeedsSession(): boolean {
  return sessionState.user === null;
}
