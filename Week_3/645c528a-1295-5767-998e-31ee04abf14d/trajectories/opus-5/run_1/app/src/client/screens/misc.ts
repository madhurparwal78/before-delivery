import { FRIENDS_COPY, PLAY_COPY, VERIFY_COPY } from '../../shared/copy.js';
import { api } from '../api.js';
import { openSignUpSheet } from '../auth-sheet.js';
import { clear, el, labelledButton, statusRegion } from '../dom.js';
import { navigate, type Screen, type ScreenContext } from '../navigate.js';
import { refreshMe, state } from '../state.js';

export function verifyScreen(context: ScreenContext): Screen {
  const heading = el('h1', { className: 'screen-heading', text: '', attrs: { tabindex: '-1' } });
  const token = context.url.searchParams.get('token') ?? '';
  const backLink = el('a', {
    className: 'button',
    text: 'Back to lobby',
    attrs: { href: '/home', 'aria-label': 'Back to lobby' },
    on: {
      click: (event) => {
        event.preventDefault();
        navigate('/home');
      },
    },
  });

  void (async () => {
    const result = await api<{ emailVerified: boolean }>('POST', '/api/auth/verify', { token });
    heading.textContent = result.ok ? VERIFY_COPY.heading : VERIFY_COPY.invalid;
    if (result.ok) await refreshMe();
  })();

  return { element: el('div', { className: 'verify', children: [heading, backLink] }) };
}

export function inviteScreen(context: ScreenContext): Screen {
  const token = context.params.token ?? '';
  const heading = el('h1', { className: 'screen-heading', text: 'Invite', attrs: { tabindex: '-1' } });
  const notice = statusRegion('Invite notice', 'notice');
  const host = el('div', { className: 'invite' });

  async function accept(): Promise<void> {
    const result = await api<{ tableUrl: string }>('POST', `/api/invites/${token}/accept`);
    if (result.ok) {
      navigate(result.data.tableUrl);
      return;
    }
    if (result.failure.error === 'invite_expired') heading.textContent = FRIENDS_COPY.expired;
    else notice.textContent = result.failure.message;
  }

  void (async () => {
    const result = await api<{ status: string; hostName: string }>('GET', `/api/invites/${token}`);
    if (!result.ok) {
      heading.textContent = FRIENDS_COPY.expired;
      return;
    }
    heading.textContent = `${result.data.hostName} invited you`;
    if (state.me) {
      await accept();
      return;
    }
    notice.textContent = FRIENDS_COPY.loggedOutNote;
    const openSheet = (): void => {
      clear(host);
      openSignUpSheet({
        opener: null,
        onSuccess: () => void accept(),
        onClose: () => {
          const reopen = labelledButton('Create account', () => openSheet(), { className: 'button primary' });
          host.append(reopen);
          reopen.focus();
        },
      });
    };
    openSheet();
  })();

  return { element: el('div', { className: 'invite-screen', children: [heading, notice, host] }) };
}

export function addFriendScreen(context: ScreenContext): Screen {
  const code = context.params.code ?? '';
  const notice = statusRegion('Friends notice', 'notice');
  const heading = el('h1', { className: 'screen-heading', text: 'Add friend', attrs: { tabindex: '-1' } });

  void (async () => {
    if (!state.me) {
      notice.textContent = FRIENDS_COPY.loggedOutNote;
      return;
    }
    const result = await api<{ requestId: string; displayName: string }>('POST', '/api/friends/requests', { code });
    notice.textContent = result.ok ? FRIENDS_COPY.requestSent(result.data.displayName) : result.failure.message;
  })();

  return { element: el('div', { className: 'add-friend', children: [heading, notice] }) };
}

export function notFoundScreen(): Screen {
  return {
    element: el('div', {
      className: 'not-found',
      children: [el('h1', { className: 'screen-heading', text: PLAY_COPY.notFound, attrs: { tabindex: '-1' } })],
    }),
  };
}
