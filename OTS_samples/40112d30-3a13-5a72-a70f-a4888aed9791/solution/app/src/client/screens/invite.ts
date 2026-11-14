import { api, ApiFailure } from '../lib/api.ts';
import { alertText } from '../lib/live.ts';
import { h } from '../lib/dom.ts';
import { frame, notFound, ready } from '../lib/shell.ts';
import { orNotFound } from '../owner/form-screen.ts';

// The invitation page: one heading and one action. Signed out, the action is a way in that returns here.

async function signedIn(): Promise<boolean> {
  try {
    await api('GET', '/api/session');
    return true;
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.status === 401) return false;
    throw failure;
  }
}

export async function render(params: Record<string, string>): Promise<void> {
  const token = params['token'] ?? '';
  const main = frame();
  main.classList.add('owner-screen');
  const invitation = await orNotFound(api<{ form_title: string }>('GET', `/api/invitations/${encodeURIComponent(token)}`));
  if (!invitation) return;
  const title = h('h1', {}, `Join ${invitation.form_title}`);
  const here = `?next=${encodeURIComponent(location.pathname)}`;
  const actions = (await signedIn())
    ? h('div', { class: 'actions' }, acceptButton(token))
    : h('div', { class: 'actions' }, h('a', { href: `/signin${here}` }, 'Sign in'), h('a', { href: `/signup${here}` }, 'Create account'));
  ready(main, `${title.textContent} - Nightform`);
  main.append(title, actions);
}

function acceptButton(token: string): HTMLElement {
  const button = h('button', { type: 'button', class: 'primary' }, 'Accept invitation');
  button.addEventListener('click', () => { void accept(token, button); });
  return button;
}

async function accept(token: string, button: HTMLElement): Promise<void> {
  button.setAttribute('aria-busy', 'true');
  try {
    const joined = await api<{ form_id: string }>('POST', `/api/invitations/${encodeURIComponent(token)}/accept`, {});
    location.assign(`/forms/${joined.form_id}/edit`);
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    button.removeAttribute('aria-busy');
    if (failure.status === 404) return notFound();
    alertText(failure.message);
  }
}
