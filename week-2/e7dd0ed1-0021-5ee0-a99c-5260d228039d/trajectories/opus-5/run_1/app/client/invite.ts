import { ApiFailure, api } from './api';
import { button, el, field, replace, textbox } from './dom';
import { acceptInvite, signIn as signInCopy } from './copy';

interface InviteView {
  workspace: { slug: string; name: string };
  email: string;
  role: string;
  expires_at: string;
  existing_account: boolean;
}

export async function mountInvite(root: HTMLElement): Promise<void> {
  const token = window.location.pathname.split('/').filter((part) => part !== '')[1] ?? '';
  const alert = el('p', { class: 'alert', role: 'alert' });
  let invite: InviteView;
  try {
    invite = (await api.get<InviteView>(`/api/invites/${token}`)).body;
  } catch (error) {
    replace(root, [
      el('div', { class: 'panel' }, [
        el('h1', { text: 'Join a workspace' }),
        (() => {
          alert.textContent =
            error instanceof ApiFailure && error.code === 'invite_expired' ? acceptInvite.expired : 'This invite does not exist.';
          return alert;
        })(),
      ]),
    ]);
    return;
  }

  const name = textbox('Your name');
  const password = textbox('Password', { type: 'password' });
  const join = button('Join workspace', { className: 'primary' });
  join.addEventListener('click', async () => {
    alert.textContent = '';
    try {
      const body: Record<string, string> = { password: password.value };
      if (!invite.existing_account) body.name = name.value;
      const response = await api.post<unknown>(`/api/invites/${token}/accept`, body);
      window.location.assign(response.status === 202 ? '/signin' : '/console');
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      alert.textContent =
        error.code === 'invite_expired'
          ? acceptInvite.expired
          : error.code === 'invalid_credentials'
            ? acceptInvite.wrongPassword
            : error.code === 'rate_limited'
              ? signInCopy.throttled(error.retryAfterSeconds)
              : (error.errors.password ?? error.errors.name ?? error.message);
    }
  });

  replace(root, [
    el('div', { class: 'panel' }, [
      el('h1', { text: `Join ${invite.workspace.name}` }),
      el('p', { text: `${invite.email} \u00b7 ${invite.role}` }),
      invite.existing_account ? null : field('Your name', name),
      field('Password', password),
      join,
      alert,
    ]),
  ]);
}
