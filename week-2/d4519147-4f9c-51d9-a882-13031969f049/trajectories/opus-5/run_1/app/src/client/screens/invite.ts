import { ApiFailure, api, sessionState, setSession } from '../api';
import { COPY } from '../../shared/copy';
import { el, field } from '../dom';
import { navigate } from '../router';
import { signInPathFor } from '../../shared/routes';
import type { InviteView } from '../../shared/types';

export async function renderInvite(root: HTMLElement, token: string): Promise<void> {
  const host = el('div', { class: 'card' });
  root.replaceChildren(el('div', { class: 'centred' }, [host]));

  let invite: InviteView;
  try {
    const body = await api.get<{ invite: InviteView }>(`/api/invites/${encodeURIComponent(token)}`);
    invite = body.invite;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'invite_expired') {
      host.replaceChildren(
        el('h1', { text: COPY.inviteExpiredHeading }),
        el('p', { text: COPY.inviteExpiredText }),
      );
      return;
    }
    if (error instanceof ApiFailure && error.code === 'invite_lookup_limited') {
      host.replaceChildren(
        el('h1', { text: COPY.inviteLookupLimitedHeading }),
        el('p', { text: COPY.inviteLookupLimitedText }),
      );
      return;
    }
    host.replaceChildren(
      el('h1', { text: COPY.diagramNotFoundHeading }),
      el('p', { text: COPY.diagramNotFoundText }),
    );
    return;
  }

  const signedIn = sessionState.user !== null;
  const nodes: HTMLElement[] = [
    el('h1', { text: `${invite.inviterName} invited you to ${invite.diagramTitle}` }),
    el('p', { text: `You have been invited as ${invite.role}, at ${invite.email}.` }),
  ];
  const alertHost = el('div');
  nodes.push(alertHost);

  const accept = el('button', { type: 'button', class: 'primary', text: 'Accept invitation' });
  let displayNameInput: HTMLInputElement | null = null;
  let passwordInput: HTMLInputElement | null = null;

  if (!signedIn && invite.accountExists) {
    const link = el('a', { href: signInPathFor(`/invite/${token}`), text: 'Sign in to accept' });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(signInPathFor(`/invite/${token}`));
    });
    nodes.push(el('p', {}, [link]));
  } else {
    if (!signedIn) {
      displayNameInput = el('input', { type: 'text' });
      passwordInput = el('input', { type: 'password', autocomplete: 'new-password' });
      nodes.push(field('Display name', displayNameInput, { id: 'invite-display-name' }));
      nodes.push(field('Password', passwordInput, { id: 'invite-password' }));
    }
    nodes.push(accept);
  }
  host.replaceChildren(...nodes);

  accept.addEventListener('click', () => {
    accept.disabled = true;
    alertHost.replaceChildren();
    const payload =
      displayNameInput && passwordInput
        ? { displayName: displayNameInput.value, password: passwordInput.value }
        : {};
    void api
      .post<{ diagramId: string; firstPageId: string; role: string }>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        payload,
      )
      .then(async (body) => {
        if (!sessionState.user) {
          const session = await api.get<{ user: typeof sessionState.user; csrfToken: string }>('/api/session');
          setSession(session.user, session.csrfToken);
        }
        await navigate(`/d/${body.diagramId}/p/${body.firstPageId}`, { replace: true });
      })
      .catch((error: unknown) => {
        accept.disabled = false;
        let message: string = COPY.genericFailure;
        if (error instanceof ApiFailure) {
          if (error.code === 'invite_email_mismatch') message = COPY.inviteWrongPerson;
          else if (error.code === 'invite_expired') message = COPY.inviteExpiredText;
          else if (error.code === 'validation') {
            message = error.fields.password ? COPY.passwordLength : 'Use 1 to 80 characters.';
          } else if (error.code === 'invite_lookup_limited') message = COPY.inviteLookupLimitedText;
        }
        alertHost.append(el('div', { class: 'alert', role: 'alert', text: message }));
      });
  });
}
