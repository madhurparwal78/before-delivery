import { el } from './dom.js';
import * as api from './api.js';
import { ApiFailure } from './api.js';
import { navigate, requestFocus, rerender } from './app-state.js';
import { projectUrl } from './router.js';

/** The invitation page. */
export async function renderInvite(root: HTMLElement, token: string): Promise<void> {
  const page = el('div', { class: 'page' });
  let info: { projectTitle: string; role: string; inviterName: string } | null = null;
  let dead = false;
  let alreadyMemberProject: string | null = null;
  let name = '';
  let password = '';
  try {
    const res = await api.getInviteToken(token);
    info = res.invite;
  } catch (e) {
    dead = true;
    void e;
  }
  if (!info) {
    page.appendChild(el('h1', {}, 'This invitation is no longer valid'));
    root.replaceChildren(page);
    return;
  }
  page.appendChild(el('h1', {}, `Join ${info.projectTitle}`));
  page.appendChild(el('p', {}, `${info.inviterName} invited you to join as ${info.role}.`));
  const form = el('form', {
    onsubmit: async (ev: Event) => {
      ev.preventDefault();
      name = (document.getElementById('inv-name') as HTMLInputElement).value;
      password = (document.getElementById('inv-pass') as HTMLInputElement).value;
      const errBox = document.getElementById('inv-error');
      try {
        const res = await api.postAcceptInvite(token, name, password);
        navigate(projectUrl(res.projectId, { file: 'main.tex' }), true);
      } catch (e) {
        if (e instanceof ApiFailure) {
          if (e.shape.status === 410) {
            dead = true;
            const fresh = el('div', { class: 'page' }, el('h1', {}, 'This invitation is no longer valid'));
            root.replaceChildren(fresh);
            return;
          }
          if (e.shape.status === 401) {
            if (errBox) errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert', id: 'pass-error' }, 'That password does not match this account.'));
            const nameBox = document.getElementById('inv-name') as HTMLInputElement | null;
            if (nameBox && nameBox.value === '') nameBox.value = name;
            const pass = document.getElementById('inv-pass') as HTMLInputElement | null;
            pass?.focus();
            return;
          }
          if (e.shape.status === 409 && e.shape.code === 'already_member') {
            alreadyMemberProject = e.shape.projectId ?? null;
            const fresh = el('div', { class: 'page' });
            fresh.appendChild(el('h1', {}, `Join ${info?.projectTitle ?? ''}`));
            fresh.appendChild(el('p', {}, `You already belong to ${info?.projectTitle ?? ''}.`));
            if (alreadyMemberProject) {
              fresh.appendChild(el('p', {}, el('a', {
                href: projectUrl(alreadyMemberProject, { file: 'main.tex' }),
                onclick: (ev2: Event) => { ev2.preventDefault(); navigate(projectUrl(alreadyMemberProject as string, { file: 'main.tex' }), true); },
              }, `Open ${info?.projectTitle ?? ''}`)));
            }
            root.replaceChildren(fresh);
            return;
          }
          if (e.shape.status === 422) {
            const errs = e.shape.errors ?? {};
            const msg = errs.password
              ? (errs.password === 'unstorable character'
                ? 'This text contains a character that cannot be stored.'
                : 'Use at least 10 characters.')
              : (errs.displayName
                ? (errs.displayName === 'unstorable character'
                  ? 'This text contains a character that cannot be stored.'
                  : 'Enter a display name of 1 to 80 characters.')
                : 'Something went wrong. Try again.');
            if (errBox) errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert', id: errs.password ? 'pass-error' : 'name-error' }, msg));
            const target = document.getElementById(errs.password ? 'inv-pass' : 'inv-name') as HTMLInputElement | null;
            target?.focus();
            return;
          }
        }
        if (errBox) errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert' }, 'Something went wrong. Try again.'));
      }
    },
  });
  form.appendChild(el('div', { class: 'field' },
    el('label', { for: 'inv-name' }, 'Display name'),
    el('input', { type: 'text', id: 'inv-name', autocomplete: 'name', value: name })));
  form.appendChild(el('div', { class: 'field' },
    el('label', { for: 'inv-pass' }, 'Password'),
    el('input', { type: 'password', id: 'inv-pass', autocomplete: 'new-password', value: password })));
  const errBox = el('div', { id: 'inv-error' });
  form.appendChild(errBox);
  form.appendChild(el('p', { class: 'meta' }, 'If you already use Marginalia, enter your existing password; your display name stays as it is.'));
  form.appendChild(el('button', { type: 'submit', class: 'primary' }, 'Accept invitation'));
  page.appendChild(form);
  root.replaceChildren(page);
  const first = document.getElementById('inv-name');
  if (first) first.focus();
  void rerender; void requestFocus;
}

/** The shared draft view. */
export function shareDeadPage(): HTMLElement {
  return el('div', { class: 'page' }, el('h1', {}, 'This link is no longer active'));
}
