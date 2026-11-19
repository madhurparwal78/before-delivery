import { ErrorBody, Identity, InviteSummary, request } from '../api.js';
import { el, field } from '../dom.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { textbox } from './common.js';

const SIGN_IN_ERROR = 'Email or password is incorrect.';
const INVITE_EXPIRED = 'This invite link has already been used or has expired.';

function centredPanel(children: (HTMLElement | null)[]): HTMLElement {
  return el(
    'div',
    { class: 'container section' },
    el(
      'div',
      { class: 'centred-column' },
      children.filter((node): node is HTMLElement => node !== null),
    ),
  );
}

export async function renderSignIn(): Promise<void> {
  const shell = renderShell(null, '/signin');
  const email = textbox('signin-email', 'email', { type: 'text' });
  const password = el('input', {
    attrs: { id: 'signin-password', name: 'signin-password', type: 'password', autocomplete: 'current-password' },
    data: { field: 'password' },
  }) as HTMLInputElement;
  const alert = el('p', { class: 'alert-area', attrs: { role: 'alert' } });
  const form = el(
    'form',
    { class: 'form-panel', attrs: { 'aria-label': 'Sign in', novalidate: true } },
    [
      el('h1', { class: 'form-heading', text: 'Sign in' }),
      alert,
      field('signin-email', 'Email', email),
      field('signin-password', 'Password', password),
      el('button', { class: 'pill pill-primary', attrs: { type: 'submit' } }, 'Sign in'),
    ],
  ) as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    alert.textContent = '';
    void request<Identity>('/api/session', {
      method: 'POST',
      body: { email: email.value.trim(), password: password.value },
    })
      .then((result) => {
        if (result.status !== 200) {
          alert.textContent = SIGN_IN_ERROR;
          return;
        }
        navigate(`/w/${result.body.workspaces[0].id}/explorer`);
      })
      .catch(() => {
        alert.textContent = SIGN_IN_ERROR;
      });
  });

  shell.main.appendChild(centredPanel([form]));
}

export async function renderInvite(token: string): Promise<void> {
  const shell = renderShell(null, `/invites/${token}`);
  const result = await request<InviteSummary & ErrorBody>(`/api/invites/${token}`);
  if (result.status !== 200) {
    shell.main.appendChild(
      centredPanel([
        el('h1', { class: 'page-title', text: 'Join Fernsquare' }),
        el('p', { class: 'banner', attrs: { role: 'alert' }, text: INVITE_EXPIRED }),
        el('a', { class: 'pill pill-outline', attrs: { href: '/signin' } }, 'Go to sign in'),
      ]),
    );
    return;
  }
  const invite = result.body;
  const nameInput = textbox('invite-name', 'name');
  const password = el('input', {
    attrs: { id: 'invite-password', name: 'invite-password', type: 'password', autocomplete: 'new-password' },
    data: { field: 'password' },
  }) as HTMLInputElement;
  const alert = el('p', { class: 'alert-area', attrs: { role: 'alert' } });
  const form = el(
    'form',
    { class: 'form-panel', attrs: { 'aria-label': 'Accept invite', novalidate: true } },
    [
      alert,
      invite.existingAccount ? null : field('invite-name', 'Your name', nameInput),
      field('invite-password', 'Password', password),
      el('button', { class: 'pill pill-primary', attrs: { type: 'submit' } }, 'Accept invite'),
    ],
  ) as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    alert.textContent = '';
    for (const error of form.querySelectorAll<HTMLElement>('.field-error')) error.textContent = '';
    void request<{ workspaceId: string } & ErrorBody>(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: { name: nameInput.value.trim(), password: password.value },
    })
      .then((response) => {
        if (response.status === 200) {
          navigate(`/w/${response.body.workspaceId}/explorer`);
          return;
        }
        const body = response.body;
        if (body.errors) {
          const [fieldName, message] = Object.entries(body.errors)[0];
          alert.textContent = message;
          const control = form.querySelector<HTMLElement>(`[data-field="${fieldName}"]`);
          const errorNode = control
            ? form.querySelector<HTMLElement>(`#${control.id}-error`)
            : null;
          if (errorNode) errorNode.textContent = message;
          control?.focus();
          return;
        }
        alert.textContent = body.error ?? SIGN_IN_ERROR;
      })
      .catch(() => {
        alert.textContent = SIGN_IN_ERROR;
      });
  });

  shell.main.appendChild(
    centredPanel([
      el('h1', { class: 'page-title', text: `Join ${invite.workspaceName} on Fernsquare` }),
      el('p', {
        class: 'lede',
        text: `You were invited as a ${invite.role === 'developer' ? 'Developer' : 'Viewer'}.`,
      }),
      form,
    ]),
  );
}
