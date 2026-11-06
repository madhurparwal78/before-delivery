// The invitation page, open to signed-in and signed-out visitors.

import { apiGet, apiPost, setCsrfToken, ApiRequestError, NetworkError, SessionUser } from './api.js';
import { COPY } from '../shared/constants.js';
import { h } from './hyperscript.js';
import { navigate, encodeNext, notFoundScreen, state as appState } from './app.js';

interface InviteInfo {
  diagramTitle: string;
  inviterName: string;
  role: 'editor' | 'viewer';
  email: string;
  accountExists: boolean;
}

export function renderInvitePage(token: string, user: SessionUser | null): HTMLElement {
  const main = h('main', { class: 'invite-screen' });
  const card = h('div', { class: 'card' });
  main.appendChild(card);

  const expiredPage = (): void => {
    card.innerHTML = '';
    card.append(h('h1', {}, COPY.inviteExpiredHeading), h('p', {}, COPY.inviteExpiredText));
  };

  const tooManyPage = (): void => {
    card.innerHTML = '';
    card.append(h('h1', {}, COPY.inviteTooManyHeading), h('p', {}, COPY.inviteTooManyText));
  };

  const notFoundPage = (): void => {
    main.innerHTML = '';
    main.appendChild(notFoundScreen());
  };

  const renderInfo = (invite: InviteInfo): void => {
    card.innerHTML = '';
    const h1 = h('h1', {}, `Invitation to ${invite.diagramTitle}`);
    const detail = h('p', {}, `${invite.inviterName} invited you to ${invite.diagramTitle} as ${invite.role}.`);
    const target = h('p', {}, `This invitation was sent to ${invite.email}.`);
    card.append(h1, detail, target);
    const error = h('div', { role: 'alert', class: 'alert hidden' });

    const acceptAndGo = async (): Promise<void> => {
      error.classList.add('hidden');
      try {
        const resp = await apiPost(`/api/invites/${token}/accept`, {}) as { diagramId: string; firstPageId: string };
        navigate(`/d/${resp.diagramId}/p/${resp.firstPageId}`, true);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'invite_email_mismatch') {
          error.textContent = COPY.inviteWrongPerson;
          error.classList.remove('hidden');
        } else {
          error.textContent = COPY.genericFailureBanner;
          error.classList.remove('hidden');
        }
      }
    };

    if (user !== null) {
      const accept = h('button', { class: 'primary', onclick: () => void acceptAndGo() }, 'Accept invitation');
      card.append(error, accept);
      accept.focus();
      return;
    }
    if (invite.accountExists) {
      const signInLink = h('a', { href: `/signin?next=${encodeNext(`/invite/${token}`)}` }, 'Sign in to accept');
      signInLink.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        navigate(`/signin?next=${encodeNext(`/invite/${token}`)}`);
      });
      card.append(error, signInLink);
      return;
    }
    const displayName = h('input', { type: 'text', class: 'field', 'aria-label': 'Display name' }) as HTMLInputElement;
    const password = h('input', { type: 'password', class: 'field', 'aria-label': 'Password' }) as HTMLInputElement;
    const accept = h('button', { class: 'primary' }, 'Accept invitation');
    accept.addEventListener('click', async () => {
      error.classList.add('hidden');
      accept.setAttribute('disabled', '');
      try {
        const resp = await apiPost(`/api/invites/${token}/accept`, {
          displayName: displayName.value,
          password: password.value,
        }) as { diagramId: string; firstPageId: string };
        // Account creation issues a session; the app state refreshes.
        appState.user = null;
        setCsrfToken(null);
        navigate(`/d/${resp.diagramId}/p/${resp.firstPageId}`, true);
      } catch (err) {
        accept.removeAttribute('disabled');
        if (err instanceof ApiRequestError) {
          if (err.code === 'validation') {
            error.textContent = 'Enter a display name and a password of 12 to 128 characters.';
          } else {
            error.textContent = COPY.genericFailureBanner;
          }
        } else {
          error.textContent = COPY.genericFailureBanner;
        }
        error.classList.remove('hidden');
      }
    });
    card.append(
      error,
      h('label', {}, 'Display name'), displayName,
      h('label', {}, 'Password'), password,
      accept,
    );
    displayName.focus();
  };

  void apiGet;
  void NetworkError;

  const load = async (): Promise<void> => {
    try {
      const resp = await apiGet(`/api/invites/${token}`) as { invite: InviteInfo };
      renderInfo(resp.invite);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'invite_expired') expiredPage();
        else if (err.code === 'invite_lookup_limited') tooManyPage();
        else notFoundPage();
      } else {
        notFoundPage();
      }
    }
  };

  void load();
  return main;
}
